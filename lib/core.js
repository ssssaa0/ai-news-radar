/**
 * AI 资讯雷达 · 共享核心库（UMD）
 * 浏览器端：<script src="lib/core.js"></script> 挂载全局
 * Node 端：const AINR = require('./lib/core.js')
 *
 * 包含：标签体系 / 订阅源 / 标签匹配 / 推荐打分 / RSS 抓取(Node) / 邮件模板
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AINR = api;
    // 浏览器端暴露为顶层全局，供其他脚本直接使用
    Object.assign(root, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ========== 权重常量 ==========
  const TAG_WEIGHTS = { FOCUS: 2, DEFAULT: 0, IGNORE: -2 };

  // ========== 一级分类 ==========
  const CATEGORIES = {
    llm: { name: '大模型动态', color: '#0369A1', tags: [] },
    app: { name: 'AI 应用', color: '#7C3AED', tags: [] },
    biz: { name: '行业与商业', color: '#B45309', tags: [] },
    research: { name: '技术研究', color: '#BE123C', tags: [] }
  };

  // ========== 14 个二级标签 + 关键词词典 ==========
  const TAGS = {
    llm_code: { id: 'llm_code', name: '代码能力', category: 'llm',
      keywords: ['Cursor', 'Copilot', 'code generation', '代码生成', '代码能力', 'HumanEval', 'MBPP', 'SWE-bench', 'coding benchmark', 'code agent', '编程', 'Devin'] },
    llm_multimodal: { id: 'llm_multimodal', name: '多模态', category: 'llm',
      keywords: ['多模态', 'multimodal', 'text-to-image', 'text to image', '图像生成', '视频生成', 'text-to-video', '视觉理解', 'vision-language', 'speech', '语音', 'audio', 'GPT-4V', 'Sora', 'Runway', 'Stable Diffusion', 'Midjourney', 'FLUX'] },
    llm_reasoning: { id: 'llm_reasoning', name: '推理与思维链', category: 'llm',
      keywords: ['reasoning', '推理', '思维链', 'chain of thought', 'CoT', 'o1', 'o3', 'test-time', '测试时计算', 'deep reasoning', '深度推理', 'GRPO', 'RLHF', 'reinforcement learning from human'] },
    llm_open: { id: 'llm_open', name: '开源模型', category: 'llm',
      keywords: ['Llama', 'llama', 'Qwen', 'qwen', 'DeepSeek', 'deepseek', 'Mistral', 'mistral', 'open source', '开源', 'open-source', 'Hugging Face', 'huggingface', 'Falcon', 'Gemma', 'Ollama', '本地模型'] },
    llm_api: { id: 'llm_api', name: 'API 与平台', category: 'llm',
      keywords: ['OpenAI API', 'Anthropic API', 'Google API', 'API更新', 'platform update', '平台更新', 'GPT-4o', 'Claude', 'Gemini', 'Azure AI', 'Amazon Bedrock', 'AWS AI', 'model API'] },

    app_productivity: { id: 'app_productivity', name: '生产力工具', category: 'app',
      keywords: ['Notion AI', 'Microsoft Copilot', '办公', '效率', 'productivity', '笔记', '搜索', 'AI assistant', 'AI助手', 'workflow', '工作流', 'Otter', 'Fireflies'] },
    app_creative: { id: 'app_creative', name: '内容创作', category: 'app',
      keywords: ['写作', 'writing', 'Jasper', 'Copy.ai', 'Pika', 'Kling', '可灵', 'Suno', 'Udio', '音乐生成', '视频创作', 'design tool', 'Canva AI', 'Adobe Firefly'] },
    app_vertical: { id: 'app_vertical', name: '垂直行业', category: 'app',
      keywords: ['医疗 AI', 'medical AI', 'AI医疗', '金融 AI', 'financial AI', 'AI金融', '法律 AI', 'legal AI', 'AI法律', '教育 AI', 'education AI', 'AI教育', 'AI drug', '药物发现', '医疗影像'] },

    biz_funding: { id: 'biz_funding', name: '融资与并购', category: 'biz',
      keywords: ['融资', 'funding', 'raises', 'raised', '并购', 'acquisition', 'acquires', '收购', 'IPO', '上市', '估值', 'valuation', 'investment', '投资', 'Series A', 'Series B', 'venture capital'] },
    biz_policy: { id: 'biz_policy', name: '政策与监管', category: 'biz',
      keywords: ['监管', 'regulation', '政策', 'policy', 'EU AI Act', 'AI法案', '合规', 'compliance', '法案', '立法', '政府', 'government', 'White House', '白宫'] },
    biz_launch: { id: 'biz_launch', name: '产品发布', category: 'biz',
      keywords: ['发布', 'launch', 'launches', 'released', '上线', 'new product', '产品发布', 'version', '版本', '重大更新', 'major update', '下线', 'shutdown', '下架'] },

    research_arch: { id: 'research_arch', name: '新架构/新方法', category: 'research',
      keywords: ['新架构', 'architecture', 'MoE', 'mixture of experts', 'transformer', 'Transformer', 'diffusion', '扩散模型', 'reinforcement learning', '训练方法', 'training method', 'scaling law', 'embedding', 'Retrieval-Augmented', 'RAG', 'long context', '长上下文'] },
    research_agent: { id: 'research_agent', name: 'Agent 与工具链', category: 'research',
      keywords: ['Agent', 'agent', 'MCP', 'Model Context Protocol', 'tool use', 'tool calling', '工具调用', 'LangChain', 'LlamaIndex', 'AutoGPT', 'BabyAGI', 'multi-agent', '多智能体', 'function calling', 'computer use'] },
    research_benchmark: { id: 'research_benchmark', name: '评测基准', category: 'research',
      keywords: ['benchmark', 'benchmarking', '评测', '评测基准', 'leaderboard', '排行榜', 'MMLU', 'GSM8K', 'ARC', 'TruthfulQA', 'HellaSwag', 'Open LLM Leaderboard', 'evaluation', 'eval'] }
  };

  // 挂载标签到分类
  Object.keys(TAGS).forEach(tagId => {
    CATEGORIES[TAGS[tagId].category].tags.push(tagId);
  });

  // ========== 订阅源（前后端共用，均为 2026-10 验证可用的源）==========
  const SOURCES = [
    { id: 'qbitai', name: '量子位', category: '大模型动态 / AI应用', color: '#0369A1',
      url: 'https://www.qbitai.com/feed' },
    { id: 'openai', name: 'OpenAI', category: '大模型动态', color: '#0369A1',
      url: 'https://openai.com/blog/rss.xml' },
    { id: 'deepmind', name: 'Google DeepMind', category: '技术研究', color: '#BE123C',
      url: 'https://deepmind.google/blog/rss.xml' },
    { id: 'huggingface', name: 'Hugging Face', category: '大模型动态', color: '#0369A1',
      url: 'https://huggingface.co/blog/feed.xml' },
    { id: 'techcrunch', name: 'TechCrunch AI', category: '行业与商业', color: '#B45309',
      url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { id: 'arstechnica', name: 'Ars Technica AI', category: 'AI 应用', color: '#7C3AED',
      url: 'https://arstechnica.com/ai/feed/' },
    { id: 'mittechreview', name: 'MIT Tech Review', category: '技术研究', color: '#BE123C',
      url: 'https://www.technologyreview.com/feed/' },
    { id: 'arxiv_csai', name: 'arXiv cs.AI', category: '技术研究', color: '#BE123C',
      url: 'https://export.arxiv.org/rss/cs.AI' }
  ];

  // ========== 标签匹配（前后端共用，同一套词典）==========
  function matchTags(article) {
    const text = `${article.title || ''} ${article.summary || ''} ${article.description || ''} ${article.content || ''}`.toLowerCase();
    const titleText = (article.title || '').toLowerCase();
    const scores = {};
    Object.keys(TAGS).forEach(tagId => {
      let score = 0;
      TAGS[tagId].keywords.forEach(kw => {
        const k = kw.toLowerCase();
        if (text.includes(k)) score += titleText.includes(k) ? 2 : 1;
      });
      if (score > 0) scores[tagId] = score;
    });
    return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  }

  function getTagInfo(tagId) { return TAGS[tagId]; }
  function getCategoryInfo(categoryId) { return CATEGORIES[categoryId]; }
  function getAllTags() { return Object.values(TAGS); }
  function getAllCategories() { return Object.values(CATEGORIES); }
  function getDefaultWeights() {
    const w = {};
    Object.keys(TAGS).forEach(id => { w[id] = TAG_WEIGHTS.DEFAULT; });
    return w;
  }

  /**
   * 注册用户自定义标签（动态合并进同一份标签体系）
   * @param {Array<{id:string,name:string,category:string}>} list
   */
  function registerTags(list) {
    (list || []).forEach(tag => {
      if (!tag || !tag.id || !tag.name || !CATEGORIES[tag.category]) return;
      TAGS[tag.id] = {
        id: tag.id,
        name: tag.name,
        category: tag.category,
        custom: true,
        keywords: Array.isArray(tag.keywords) ? tag.keywords : []
      };
      if (!CATEGORIES[tag.category].tags.includes(tag.id)) {
        CATEGORIES[tag.category].tags.push(tag.id);
      }
    });
  }

  /** 移除自定义标签（内置标签受保护，不可删） */
  function unregisterTag(tagId) {
    const tag = TAGS[tagId];
    if (!tag || !tag.custom) return false;
    const arr = CATEGORIES[tag.category].tags;
    const i = arr.indexOf(tagId);
    if (i >= 0) arr.splice(i, 1);
    delete TAGS[tagId];
    return true;
  }

  // ========== 推荐打分（与前端 recommend.js 完全一致）==========
  const HOUR = 60 * 60 * 1000;

  function scoreArticle(article, weights) {
    let tagScore = 0;
    (article.tags || []).forEach(tagId => {
      tagScore += weights[tagId] !== undefined ? weights[tagId] : TAG_WEIGHTS.DEFAULT;
    });
    // 时间因子只用于同档文章间的新鲜度排序（0~1.5，3 天衰减到 0），
    // 不能盖过「不关注(-2)」「关注(+2)」的权重信号
    const pubTime = new Date(article.pubDate).getTime();
    const hoursAgo = (Date.now() - pubTime) / HOUR;
    const timeScore = Math.max(0, 1.5 - hoursAgo / 48);
    return tagScore + timeScore;
  }

  /**
   * 周刊选稿：打分 → 过滤掉「不关注」(score<0) → 按分数降序
   * 邮件没有折叠区，负分文章直接不出现（符合 PRD「降权或不出现」）
   */
  function selectForWeekly(articles, weights, cap) {
    return articles
      .map(a => Object.assign({}, a, { score: scoreArticle(a, weights) }))
      .filter(a => a.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, cap || 60);
  }

  // ========== Node / 浏览器通用：RSS XML 解析与抓取 ==========
  // 浏览器环境同样导出（便于复用与测试）；直接 fetch 在浏览器受 CORS 限制，
  // 前端使用 js/rss.js 的 rss2json 方案，Node 端（Actions）使用 fetchAllArticles。

  function decodeEntities(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function parseRSSXML(xml, source) {
    const items = [];
    const blockRegex = /<(item|entry)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = blockRegex.exec(xml)) !== null) {
      const block = m[3];
      const get = (tag) => {
        const r = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(block);
        return r ? decodeEntities(r[2]) : '';
      };
      // Atom 的 <link href="..."/>
      let atomLink = '';
      const linkTag = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/.exec(block);
      if (linkTag) atomLink = linkTag[1];

      const title = get('title');
      const link = (get('link') || atomLink || '').trim();
      const dateStr = get('pubDate') || get('published') || get('updated') || get('date');
      const description = get('description') || get('summary') || get('content');
      if (!title || !link) continue;

      items.push({
        id: link,
        title,
        link,
        pubDate: dateStr ? new Date(dateStr) : new Date(0),
        summary: description.slice(0, 400),
        description,
        sourceId: source.id,
        sourceName: source.name,
        sourceColor: source.color
      });
    }
    return items;
  }

  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
      return await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchSource(source) {
    const UA = 'Mozilla/5.0 (compatible; AINewsRadar/1.0; +https://github.com/)';

    // 方式一：直接拉 RSS XML（Node 无 CORS 限制）
    try {
      const resp = await fetchWithTimeout(source.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' } });
      if (resp.ok) {
        const items = parseRSSXML(await resp.text(), source);
        if (items.length) return items;
      }
    } catch (e) { /* 继续降级 */ }

    // 方式二：rss2json
    try {
      const u = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(source.url);
      const resp = await fetchWithTimeout(u, { headers: { 'User-Agent': UA } });
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'ok') {
          return data.items.map(it => ({
            id: it.guid || it.link, title: it.title, link: it.link,
            pubDate: new Date(it.pubDate),
            summary: decodeEntities(it.description || '').slice(0, 400),
            description: decodeEntities(it.content || it.description || ''),
            sourceId: source.id, sourceName: source.name, sourceColor: source.color
          }));
        }
      }
    } catch (e) { /* 继续降级 */ }

    // 方式三：allorigins 代理
    try {
      const u = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(source.url);
      const resp = await fetchWithTimeout(u, { headers: { 'User-Agent': UA } });
      if (resp.ok) {
        const items = parseRSSXML(await resp.text(), source);
        if (items.length) return items;
      }
    } catch (e) { /* 继续降级 */ }

    // 方式四：codetabs 代理
    try {
      const u = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(source.url);
      const resp = await fetchWithTimeout(u, { headers: { 'User-Agent': UA } });
      if (resp.ok) {
        const items = parseRSSXML(await resp.text(), source);
        if (items.length) return items;
      }
    } catch (e) { /* 全部失败 */ }

    return [];
  }

  /**
   * 抓取最近 N 天的全部文章（Node 端使用）
   * @param {object} opts { days:7, enabledIds: ['qbitai',...] }
   */
  async function fetchAllArticles(opts) {
    opts = opts || {};
    const days = opts.days || 7;
    const enabled = opts.enabledIds || null;
    const sources = enabled ? SOURCES.filter(s => enabled.includes(s.id)) : SOURCES;

    const results = await Promise.all(sources.map(s =>
      fetchSource(s).then(items => ({ source: s, items }))
    ));

    const failures = results.filter(r => r.items.length === 0).map(r => r.source.name);
    const seen = new Set();
    const articles = [];
    results.forEach(r => r.items.forEach(a => {
      if (seen.has(a.link)) return;
      seen.add(a.link);
      a.tags = matchTags(a);
      articles.push(a);
    }));

    const cutoff = Date.now() - days * 24 * HOUR;
    const recent = articles
      .filter(a => a.pubDate && a.pubDate.getTime() >= cutoff)
      .sort((a, b) => b.pubDate - a.pubDate);

    return { articles: recent, failures, total: articles.length };
  }

  // ========== 邮件 HTML 模板 ==========
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildEmailHTML(articles) {
    // 按一级分类 → 二级标签分组
    const groups = {};
    getAllCategories().forEach(cat => { groups[cat.name] = {}; });

    articles.forEach(a => {
      (a.tags || []).forEach(tagId => {
        const tag = TAGS[tagId];
        if (!tag) return;
        const catName = CATEGORIES[tag.category].name;
        if (!groups[catName][tag.name]) groups[catName][tag.name] = [];
        groups[catName][tag.name].push(a);
      });
    });

    let sections = '';
    getAllCategories().forEach(cat => {
      const subTags = groups[cat.name];
      const tagNames = Object.keys(subTags);
      if (!tagNames.length) return;

      let subSections = '';
      tagNames.forEach(tagName => {
        const list = subTags[tagName].sort((a, b) => b.score - a.score).slice(0, 5);
        const rows = list.map(a => {
          const d = a.pubDate instanceof Date ? a.pubDate : new Date(a.pubDate);
          const dateLabel = isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
          return `
          <tr><td style="padding:9px 0;border-bottom:1px solid #E7E5E4;">
            <a href="${esc(a.link)}" style="color:#1C1917;text-decoration:none;font-weight:500;font-size:14px;line-height:1.5;">${esc(a.title)}</a>
            <div style="font-size:12px;color:#78716C;margin-top:3px;">${esc(a.sourceName)}${dateLabel ? ' · ' + dateLabel : ''}${a.summary ? ' · ' + esc(a.summary.slice(0, 90)) : ''}</div>
          </td></tr>`;
        }).join('');

        subSections += `
          <div style="margin:16px 0 6px;">
            <span style="color:${cat.color};font-weight:600;font-size:14px;">${esc(tagName)}</span>
            <span style="color:#A8A29E;font-size:12px;margin-left:6px;">${subTags[tagName].length} 篇</span>
          </div>
          <table width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
      });

      sections += `
        <div style="margin-bottom:28px;">
          <div style="border-left:4px solid ${cat.color};padding-left:12px;margin-bottom:8px;">
            <h2 style="margin:0;color:${cat.color};font-size:18px;">${esc(cat.name)}</h2>
          </div>
          ${subSections}
        </div>`;
    });

    const dateStr = new Date().toLocaleDateString('zh-CN');
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F5F5F4;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#FFFFFF;">
  <tr><td style="padding:28px 24px 16px;text-align:center;border-bottom:1px solid #E7E5E4;">
    <div style="display:inline-block;background:#0F766E;color:#fff;padding:6px 14px;border-radius:6px;font-weight:700;font-size:14px;">AI 资讯雷达</div>
    <h1 style="margin:16px 0 4px;font-size:22px;color:#1C1917;">本周精选 · AI 周刊</h1>
    <div style="color:#78716C;font-size:13px;">${dateStr} 发送 · 基于你的标签偏好排序 · 共 ${articles.length} 篇</div>
  </td></tr>
  <tr><td style="padding:24px;">
    ${sections || '<div style="text-align:center;color:#78716C;padding:40px 0;">本周暂无匹配你偏好的资讯</div>'}
  </td></tr>
  <tr><td style="padding:20px 24px;border-top:1px solid #E7E5E4;text-align:center;color:#A8A29E;font-size:12px;">
    AI 资讯雷达 · 每周一 09:00（北京时间）自动发送<br>
    可在网页「订阅源 → 云端同步」中更新你的标签偏好
  </td></tr>
</table>
</body></html>`;
  }

  // ========== 导出 ==========
  return {
    TAG_WEIGHTS,
    CATEGORIES,
    TAGS,
    SOURCES,
    DEFAULT_SOURCES: SOURCES, // 浏览器端兼容名
    GIST_FILENAME: 'ai-news-radar-prefs.json',
    matchTags,
    getTagInfo,
    getCategoryInfo,
    getAllTags,
    getAllCategories,
    getDefaultWeights,
    registerTags,
    unregisterTag,
    scoreArticle,
    selectForWeekly,
    parseRSSXML,
    fetchAllArticles,
    buildEmailHTML,
    esc
  };
});
