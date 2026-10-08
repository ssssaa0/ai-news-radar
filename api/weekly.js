/**
 * AI 资讯雷达 · 周刊邮件 Vercel Serverless 函数（可选部署方式）
 *
 * 推荐使用免费的 GitHub Actions（见 .github/workflows/weekly.yml）；
 * 本文件保留给已有 Vercel 环境的用户，功能与 scripts/send-weekly.js 一致。
 *
 * 触发：GET /api/weekly?key=CRON_SECRET
 * 环境变量：RESEND_API_KEY / WEEKLY_RECIPIENT / WEEKLY_FROM
 *           GH_GIST_TOKEN / PREFS_GIST_ID（读取云端偏好，可选）
 */

const core = require('../lib/core.js');

async function fetchPreferences() {
  let enabledIds = null;
  let prefsEmail = '';
  let manualTags = {};

  const gistId = process.env.PREFS_GIST_ID;
  if (!gistId) return { weights: core.getDefaultWeights(), enabledIds, prefsEmail, manualTags };

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ai-news-radar-vercel'
  };
  if (process.env.GH_GIST_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_GIST_TOKEN;

  const resp = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!resp.ok) throw new Error(`读取 Gist 失败 HTTP ${resp.status}`);
  const data = await resp.json();
  const file = data.files && data.files[core.GIST_FILENAME];
  if (!file || !file.content) throw new Error('Gist 中缺少偏好文件');

  const prefs = JSON.parse(file.content);

  // 先注册自定义标签，权重表才完整
  if (Array.isArray(prefs.customTags) && prefs.customTags.length) {
    core.registerTags(prefs.customTags);
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
  return { weights, enabledIds, prefsEmail, manualTags };
}

/** 合并手动标签（自动 + 手动，去重，过滤已删除标签） */
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

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.query.key !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Invalid key' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '缺少 RESEND_API_KEY' });
  }

  try {
    const prefs = await fetchPreferences();
    const { articles, failures } = await core.fetchAllArticles({ days: 7, enabledIds: prefs.enabledIds });
    attachManualTags(articles, prefs.manualTags);
    const selected = core.selectForWeekly(articles, prefs.weights, 60);

    if (selected.length === 0) {
      return res.status(200).json({ ok: true, skipped: true, reason: '本周无匹配文章', failures });
    }

    const recipient = process.env.WEEKLY_RECIPIENT || prefs.prefsEmail;
    if (!recipient) {
      return res.status(500).json({ error: '缺少收件人 WEEKLY_RECIPIENT' });
    }
    const from = process.env.WEEKLY_FROM || 'AI 资讯雷达 <onboarding@resend.dev>';

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: `AI 资讯雷达 · 本周精选 · ${new Date().toLocaleDateString('zh-CN')}`,
        html: core.buildEmailHTML(selected)
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(500).json({ error: 'Resend failed', detail: data });
    }
    return res.status(200).json({
      ok: true, emailId: data.id,
      articleCount: selected.length,
      failures
    });
  } catch (err) {
    console.error('[weekly]', err);
    return res.status(500).json({ error: err.message });
  }
};
