#!/usr/bin/env node
/**
 * AI 资讯雷达 · 周刊发送脚本（GitHub Actions / 本地均可运行）
 *
 * 流程：读取 Gist 偏好 → 抓取近 7 天 RSS → 按用户标签权重打分过滤 → Resend 发信
 *
 * 环境变量：
 *   RESEND_API_KEY   必填，Resend API Key
 *   WEEKLY_RECIPIENT 收件邮箱（未配置时回退使用 Gist 偏好里的 email）
 *   WEEKLY_FROM      发件人，默认 onboarding@resend.dev
 *   GH_GIST_TOKEN    GitHub Token（读取私密 Gist；公开 Gist 可不填）
 *   PREFS_GIST_ID    偏好 Gist ID（未配置则使用默认权重）
 *   DRY_RUN          true/1 时只生成 preview/weekly-preview.html，不发信
 *
 * 用法：
 *   node scripts/send-weekly.js --dry-run   # 预览不发送
 *   node scripts/send-weekly.js             # 正式发送
 */

const fs = require('fs');
const path = require('path');
const core = require('../lib/core.js');

const DRY_RUN = process.argv.includes('--dry-run') ||
  ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());

function log(msg) { console.log(`[weekly] ${msg}`); }
function fail(msg) { console.error(`[weekly] ERROR: ${msg}`); process.exit(1); }

/**
 * 从 GitHub Gist 读取用户偏好
 */
async function fetchPreferences() {
  const gistId = process.env.PREFS_GIST_ID;
  let enabledIds = null; // null = 全部启用
  let prefsEmail = '';
  let manualTags = {};

  if (!gistId) {
    log('未配置 PREFS_GIST_ID，使用默认标签权重（所有源启用）');
    return { weights: core.getDefaultWeights(), enabledIds, prefsEmail, manualTags, source: 'default' };
  }

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ai-news-radar-weekly'
  };
  if (process.env.GH_GIST_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_GIST_TOKEN;

  log(`读取偏好 Gist: ${gistId}`);
  const resp = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!resp.ok) {
    fail(`读取 Gist 失败 HTTP ${resp.status}（请检查 PREFS_GIST_ID / GH_GIST_TOKEN）`);
  }
  const data = await resp.json();
  const file = data.files && data.files[core.GIST_FILENAME];
  if (!file || !file.content) {
    fail(`Gist 中找不到文件 ${core.GIST_FILENAME}，请在网页端重新同步偏好`);
  }

  const prefs = JSON.parse(file.content);

  // 先注册用户自定义标签，权重默认表才会包含它们
  if (Array.isArray(prefs.customTags) && prefs.customTags.length) {
    core.registerTags(prefs.customTags);
    log(`已加载 ${prefs.customTags.length} 个自定义标签`);
  }
  manualTags = (prefs.manualTags && typeof prefs.manualTags === 'object') ? prefs.manualTags : {};

  const weights = core.getDefaultWeights();
  if (prefs.tagWeights) {
    Object.keys(prefs.tagWeights).forEach(id => {
      if (weights[id] !== undefined) weights[id] = prefs.tagWeights[id];
    });
  }
  if (prefs.sources && typeof prefs.sources === 'object') {
    enabledIds = core.SOURCES.filter(s => prefs.sources[s.id] !== false).map(s => s.id);
  }
  prefsEmail = prefs.email || '';
  log(`偏好已加载（更新于 ${prefs.updatedAt || '未知'}）` +
    `，关注 ${Object.values(weights).filter(w => w === core.TAG_WEIGHTS.FOCUS).length} 个 / ` +
    `不关注 ${Object.values(weights).filter(w => w === core.TAG_WEIGHTS.IGNORE).length} 个标签`);

  return { weights, enabledIds, prefsEmail, manualTags, source: 'gist' };
}

/**
 * 把用户手动打的标签合并进文章（自动标签 + 手动标签，去重，过滤已删除标签）
 */
function attachManualTags(articles, manualMap) {
  articles.forEach(a => {
    const manual = manualMap[a.link] || [];
    const merged = [];
    (a.tags || []).concat(manual).forEach(id => {
      if (!core.TAGS[id]) return;
      if (!merged.includes(id)) merged.push(id);
    });
    a.tags = merged;
  });
}

async function main() {
  if (typeof fetch !== 'function') {
    fail('需要 Node.js 18+（内置 fetch），当前版本过低');
  }

  // 1. 读取偏好
  const prefs = await fetchPreferences();

  // 2. 抓取文章
  log('开始抓取 RSS 源（近 7 天）...');
  const { articles, failures } = await core.fetchAllArticles({ days: 7, enabledIds: prefs.enabledIds });
  log(`抓取完成：${articles.length} 篇文章` + (failures.length ? `，失败源：${failures.join('、')}` : ''));

  // 2.5 合并用户手动标签（影响打分与邮件分组）
  attachManualTags(articles, prefs.manualTags);
  const manualCount = Object.values(prefs.manualTags).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  if (manualCount) log(`已合并手动标签：${manualCount} 条标记`);

  // 3. 按用户权重打分、过滤、排序
  const selected = core.selectForWeekly(articles, prefs.weights, 60);
  log(`个性化选稿后：${selected.length} 篇（score<0 的「不关注」文章已排除）`);

  if (selected.length === 0) {
    log('本周没有匹配偏好的文章，跳过发送。');
    return;
  }

  // 4. 生成邮件 HTML
  const html = core.buildEmailHTML(selected);
  const dateStr = new Date().toLocaleDateString('zh-CN');
  const subject = `AI 资讯雷达 · 本周精选 · ${dateStr}`;

  // 留存一份预览（GitHub Actions 会作为 artifact 上传，方便排查）
  const dir = path.join(__dirname, '..', 'preview');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'weekly-preview.html'), html, 'utf8');

  // 5. Dry-run 或正式发送
  if (DRY_RUN) {
    log(`DRY RUN：未发送邮件，预览已写入 preview/weekly-preview.html`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.WEEKLY_RECIPIENT || prefs.prefsEmail;
  const from = process.env.WEEKLY_FROM || 'AI 资讯雷达 <onboarding@resend.dev>';
  if (!apiKey) fail('缺少 RESEND_API_KEY');
  if (!recipient) fail('缺少收件人：请配置 WEEKLY_RECIPIENT，或在网页端订阅邮箱后同步到 Gist');

  log(`发送邮件到 ${recipient}（from: ${from}）`);
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: [recipient], subject, html })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    fail(`Resend 发送失败 HTTP ${resp.status}: ${JSON.stringify(data)}`);
  }
  log(`✓ 发送成功，邮件 ID: ${data.id}`);
}

main().catch(err => fail(err && err.stack || String(err)));
