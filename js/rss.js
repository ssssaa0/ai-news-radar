/**
 * RSS 抓取模块
 * 降级链：rss2json API → allorigins 代理 → codetabs 代理（均原生 XML 解析）
 */

const RSS2JSON_API = 'https://api.rss2json.com/v1/api.json?rss_url=';
const XML_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest='
];

/**
 * 抓取单个 RSS 源 —— 主入口
 */
async function fetchRSS(source) {
  // 先尝试 rss2json（失败自动重试一次）
  let result = await fetchViaRss2Json(source);
  if (result && result.length > 0) return result;

  // 失败则依次尝试代理直接拉 XML（每个 10 秒超时）
  for (const proxy of XML_PROXIES) {
    result = await fetchViaRawXML(source, proxy);
    if (result && result.length > 0) return result;
  }
  console.warn(`[RSS] ${source.name} 所有抓取方式均失败`);
  return [];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 方式一：rss2json API（限流时重试一次）
 */
async function fetchViaRss2Json(source, isRetry) {
  try {
    const url = RSS2JSON_API + encodeURIComponent(source.url);
    const resp = await fetch(url);
    // 429/422/5xx 通常是匿名额度瞬时限流，等待后重试一次
    if (!isRetry && (resp.status === 429 || resp.status === 422 || resp.status >= 500)) {
      await sleep(1200);
      return fetchViaRss2Json(source, true);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.status || 'unknown');

    return data.items.map(item => ({
      id: item.guid || item.link,
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      author: item.author,
      summary: stripHTML(item.description || item.summary || ''),
      content: stripHTML(item.content || item.description || ''),
      thumbnail: item.thumbnail || extractThumbnail(item.description || ''),
      sourceId: source.id,
      sourceName: source.name,
      sourceColor: source.color
    }));
  } catch (err) {
    if (isRetry) console.warn(`[RSS] ${source.name} rss2json 重试仍失败:`, err.message);
    return null;
  }
}

/**
 * 代理拉取 XML + 原生 DOMParser 解析
 */
async function fetchViaRawXML(source, proxyBase) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = proxyBase + encodeURIComponent(source.url);
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    
    // 检查解析错误
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('XML 解析错误');

    const items = Array.from(doc.querySelectorAll('item, entry'));
    return items.map(item => {
      const getText = (tagNames) => {
        for (const tag of tagNames) {
          const el = item.getElementsByTagName(tag)[0];
          if (el && el.textContent) return el.textContent.trim();
        }
        return '';
      };

      const title = getText(['title']);
      const link = getText(['link']) || (item.querySelector('link')?.getAttribute('href') || '');
      const pubDate = getText(['pubDate', 'published', 'updated', 'dc:date']);
      const description = getText(['description', 'summary', 'content:encoded', 'content']);

      return {
        id: link,
        title,
        link,
        pubDate,
        author: getText(['author', 'creator']),
        summary: stripHTML(description),
        content: stripHTML(description),
        thumbnail: extractThumbnail(description),
        sourceId: source.id,
        sourceName: source.name,
        sourceColor: source.color
      };
    });
  } catch (err) {
    console.warn(`[RSS] ${source.name} 代理抓取失败(${proxyBase.split('//')[1].split('/')[0]}):`, err.message);
    return null;
  }
}

/**
 * 抓取所有启用的 RSS 源
 * 各源按 400ms 错峰启动（rss2json 匿名额度对突发并发敏感，实测此间隔最稳）
 */
async function fetchAllRSS() {
  const sources = getSourceSettings().filter(s => s.enabled);

  const results = await Promise.all(sources.map((source, i) =>
    new Promise(resolve => setTimeout(() => resolve(fetchRSS(source)), i * 400))
  ));

  // 合并并去重（按链接）
  const seen = new Set();
  const articles = [];
  results.flat().forEach(article => {
    if (article && !seen.has(article.link)) {
      seen.add(article.link);
      articles.push(article);
    }
  });

  // 对每篇文章进行标签匹配
  articles.forEach(article => {
    article.tags = matchTags(article);
  });

  // 按发布时间降序排列
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // 仅在拿到内容时写缓存，避免一次网络波动把好缓存覆盖为空
  if (articles.length > 0) cacheArticles(articles);
  return articles;
}

/**
 * 获取文章列表（优先用缓存，过期则重新抓取）
 */
async function getArticles(forceRefresh = false) {
  if (!forceRefresh && !isCacheExpired()) {
    const cached = getCachedArticles();
    if (cached.length > 0) return cached;
  }
  return fetchAllRSS();
}

/**
 * 从 HTML 中提取纯文本
 */
function stripHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * 从 HTML 中提取第一张图片作为缩略图
 */
function extractThumbnail(html) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}
