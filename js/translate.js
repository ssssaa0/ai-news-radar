/**
 * 英文标题自动翻译（中文显示）
 *
 * - 仅翻译不含中文、以拉丁字母为主的标题
 * - 译文持久化到 localStorage，同一标题只请求一次
 * - 双端点降级：Google gtx（免 Key、支持 CORS）→ MyMemory
 * - 错峰并发，避免触发限流
 */

const TRANSLATE_CACHE_KEY = 'ainr_translations';
const TRANSLATE_CACHE_MAX = 600;
const HAN_RE = /[一-鿿]/;
const LATIN_WORD_RE = /[A-Za-z]{3,}/;

let translationCache = null;
const pendingTitles = new Set();
let queueScheduled = false;
const queue = [];
// 每批翻译完成后通知所有渲染现场（页面上可能同时存在卡片、Feed 等多处标题）
const updateListeners = new Set();

function notifyListeners() {
  updateListeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
}

function loadCache() {
  if (translationCache) return translationCache;
  try {
    translationCache = JSON.parse(localStorage.getItem(TRANSLATE_CACHE_KEY) || '{}');
  } catch (e) {
    translationCache = {};
  }
  return translationCache;
}

function persistCache() {
  try {
    localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(translationCache));
  } catch (e) {
    // 配额满了就清理最旧的 20%
    const entries = Object.entries(translationCache).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    entries.slice(0, Math.ceil(entries.length * 0.2)).forEach(([k]) => delete translationCache[k]);
    localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(translationCache));
  }
}

/**
 * 是否需要翻译成中文：无汉字且含拉丁单词
 */
function needsTranslation(title) {
  if (!title) return false;
  if (HAN_RE.test(title)) return false;
  return LATIN_WORD_RE.test(title);
}

/**
 * 取已缓存的中文译文（没有返回 null）
 */
function getCachedTranslation(title) {
  const c = loadCache();
  return c[title] ? c[title].zh : null;
}

async function fetchWithTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogle(text, signal) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  // data[0] = [["译文段","原文段",...], ...]
  return data[0].map(seg => seg[0]).join('');
}

async function fetchMyMemory(text, signal) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN';
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const zh = data && data.responseData && data.responseData.translatedText;
  if (!zh || /MYMEMORY WARNING/i.test(zh)) throw new Error('MyMemory quota');
  return zh;
}

/**
 * 翻译单条标题（成功后写缓存）
 */
async function translateOne(title) {
  try {
    let zh = '';
    try {
      zh = await fetchWithTimeout(fetchGoogle.bind(null, title), 8000);
    } catch (e1) {
      zh = await fetchWithTimeout(fetchMyMemory.bind(null, title), 8000);
    }
    zh = (zh || '').trim();
    if (!zh) throw new Error('empty translation');
    loadCache()[title] = { zh, ts: Date.now() };
    // 容量控制（LRU）
    const keys = Object.keys(translationCache);
    if (keys.length > TRANSLATE_CACHE_MAX) {
      keys.sort((a, b) => (translationCache[a].ts || 0) - (translationCache[b].ts || 0));
      keys.slice(0, keys.length - TRANSLATE_CACHE_MAX).forEach(k => delete translationCache[k]);
    }
    persistCache();
    return zh;
  } catch (err) {
    return null;
  }
}

/**
 * 入队一批标题
 */
function enqueueTitles(titles) {
  titles.forEach(t => {
    if (!t || !needsTranslation(t)) return;
    if (getCachedTranslation(t)) return;
    if (pendingTitles.has(t)) return;
    pendingTitles.add(t);
    queue.push(t);
  });
  if (!queueScheduled) {
    queueScheduled = true;
    runQueue();
  }
}

async function runQueue() {
  const BATCH = 6;
  const INTERVAL = 250;
  while (queue.length) {
    const batch = queue.splice(0, BATCH);
    await Promise.all(batch.map(t => translateOne(t)));
    batch.forEach(t => pendingTitles.delete(t));
    notifyListeners();
    if (queue.length) await new Promise(r => setTimeout(r, INTERVAL));
  }
  queueScheduled = false;
}

/**
 * 扫描容器内所有带 data-i18n 标记的标题元素：
 * 有缓存 → 立即替换为双标题；无缓存 → 入队，翻译完成后批量替换
 *
 * @param {HTMLElement} root
 * @param {function(string,string):string} [wrapFn] 不同位置可用不同样式包装
 */
function translateWithin(root, wrapFn) {
  const els = Array.from(root.querySelectorAll('[data-i18n]'));
  const titlesByText = new Map();
  const pendingTexts = [];

  els.forEach(el => {
    const original = el.textContent.trim();
    if (!needsTranslation(original)) {
      el.removeAttribute('data-i18n');
      return;
    }
    const cached = getCachedTranslation(original);
    if (cached) {
      el.innerHTML = (wrapFn || defaultWrap)(cached, original);
      el.removeAttribute('data-i18n');
      return;
    }
    if (!titlesByText.has(original)) {
      titlesByText.set(original, []);
      pendingTexts.push(original);
    }
    titlesByText.get(original).push(el);
  });

  if (pendingTexts.length === 0) return;

  const update = () => {
    let alive = false;
    titlesByText.forEach((elements, original) => {
      const zh = getCachedTranslation(original);
      if (!zh) {
        if (elements.some(el => el.isConnected)) alive = true;
        return;
      }
      elements.forEach(el => {
        if (!el.isConnected) return;
        el.innerHTML = (wrapFn || defaultWrap)(zh, original);
        el.removeAttribute('data-i18n');
      });
    });
    if (!alive) updateListeners.delete(update);
  };
  updateListeners.add(update);
  enqueueTitles(pendingTexts);
}

function defaultWrap(zh, original) {
  return `<span class="title-zh">${escapeHtml(zh)}</span><span class="title-orig">${escapeHtml(original)}</span>`;
}
