/**
 * 主应用：页面渲染 + 状态管理
 */

let currentTab = 'dashboard';
let allArticles = [];

// Dashboard / 推荐只展示最近 7 天（与周刊窗口一致，不长期堆积旧资讯）
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * 近 7 天可见文章
 */
function visibleArticles() {
  const cutoff = Date.now() - WINDOW_MS;
  return allArticles.filter(a => new Date(a.pubDate).getTime() >= cutoff);
}

/**
 * 页面初始化
 */
async function init() {
  applyCustomTags(); // 先注册用户自定义标签，再渲染
  bindNavTabs();
  bindSearch();
  bindRefresh();
  
  // 先加载缓存
  allArticles = attachManualTags(getCachedArticles());
  
  // 渲染当前 tab
  render();
  
  // 后台刷新数据
  try {
    const articles = await fetchAllRSS();
    if (articles.length > 0) {
      allArticles = attachManualTags(articles);
    } else if (allArticles.length === 0) {
      // 所有源都失败且无缓存
      showLoadError();
      return;
    }
    if (document.getElementById('searchInput').value.trim() === '') {
      render();
    }
  } catch (err) {
    console.error('[Init] 加载失败:', err);
    if (allArticles.length === 0) showLoadError();
  }
}

function showLoadError() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">😅</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;">所有 RSS 源暂时无法连接</div>
      <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;">
        可能是网络问题或 RSS 源暂时不可用，请稍后刷新重试
      </div>
      <button class="btn-primary" onclick="location.reload()">重新加载</button>
    </div>`;
}

/**
 * 绑定导航 Tab 切换
 */
function bindNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      render();
    });
  });
}

/**
 * 绑定搜索
 */
function bindSearch() {
  const input = document.getElementById('searchInput');
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (input.value.trim()) {
        renderSearch();
      } else {
        render();
      }
    }, 200);
  });
}

/**
 * 绑定刷新按钮
 */
function bindRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.addEventListener('click', async () => {
    btn.classList.add('loading');
    const articles = await fetchAllRSS();
    allArticles = attachManualTags(articles);
    btn.classList.remove('loading');
    showToast('已刷新所有资讯');
    render();
  });
}

/**
 * 主渲染函数
 */
function render() {
  const app = document.getElementById('app');
  
  if (!allArticles || allArticles.length === 0) {
    app.innerHTML = `
      <div class="loading">
        <div class="empty-state-icon">⏳</div>
        <div>正在抓取 RSS 资讯，请稍候...</div>
      </div>`;
    return;
  }

  switch (currentTab) {
    case 'dashboard': renderDashboard(app); break;
    case 'recommend': renderRecommend(app); break;
    case 'digest': renderDigest(app); break;
    case 'tags': renderTagManage(app); break;
    case 'sources': renderSourceManage(app); break;
  }

  // 英文标题自动翻译（所有视图统一处理）
  translateWithin(app);
}

/**
 * ========== Dashboard 全部资讯 ==========
 */
function renderDashboard(app) {
  const articles = visibleArticles();
  app.innerHTML = `
    <div class="page-title">全部资讯 <span style="font-size:14px;color:var(--color-text-secondary);font-weight:normal;">近 ${WINDOW_DAYS} 天 · ${articles.length} 条</span></div>
    ${articles.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">📭</div><div>近 ${WINDOW_DAYS} 天暂无资讯，点击右上角「刷新」重试</div></div>`
      : `<div class="card-grid" id="cardGrid"></div>`}`;

  const grid = document.getElementById('cardGrid');
  if (grid) {
    articles.forEach(article => grid.appendChild(createArticleCard(article)));
    bindTagAddButtons(grid);
  }
}

/**
 * 标签 HTML（手动标签有区分样式）
 */
function tagsHTML(article) {
  const manual = getArticleManualTags(article.link);
  return (article.tags || []).map(tagId => {
    const tag = getTagInfo(tagId);
    if (!tag) return '';
    const manualCls = manual.includes(tagId) ? ' tag-manual' : '';
    return `<span class="tag tag-${tag.category}${manualCls}">${escapeHtml(tag.name)}</span>`;
  }).join('');
}

/**
 * 创建文章卡片（无缩略图，顶部分类色条）
 */
function createArticleCard(article) {
  const card = document.createElement('a');
  card.className = 'article-card';
  card.href = article.link;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  // 顶部分类色条：取第一个标签所属分类颜色
  let barColor = '#D6D3D1';
  if (article.tags && article.tags.length > 0) {
    const tag = getTagInfo(article.tags[0]);
    if (tag) barColor = CATEGORIES[tag.category].color;
  }

  const summary = article.summary ? article.summary.slice(0, 120) : '';

  card.innerHTML = `
    <div class="card-topbar" style="background:${barColor}"></div>
    <div class="card-content">
      <div class="card-title" data-i18n>${escapeHtml(article.title)}</div>
      <div class="card-summary">${escapeHtml(summary)}</div>
      <div class="card-tags">
        ${tagsHTML(article)}
        <span class="tag-add" title="给这篇文章打标签">＋ 标签</span>
      </div>
      <div class="card-meta">
        <span class="source-dot" style="background:${article.sourceColor}"></span>
        <span>${escapeHtml(article.sourceName)}</span>
        <span>·</span>
        <span>${formatTime(article.pubDate)}</span>
      </div>
    </div>`;

  return card;
}

/**
 * 绑定容器内所有「＋ 标签」按钮
 */
function bindTagAddButtons(container) {
  container.querySelectorAll('.tag-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('[data-link]') || btn.closest('a');
      const link = card.href || card.getAttribute('href');
      const article = allArticles.find(a => a.link === link);
      if (article) openTagPicker(article);
    });
  });
}

/**
 * ========== 个人推荐 Feed ==========
 */
function renderRecommend(app) {
  const { highScore, lowScore } = recommendArticles(visibleArticles());
  const weights = getTagWeights();

  // 统计权重分布
  let focusCount = 0, ignoreCount = 0;
  Object.values(weights).forEach(w => {
    if (w === TAG_WEIGHTS.FOCUS) focusCount++;
    if (w === TAG_WEIGHTS.IGNORE) ignoreCount++;
  });

  app.innerHTML = `
    <div class="page-title">个人推荐</div>
    <div class="page-subtitle">
      近 ${WINDOW_DAYS} 天 · 按标签权重排序 · 关注 ${focusCount} 个标签 · 不关注 ${ignoreCount} 个标签
    </div>
    ${highScore.length === 0 && lowScore.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">📭</div><div>近 ${WINDOW_DAYS} 天暂无资讯</div></div>`
      : `<div class="feed-list" id="feedList"></div>`}
    ${lowScore.length > 0 ? `
      <div class="low-score-section">
        <button class="low-score-toggle" id="lowScoreToggle">
          <span class="arrow">▶</span>
          不太关心（${lowScore.length} 条降权文章）
        </button>
        <div class="low-score-content" id="lowScoreContent"></div>
      </div>` : ''}`;

  const feedList = document.getElementById('feedList');
  if (feedList) {
    highScore.forEach(article => feedList.appendChild(createFeedItem(article)));
    bindTagAddButtons(feedList);
  }

  // 降权区
  if (lowScore.length > 0) {
    const toggle = document.getElementById('lowScoreToggle');
    const content = document.getElementById('lowScoreContent');
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      content.classList.toggle('open');
    });
    lowScore.forEach(article => content.appendChild(createFeedItem(article)));
    bindTagAddButtons(content);
  }
}

/**
 * 创建 Feed 条目
 */
function createFeedItem(article) {
  const item = document.createElement('a');
  item.className = 'feed-item';
  item.href = article.link;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';

  // 取第一个标签的颜色
  let barColor = article.sourceColor;
  if (article.tags && article.tags.length > 0) {
    const tag = getTagInfo(article.tags[0]);
    if (tag) barColor = CATEGORIES[tag.category].color;
  }

  const tagHtml = tagsHTML(article);
  const summary = article.summary ? article.summary.slice(0, 100) : '';

  item.innerHTML = `
    <div class="feed-color-bar" style="background:${barColor}"></div>
    <div class="feed-content">
      <div class="feed-title" data-i18n>${escapeHtml(article.title)}</div>
      <div class="feed-meta">
        <span class="source-dot" style="background:${article.sourceColor}"></span>
        <span>${escapeHtml(article.sourceName)}</span>
        <span>·</span>
        <span>${formatTime(article.pubDate)}</span>
        ${tagHtml ? `<span>·</span>${tagHtml}` : ''}
        <span class="tag-add" title="给这篇文章打标签">＋</span>
      </div>
      <div class="feed-summary">${escapeHtml(summary)}</div>
    </div>`;

  return item;
}

/**
 * ========== 小结页面 ==========
 */
function renderDigest(app) {
  const daily = dailyDigest(allArticles);
  const weekly = weeklyDigest(allArticles);

  app.innerHTML = `
    <div class="page-title">资讯小结</div>
    
    <!-- 每日小结 -->
    <div class="digest-header">
      <div style="font-size:18px;font-weight:600;">📅 每日小结（滚动 24 小时）</div>
      <div class="digest-stats">
        <div class="digest-stat">
          <div class="digest-stat-value">${daily.total}</div>
          <div class="digest-stat-label">条资讯</div>
        </div>
        <div class="digest-stat">
          <div class="digest-stat-value">${daily.tagCount}</div>
          <div class="digest-stat-label">个标签覆盖</div>
        </div>
      </div>
    </div>

    <div id="dailyDigestContent"></div>

    <!-- 周刊 -->
    <div class="digest-header" style="margin-top:24px;">
      <div style="font-size:18px;font-weight:600;">📆 本周精选（最近 7 天）</div>
      <div class="digest-stats">
        <div class="digest-stat">
          <div class="digest-stat-value">${weekly.total}</div>
          <div class="digest-stat-label">条资讯</div>
        </div>
        <div class="digest-stat">
          <div class="digest-stat-value">${weekly.categoryCount}</div>
          <div class="digest-stat-label">个分类</div>
        </div>
      </div>
      ${weekly.topTags.length > 0 ? `
        <div style="margin-top:12px;font-size:13px;color:var(--color-text-secondary);">
          <strong>🔥 本周热门标签：</strong>
          ${weekly.topTags.map(t => `<span class="tag tag-${t.tag.category}" style="margin-left:4px;">${t.tag.name} (${t.count})</span>`).join('')}
        </div>` : ''}
    </div>

    <div id="weeklyDigestContent"></div>`;

  // 渲染每日小结
  renderDailyDigestContent(daily);
  // 渲染周刊
  renderWeeklyDigestContent(weekly);
}

/**
 * 渲染每日小结内容
 */
function renderDailyDigestContent(daily) {
  const container = document.getElementById('dailyDigestContent');
  const entries = Object.entries(daily.groups);
  
  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div>最近 24 小时暂无资讯</div></div>`;
    return;
  }

  // 按一级分类排序
  const sorted = entries.sort((a, b) => {
    const catA = CATEGORIES[getTagInfo(a[0]).category].name;
    const catB = CATEGORIES[getTagInfo(b[0]).category].name;
    return catA.localeCompare(catB);
  });

  container.innerHTML = sorted.map(([tagId, articles]) => {
    const tag = getTagInfo(tagId);
    const catColor = CATEGORIES[tag.category].color;
    const items = articles.slice(0, 3).map(a => `
      <div class="digest-article-item">
        <a class="digest-article-link" href="${a.link}" target="_blank" rel="noopener noreferrer" data-i18n>${escapeHtml(a.title)}</a>
        <div class="digest-article-meta">
          <span style="color:${a.sourceColor}">●</span> ${escapeHtml(a.sourceName)} · ${formatTime(a.pubDate)}
        </div>
      </div>`).join('');

    return `
      <div class="digest-section">
        <div class="digest-section-header">
          <div class="color-indicator" style="width:12px;height:12px;border-radius:3px;background:${catColor}"></div>
          <span class="digest-section-title">${tag.name}</span>
          <span class="digest-section-count">${articles.length}</span>
        </div>
        <div style="padding:4px 20px 12px;">${items}</div>
      </div>`;
  }).join('');
}

/**
 * 渲染周刊内容
 */
function renderWeeklyDigestContent(weekly) {
  const container = document.getElementById('weeklyDigestContent');
  const catNames = Object.keys(weekly.categories).filter(k => Object.keys(weekly.categories[k]).length > 0);

  if (catNames.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div>本周暂无资讯</div></div>`;
    return;
  }

  container.innerHTML = catNames.map(catName => {
    const catObj = getAllCategories().find(c => c.name === catName);
    const color = catObj ? catObj.color : '#666';
    const subTags = weekly.categories[catName];

    const subSections = Object.entries(subTags).map(([tagName, articles]) => {
      const items = articles.slice(0, 5).map(a => `
        <div class="digest-article-item">
          <a class="digest-article-link" href="${a.link}" target="_blank" rel="noopener noreferrer" data-i18n>${escapeHtml(a.title)}</a>
          <div class="digest-article-meta">
            <span style="color:${a.sourceColor}">●</span> ${escapeHtml(a.sourceName)} · ${formatTime(a.pubDate)}
          </div>
        </div>`).join('');

      return `
        <div style="margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;color:${color}">${tagName}（${articles.length}）</div>
          ${items}
        </div>`;
    }).join('');

    return `
      <div class="digest-section">
        <div class="digest-section-header">
          <div class="color-indicator" style="width:12px;height:12px;border-radius:3px;background:${color}"></div>
          <span class="digest-section-title" style="color:${color}">${catName}</span>
        </div>
        <div style="padding:16px 20px;">${subSections}</div>
      </div>`;
  }).join('');
}

/**
 * ========== 标签管理 ==========
 */
function renderTagManage(app) {
  const weights = getTagWeights();

  // 计算每个标签在近 7 天的文章数
  const tagCounts = {};
  visibleArticles().forEach(article => {
    (article.tags || []).forEach(tagId => {
      tagCounts[tagId] = (tagCounts[tagId] || 0) + 1;
    });
  });

  let html = `<div class="page-title">标签管理</div>
    <div class="page-subtitle">标记你感兴趣的方向，也可以在每个分类下新增自己的标签；个人推荐和邮件周刊都会参考你的偏好</div>`;

  getAllCategories().forEach(cat => {
    html += `
      <div class="tag-manage-group">
        <div class="tag-manage-header">
          <div class="color-indicator" style="background:${cat.color}"></div>
          <span class="tag-manage-title">${cat.name}</span>
        </div>`;

    cat.tags.forEach(tagId => {
      const tag = TAGS[tagId];
      const currentWeight = weights[tagId] || TAG_WEIGHTS.DEFAULT;
      const count = tagCounts[tagId] || 0;

      html += `
        <div class="tag-manage-item">
          <div class="tag-manage-item-info">
            <div class="tag-manage-item-name">
              ${escapeHtml(tag.name)}
              ${tag.custom ? '<span class="custom-tag-badge">自定义</span>' : ''}
            </div>
            <div class="tag-manage-item-count">${count} 篇相关文章</div>
          </div>
          <div class="weight-buttons" data-tag="${tagId}">
            <button class="weight-btn ${currentWeight === TAG_WEIGHTS.FOCUS ? 'active active-focus' : ''}" data-weight="${TAG_WEIGHTS.FOCUS}">关注</button>
            <button class="weight-btn ${currentWeight === TAG_WEIGHTS.DEFAULT ? 'active active-default' : ''}" data-weight="${TAG_WEIGHTS.DEFAULT}">默认</button>
            <button class="weight-btn ${currentWeight === TAG_WEIGHTS.IGNORE ? 'active active-ignore' : ''}" data-weight="${TAG_WEIGHTS.IGNORE}">不关注</button>
            ${tag.custom ? `<button class="tag-delete-btn" data-delete-tag="${tagId}" title="删除这个自定义标签">×</button>` : ''}
          </div>
        </div>`;
    });

    // 组内新增自定义标签
    html += `
      <div class="add-tag-row">
        <input type="text" class="add-tag-input" data-cat="${cat.id}" placeholder="在「${cat.name}」下新增标签…" maxlength="12">
        <button class="add-tag-btn" data-cat="${cat.id}">＋ 新增</button>
      </div>`;

    html += `</div>`;
  });

  app.innerHTML = html;

  // 绑定权重按钮
  app.querySelectorAll('.weight-buttons').forEach(container => {
    const tagId = container.dataset.tag;
    container.querySelectorAll('.weight-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const weight = parseInt(btn.dataset.weight);
        setTagWeight(tagId, weight);
        showToast(getWeightLabel(weight) + '：' + TAGS[tagId].name);
        scheduleCloudSync();
        render();
      });
    });
  });

  // 绑定删除自定义标签
  app.querySelectorAll('.tag-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tagId = btn.dataset.deleteTag;
      const tag = TAGS[tagId];
      if (!tag) return;
      if (!confirm(`确定删除自定义标签「${tag.name}」吗？\n该标签会从所有文章上移除，此操作不可撤销。`)) return;
      removeCustomTag(tagId);
      // 同步内存文章的标签
      allArticles = attachManualTags(allArticles.map(a => Object.assign({}, a)));
      scheduleCloudSync();
      showToast('已删除标签：' + tag.name);
      render();
    });
  });

  // 绑定新增标签
  app.querySelectorAll('.add-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const input = app.querySelector(`.add-tag-input[data-cat="${cat}"]`);
      const result = addCustomTag(input.value, cat);
      if (!result.ok) {
        showToast(result.message || '新增失败');
        return;
      }
      scheduleCloudSync();
      showToast('已新增标签：' + result.tag.name);
      render();
      // 渲染后聚焦回该组输入框（体验连续性）
      const nextInput = document.querySelector(`.add-tag-input[data-cat="${cat}"]`);
      if (nextInput) nextInput.focus();
    });
  });
  app.querySelectorAll('.add-tag-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        app.querySelector(`.add-tag-btn[data-cat="${input.dataset.cat}"]`).click();
      }
    });
  });
}

/**
 * ========== 文章手动打标签弹层 ==========
 */
function openTagPicker(article) {
  const existing = document.getElementById('tagPickerMask');
  if (existing) existing.remove();

  const mask = document.createElement('div');
  mask.className = 'tag-picker-mask';
  mask.id = 'tagPickerMask';

  // 按分类组织全部标签
  const selected = getArticleManualTags(article.link);
  const autoTags = article.tags || [];
  let groupsHtml = '';
  getAllCategories().forEach(cat => {
    const chips = cat.tags.map(tagId => {
      const tag = TAGS[tagId];
      const has = autoTags.includes(tagId);
      const manual = selected.includes(tagId);
      const cls = has ? 'selected' : '';
      const title = has && !manual ? '（自动匹配，不可取消）' : '';
      return `<span class="picker-chip ${cls}" data-tag="${tagId}" data-manual="${manual ? 1 : 0}" data-auto="${has && !manual ? 1 : 0}" title="${title}" style="${has ? `border-color:${cat.color};color:${cat.color};` : ''}">${escapeHtml(tag.name)}${has ? ' ✓' : ''}</span>`;
    }).join('');
    groupsHtml += `
      <div class="picker-group">
        <div class="picker-group-title" style="color:${cat.color}">${cat.name}</div>
        <div class="picker-chips">${chips}</div>
      </div>`;
  });

  const zhTitle = getCachedTranslation(article.title);

  mask.innerHTML = `
    <div class="tag-picker">
      <button class="tag-picker-close" id="tagPickerClose">×</button>
      <div class="tag-picker-title">给文章打标签</div>
      <div class="tag-picker-article">${escapeHtml(zhTitle || article.title)}${zhTitle ? `<div class="tag-picker-article-sub">${escapeHtml(article.title)}</div>` : ''}</div>
      <div class="tag-picker-new">
        <input type="text" id="pickerNewName" placeholder="新建标签名…" maxlength="12">
        <select id="pickerNewCat">
          ${getAllCategories().map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <button class="btn-primary" id="pickerNewBtn">新建并添加</button>
      </div>
      <div class="tag-picker-groups">${groupsHtml}</div>
    </div>`;

  document.body.appendChild(mask);

  // 关闭时刷新当前页，让手动标签即时反映到卡片/Feed
  const close = () => { mask.remove(); render(); };
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  document.getElementById('tagPickerClose').addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape' && document.getElementById('tagPickerMask')) {
      close();
      document.removeEventListener('keydown', escClose);
    }
  });

  // 选择 / 取消标签
  mask.querySelectorAll('.picker-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tagId = chip.dataset.tag;

      // 自动匹配（非手动添加）的标签不能直接取消
      if (chip.dataset.auto === '1') {
        showToast('「' + TAGS[tagId].name + '」是关键词自动匹配的标签，不能手动取消');
        return;
      }

      const willAdd = chip.dataset.manual !== '1';
      toggleArticleTag(article.link, tagId);

      // 同步内存中的文章标签
      if (willAdd) {
        if (!article.tags.includes(tagId)) article.tags.push(tagId);
      } else {
        const idx = article.tags.indexOf(tagId);
        if (idx >= 0) article.tags.splice(idx, 1);
      }
      scheduleCloudSync();

      // 只重绘弹层选中态
      const nowSelected = getArticleManualTags(article.link);
      mask.querySelectorAll('.picker-chip').forEach(c => {
        const t = TAGS[c.dataset.tag];
        const manual = nowSelected.includes(t.id);
        const has = (article.tags || []).includes(t.id);
        c.dataset.manual = manual ? '1' : '0';
        c.dataset.auto = has && !manual ? '1' : '0';
        c.classList.toggle('selected', has);
        c.style.cssText = has ? `border-color:${CATEGORIES[t.category].color};color:${CATEGORIES[t.category].color};` : '';
        c.textContent = t.name + (has ? ' ✓' : '');
      });
    });
  });

  // 新建标签并自动加到本文
  const doCreate = () => {
    const nameEl = document.getElementById('pickerNewName');
    const catEl = document.getElementById('pickerNewCat');
    const result = addCustomTag(nameEl.value, catEl.value);
    if (!result.ok) { showToast(result.message || '新增失败'); return; }
    toggleArticleTag(article.link, result.tag.id);
    article.tags = (article.tags || []).concat(result.tag.id);
    scheduleCloudSync();
    showToast('已新增并添加：' + result.tag.name);
    close();
  };
  document.getElementById('pickerNewBtn').addEventListener('click', doCreate);
  document.getElementById('pickerNewName').addEventListener('keydown', e => {
    if (e.key === 'Enter') doCreate();
  });
}

function getWeightLabel(w) {
  if (w === TAG_WEIGHTS.FOCUS) return '✓ 关注';
  if (w === TAG_WEIGHTS.IGNORE) return '✗ 不关注';
  return '默认';
}

/**
 * ========== 订阅源管理 ==========
 */
function renderSourceManage(app) {
  const sources = getSourceSettings();
  const emailSub = getEmailSubscription();
  const syncCfg = getSyncConfig();

  app.innerHTML = `
    <div class="page-title">订阅源管理</div>
    <div class="page-subtitle">启用 / 禁用 RSS 资讯源，影响 Dashboard 和个人推荐的文章范围</div>

    <div class="source-table" id="sourceTable"></div>

    <!-- 邮件订阅 -->
    <div class="email-section">
      <h3>📧 邮件周刊订阅</h3>
      <p>每周一早上 9:00（北京时间），自动将上周精选发送到你的邮箱。标签偏好同样作用于邮件。</p>
      
      ${emailSub.subscribed ? `
        <div style="margin-bottom:16px;">
          <div class="email-status subscribed">✓ 已订阅：${escapeHtml(emailSub.email)}</div>
        </div>
        <div class="email-form" style="flex-direction:row;">
          <button class="btn-secondary" id="unsubscribeBtn">取消订阅</button>
        </div>
      ` : `
        <form class="email-form" id="emailForm">
          <input type="email" id="emailInput" placeholder="your@email.com" required value="${escapeHtml(emailSub.email)}">
          <button type="submit" class="btn-primary">订阅周刊</button>
        </form>
        <div class="email-status unsubscribed" id="emailStatus" style="display:none;"></div>
      `}
    </div>

    <!-- 云端同步（周刊个性化偏好） -->
    <div class="email-section">
      <h3>☁️ 云端同步（让邮件周刊按你的偏好排序）</h3>
      <p>
        标签权重和订阅源开关会同步到你的 <strong>GitHub 私密 Gist</strong>，每周一的发信任务自动读取。<br>
        Token 仅保存在本浏览器，不会上传到任何其他地方。
        没有 Token？<a href="https://github.com/settings/tokens" target="_blank" rel="noopener">点这里生成</a>（Classic Token 勾选 <code>gist</code> 权限即可）。
      </p>
      <form class="email-form" id="syncForm" style="max-width:560px;flex-wrap:wrap;">
        <input type="password" id="syncToken" placeholder="GitHub Token（ghp_...，仅需 gist 权限）" value="${escapeHtml(syncCfg.ghToken || '')}" style="flex:1;min-width:220px;padding:10px 14px;border:1px solid #E7E5E4;border-radius:8px;font-size:14px;">
        <input type="text" id="syncGistId" placeholder="Gist ID（首次留空，自动创建）" value="${escapeHtml(syncCfg.gistId || '')}" style="flex:1;min-width:180px;padding:10px 14px;border:1px solid #E7E5E4;border-radius:8px;font-size:14px;">
        <button type="submit" class="btn-primary">保存并立即同步</button>
      </form>
      <div class="email-status" id="syncStatus" style="display:none;"></div>
    </div>`;

  // 渲染源列表
  const table = document.getElementById('sourceTable');
  sources.forEach(source => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <div class="source-name">
        <span class="source-dot" style="background:${source.color}"></span>
        ${escapeHtml(source.name)}
      </div>
      <div class="source-category">${escapeHtml(source.category)}</div>
      <label class="source-toggle">
        <input type="checkbox" ${source.enabled ? 'checked' : ''} data-source="${source.id}">
        <span class="slider"></span>
      </label>`;
    table.appendChild(row);
  });

  // 绑定源开关
  table.querySelectorAll('.source-toggle input').forEach(input => {
    input.addEventListener('change', () => {
      const sourceId = input.dataset.source;
      setSourceEnabled(sourceId, input.checked);
      const src = sources.find(s => s.id === sourceId);
      showToast((input.checked ? '✓ 已启用' : '✗ 已禁用') + '：' + src.name);
      scheduleCloudSync();
      // 重新抓取
      fetchAllRSS().then(articles => {
        allArticles = attachManualTags(articles);
        render();
      });
    });
  });

  // 绑定邮件订阅
  const emailForm = document.getElementById('emailForm');
  if (emailForm) {
    emailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('emailInput').value.trim();
      if (email && email.includes('@')) {
        setEmailSubscription(email, true);
        showToast('✓ 订阅成功！每周一 9:00 发送周刊到 ' + email);
        scheduleCloudSync();
        render();
      } else {
        const status = document.getElementById('emailStatus');
        status.textContent = '请输入有效的邮箱地址';
        status.style.display = 'block';
      }
    });
  }

  const unsubscribeBtn = document.getElementById('unsubscribeBtn');
  if (unsubscribeBtn) {
    unsubscribeBtn.addEventListener('click', () => {
      setEmailSubscription('', false);
      showToast('已取消邮件订阅');
      scheduleCloudSync();
      render();
    });
  }

  // 绑定云端同步卡片
  bindSyncUI();
}

/**
 * ========== 搜索 ==========
 */
function renderSearch() {
  const app = document.getElementById('app');
  const q = document.getElementById('searchInput').value.trim().toLowerCase();

  const filtered = visibleArticles().filter(a => {
    const zh = getCachedTranslation(a.title) || ''; // 中文译文也参与搜索
    return a.title.toLowerCase().includes(q) ||
      zh.toLowerCase().includes(q) ||
      (a.summary && a.summary.toLowerCase().includes(q)) ||
      a.sourceName.toLowerCase().includes(q);
  });

  app.innerHTML = `
    <div class="page-title">搜索结果 <span style="font-size:14px;color:var(--color-text-secondary);font-weight:normal;">"${escapeHtml(q)}" · ${filtered.length} 条</span></div>
    ${filtered.length > 0 ? `<div class="card-grid" id="cardGrid"></div>` : 
      `<div class="empty-state"><div class="empty-state-icon">🔍</div><div>没有找到相关文章</div></div>`}`;

  const grid = document.getElementById('cardGrid');
  if (grid) {
    filtered.forEach(article => grid.appendChild(createArticleCard(article)));
    bindTagAddButtons(grid);
    translateWithin(app);
  }
}

/**
 * ========== 工具函数 ==========
 */
function formatTime(pubDate) {
  const t = new Date(pubDate);
  const now = new Date();
  const diffMs = now - t;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return diffMins + ' 分钟前';
  if (diffHours < 24) return diffHours + ' 小时前';
  if (diffDays < 7) return diffDays + ' 天前';
  return t.toLocaleDateString('zh-CN');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 2500);
}

// 启动
init();
