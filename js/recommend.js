/**
 * 推荐排序算法
 *
 * 文章得分 = Σ（该文章命中的每个二级标签的用户权重）
 *           + 时间衰减因子（越新得分越高）
 * 打分公式复用 lib/core.js 的 scoreArticle，前后端完全一致
 */

const HOUR = 60 * 60 * 1000;

/**
 * 对文章列表进行推荐排序
 * @param {Array} articles - 文章数组
 * @returns {Object} { highScore: [...], lowScore: [...] } 高权重和降权分组
 */
function recommendArticles(articles) {
  const weights = getTagWeights();

  const scored = articles.map(article => ({
    ...article,
    score: scoreArticle(article, weights)
  }));

  // 分组
  const highScore = scored.filter(a => a.score >= 0);
  const lowScore = scored.filter(a => a.score < 0);

  // 各自按得分降序
  highScore.sort((a, b) => b.score - a.score);
  lowScore.sort((a, b) => b.score - a.score);

  return { highScore, lowScore };
}

/**
 * 每日小结：滚动24小时，按标签分组 Top 3
 */
function dailyDigest(articles) {
  const now = Date.now();
  const cutoff = now - 24 * HOUR;

  const recent = articles.filter(a => new Date(a.pubDate).getTime() >= cutoff);
  
  // 按标签分组
  const groups = {};
  recent.forEach(article => {
    (article.tags || []).forEach(tagId => {
      if (!groups[tagId]) groups[tagId] = [];
      groups[tagId].push(article);
    });
  });

  // 每个标签取 Top 3（按时间最新）
  const result = {};
  Object.keys(groups).forEach(tagId => {
    result[tagId] = groups[tagId].slice(0, 3);
  });

  return {
    total: recent.length,
    tagCount: Object.keys(result).length,
    groups: result
  };
}

/**
 * 周刊：最近7天，按一级分类分组
 */
function weeklyDigest(articles) {
  const now = Date.now();
  const cutoff = now - 7 * 24 * HOUR;

  const recent = articles.filter(a => new Date(a.pubDate).getTime() >= cutoff);

  // 按一级分类分组
  const categories = {};
  getAllCategories().forEach(cat => {
    categories[cat.name] = {};
  });

  recent.forEach(article => {
    (article.tags || []).forEach(tagId => {
      const tag = TAGS[tagId];
      if (!tag) return;
      const catName = CATEGORIES[tag.category].name;
      if (!categories[catName][tag.name]) {
        categories[catName][tag.name] = [];
      }
      categories[catName][tag.name].push(article);
    });
  });

  // 每个二级标签取 Top 5（按时间最新）
  Object.keys(categories).forEach(catName => {
    Object.keys(categories[catName]).forEach(tagName => {
      categories[catName][tagName] = categories[catName][tagName].slice(0, 5);
    });
  });

  // 统计标签热度
  const tagHotness = {};
  recent.forEach(a => {
    (a.tags || []).forEach(tagId => {
      tagHotness[tagId] = (tagHotness[tagId] || 0) + 1;
    });
  });
  const topTags = Object.entries(tagHotness)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ tag: TAGS[id], count }));

  return {
    total: recent.length,
    categoryCount: Object.keys(categories).filter(k => Object.keys(categories[k]).length > 0).length,
    topTags,
    categories
  };
}
