/**
 * localStorage 用户偏好存储
 */

const STORAGE_KEYS = {
  TAG_WEIGHTS: 'ainr_tag_weights',      // 标签权重偏好
  SOURCES: 'ainr_sources',              // 订阅源启用/禁用
  EMAIL_SUBSCRIPTION: 'ainr_email_sub',  // 邮件订阅设置
  CACHED_ARTICLES: 'ainr_cached_articles', // 已抓取的文章缓存
  CACHE_TIMESTAMP: 'ainr_cache_ts',      // 缓存时间戳
  SYNC_CONFIG: 'ainr_sync_config',       // Gist 云端同步配置
  CUSTOM_TAGS: 'ainr_custom_tags',       // 用户自定义标签
  MANUAL_TAGS: 'ainr_manual_tags'        // 手动给文章打的标签 { link: [tagId] }
};

// TAG_WEIGHTS 由 lib/core.js 统一提供

// 标签权重默认值
function getDefaultTagWeights() {
  return getDefaultWeights();
}

/**
 * 获取标签权重
 */
function getTagWeights() {
  const saved = localStorage.getItem(STORAGE_KEYS.TAG_WEIGHTS);
  if (saved) {
    const parsed = JSON.parse(saved);
    // 合并新增标签
    const defaults = getDefaultTagWeights();
    return { ...defaults, ...parsed };
  }
  return getDefaultTagWeights();
}

/**
 * 设置单个标签权重
 */
function setTagWeight(tagId, weight) {
  const weights = getTagWeights();
  weights[tagId] = weight;
  localStorage.setItem(STORAGE_KEYS.TAG_WEIGHTS, JSON.stringify(weights));
}

/**
 * 获取订阅源设置（启用/禁用）
 */
function getSourceSettings() {
  const saved = localStorage.getItem(STORAGE_KEYS.SOURCES);
  // core.js 的共享 SOURCES 不带 enabled，默认视为启用
  const normalize = src => ({ ...src, enabled: src.enabled !== false });
  if (saved) {
    const parsed = JSON.parse(saved);
    return DEFAULT_SOURCES.map(src => ({
      ...src,
      enabled: parsed[src.id] !== undefined ? !!parsed[src.id] : src.enabled !== false
    }));
  }
  return DEFAULT_SOURCES.map(normalize);
}

/**
 * 设置单个源的启用状态
 */
function setSourceEnabled(sourceId, enabled) {
  const sources = getSourceSettings();
  sources.forEach(src => {
    if (src.id === sourceId) src.enabled = enabled;
  });
  const settings = {};
  sources.forEach(src => { settings[src.id] = src.enabled; });
  localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(settings));
}

/**
 * 获取邮件订阅设置
 */
function getEmailSubscription() {
  const saved = localStorage.getItem(STORAGE_KEYS.EMAIL_SUBSCRIPTION);
  if (saved) {
    return JSON.parse(saved);
  }
  return { email: '', subscribed: false };
}

/**
 * 设置邮件订阅
 */
function setEmailSubscription(email, subscribed) {
  const data = { email, subscribed };
  localStorage.setItem(STORAGE_KEYS.EMAIL_SUBSCRIPTION, JSON.stringify(data));
}

/**
 * 缓存文章数据
 */
function cacheArticles(articles) {
  localStorage.setItem(STORAGE_KEYS.CACHED_ARTICLES, JSON.stringify(articles));
  localStorage.setItem(STORAGE_KEYS.CACHE_TIMESTAMP, Date.now().toString());
}

/**
 * 获取缓存文章
 */
function getCachedArticles() {
  const saved = localStorage.getItem(STORAGE_KEYS.CACHED_ARTICLES);
  if (saved) {
    return JSON.parse(saved);
  }
  return [];
}

/**
 * 获取缓存时间戳
 */
function getCacheTimestamp() {
  const ts = localStorage.getItem(STORAGE_KEYS.CACHE_TIMESTAMP);
  return ts ? parseInt(ts) : 0;
}

/**
 * 判断缓存是否过期（超过30分钟）
 */
function isCacheExpired() {
  const ts = getCacheTimestamp();
  if (!ts) return true;
  return (Date.now() - ts) > 30 * 60 * 1000;
}

// ========== 自定义标签 ==========

function getCustomTags() {
  const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_TAGS);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { /* ignore */ }
  }
  return [];
}

function saveCustomTags(tags) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_TAGS, JSON.stringify(tags));
}

/**
 * 新增自定义标签
 * @returns {{ok:boolean, tag?:object, message?:string}}
 */
function addCustomTag(name, category) {
  name = (name || '').trim();
  if (!name) return { ok: false, message: '标签名不能为空' };
  if (!CATEGORIES[category]) return { ok: false, message: '请选择一级分类' };

  // 同分类下 / 全局不允许重名
  const dup = getAllTags().find(t => t.name === name);
  if (dup) return { ok: false, message: '已存在同名标签：' + name };

  const tag = {
    id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category,
    custom: true,
    keywords: []
  };
  const all = getCustomTags();
  all.push(tag);
  saveCustomTags(all);
  registerTags([tag]); // 立即生效
  return { ok: true, tag };
}

/**
 * 删除自定义标签：同时清理权重与所有文章上的手动引用
 */
function removeCustomTag(tagId) {
  const all = getCustomTags();
  if (!all.find(t => t.id === tagId)) return false;
  saveCustomTags(all.filter(t => t.id !== tagId));
  unregisterTag(tagId);

  // 清权重
  const weights = getTagWeights();
  delete weights[tagId];
  localStorage.setItem(STORAGE_KEYS.TAG_WEIGHTS, JSON.stringify(weights));

  // 清手动引用
  const map = getManualTagMap();
  Object.keys(map).forEach(link => {
    map[link] = map[link].filter(id => id !== tagId);
    if (map[link].length === 0) delete map[link];
  });
  saveManualTagMap(map);
  return true;
}

/**
 * 启动时把本地自定义标签注册进全局标签体系
 */
function applyCustomTags() {
  registerTags(getCustomTags());
}

// ========== 手动文章标签 ==========

function getManualTagMap() {
  const saved = localStorage.getItem(STORAGE_KEYS.MANUAL_TAGS);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { /* ignore */ }
  }
  return {};
}

function saveManualTagMap(map) {
  localStorage.setItem(STORAGE_KEYS.MANUAL_TAGS, JSON.stringify(map));
}

function getArticleManualTags(link) {
  return getManualTagMap()[link] || [];
}

/**
 * 给文章切换一个手动标签
 */
function toggleArticleTag(link, tagId) {
  const map = getManualTagMap();
  const cur = map[link] || [];
  const i = cur.indexOf(tagId);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(tagId);
  if (cur.length === 0) delete map[link];
  else map[link] = cur;
  saveManualTagMap(map);
  return map[link] || [];
}

/**
 * 把手动标签合并进文章数组（自动标签 + 手动标签，去重，过滤已删除标签）
 */
function attachManualTags(articles) {
  const map = getManualTagMap();
  articles.forEach(a => {
    const manual = map[a.link] || [];
    const merged = [];
    (a.tags || []).concat(manual).forEach(id => {
      if (!TAGS[id]) return; // 已删除的标签直接丢弃
      if (!merged.includes(id)) merged.push(id);
    });
    a.tags = merged;
  });
  return articles;
}
