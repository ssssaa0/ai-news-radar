/**
 * 云端同步模块
 *
 * 把用户的标签权重 / 订阅源开关 / 邮箱同步到 GitHub 私密 Gist，
 * GitHub Actions 每周一发周刊前从 Gist 读取偏好，实现个性化排序。
 *
 * Token 只保存在浏览器 localStorage，不会写进代码仓库。
 * 需要一个仅有 gist 权限的 GitHub Personal Access Token：
 *   Classic:  https://github.com/settings/tokens        （勾选 gist scope）
 *   Fine-grained: https://github.com/settings/personal-access-tokens（Gists 读写）
 */

const GIST_API = 'https://api.github.com/gists';
const GIST_FILENAME = AINR.GIST_FILENAME;

function getSyncConfig() {
  const saved = localStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { /* ignore */ }
  }
  return { ghToken: '', gistId: '', lastSync: 0, lastMessage: '' };
}

function saveSyncConfig(cfg) {
  localStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(cfg));
}

function isSyncConfigured() {
  const cfg = getSyncConfig();
  return !!(cfg.ghToken && cfg.gistId);
}

/**
 * 组装要同步的偏好内容（与周刊脚本约定的格式）
 */
function buildPrefsPayload() {
  const sources = {};
  getSourceSettings().forEach(s => { sources[s.id] = !!s.enabled; });
  const emailSub = getEmailSubscription();

  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    tagWeights: getTagWeights(),
    sources,
    customTags: getCustomTags(),
    manualTags: getManualTagMap(),
    email: emailSub.subscribed ? emailSub.email : ''
  };
}

function gistHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

/**
 * 上传偏好到 Gist（没有 gistId 时自动创建私密 Gist）
 * @returns {Promise<{ok:boolean, message:string, gistId?:string}>}
 */
async function uploadPreferences() {
  const cfg = getSyncConfig();
  if (!cfg.ghToken) {
    return { ok: false, message: '请先填写 GitHub Token' };
  }

  const content = JSON.stringify(buildPrefsPayload(), null, 2);

  try {
    let resp;
    if (cfg.gistId) {
      // 更新已有 Gist
      resp = await fetch(`${GIST_API}/${cfg.gistId}`, {
        method: 'PATCH',
        headers: gistHeaders(cfg.ghToken),
        body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
      });
    } else {
      // 创建新的私密 Gist
      resp = await fetch(GIST_API, {
        method: 'POST',
        headers: gistHeaders(cfg.ghToken),
        body: JSON.stringify({
          description: 'AI 资讯雷达 · 周刊偏好（自动生成，请勿删除）',
          public: false,
          files: { [GIST_FILENAME]: { content } }
        })
      });
    }

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, message: 'Token 无效或没有 gist 权限，请检查后重试' };
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return { ok: false, message: `GitHub API 错误 ${resp.status} ${detail.slice(0, 100)}` };
    }

    const data = await resp.json();
    const newCfg = {
      ghToken: cfg.ghToken,
      gistId: data.id,
      lastSync: Date.now(),
      lastMessage: '同步成功'
    };
    saveSyncConfig(newCfg);
    return { ok: true, message: '✓ 偏好已同步到云端', gistId: data.id };
  } catch (err) {
    return { ok: false, message: '网络错误：' + err.message };
  }
}

/**
 * 读取 Gist 中的偏好内容（不解构、不应用）
 * @returns {Promise<{ok:boolean, prefs?:object, message?:string}>}
 */
async function fetchRemotePrefs() {
  const cfg = getSyncConfig();
  if (!cfg.ghToken || !cfg.gistId) return { ok: false, message: '未配置 Token 或 Gist ID' };
  try {
    const resp = await fetch(`${GIST_API}/${cfg.gistId}`, { headers: gistHeaders(cfg.ghToken) });
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
    const data = await resp.json();
    const file = data.files && data.files[GIST_FILENAME];
    if (!file || !file.content) return { ok: false, message: 'Gist 中没有偏好文件' };
    return { ok: true, prefs: JSON.parse(file.content) };
  } catch (err) {
    return { ok: false, message: '网络错误：' + err.message };
  }
}

/**
 * 把云端偏好应用到本机（换浏览器 / 换域名后恢复用）
 * 注意：必须先注册自定义标签，再写入权重表
 */
function applyRemotePrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;

  // 1. 自定义标签（先注册，权重/手动标签引用才能对上）
  if (Array.isArray(prefs.customTags)) {
    saveCustomTags(prefs.customTags);
    registerTags(prefs.customTags);
  }

  // 2. 标签权重（与当前默认表合并，只覆盖云端存在的键）
  if (prefs.tagWeights && typeof prefs.tagWeights === 'object') {
    const merged = getTagWeights();
    Object.keys(prefs.tagWeights).forEach(id => {
      if (TAGS[id]) merged[id] = prefs.tagWeights[id];
    });
    localStorage.setItem(STORAGE_KEYS.TAG_WEIGHTS, JSON.stringify(merged));
  }

  // 3. 订阅源开关
  if (prefs.sources && typeof prefs.sources === 'object') {
    const settings = {};
    SOURCES.forEach(s => {
      settings[s.id] = prefs.sources[s.id] !== false;
    });
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(settings));
  }

  // 4. 手动文章标签
  if (prefs.manualTags && typeof prefs.manualTags === 'object') {
    const cleaned = {};
    Object.keys(prefs.manualTags).forEach(link => {
      const ids = (prefs.manualTags[link] || []).filter(id => TAGS[id]);
      if (ids.length) cleaned[link] = ids;
    });
    saveManualTagMap(cleaned);
  }

  // 5. 邮箱订阅
  if (prefs.email) {
    setEmailSubscription(prefs.email, true);
  }
}

// ========== 自动同步（偏好变更后防抖触发，失败静默）==========
let syncTimer = null;
function scheduleCloudSync() {
  if (!isSyncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const result = await uploadPreferences();
    if (result.ok) {
      console.log('[Sync] 偏好已自动同步');
    } else {
      console.warn('[Sync] 自动同步失败:', result.message);
    }
  }, 1500);
}

/**
 * 绑定云端同步设置卡片（由 app.js 在订阅源页渲染后调用）
 */
function bindSyncUI() {
  const form = document.getElementById('syncForm');
  if (!form) return;

  const cfg = getSyncConfig();
  const tokenInput = document.getElementById('syncToken');
  const gistInput = document.getElementById('syncGistId');
  const statusEl = document.getElementById('syncStatus');

  const renderStatus = (text, ok) => {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.display = text ? 'block' : 'none';
    statusEl.className = 'email-status ' + (ok ? 'subscribed' : 'unsubscribed');
    if (!ok && text) statusEl.style.color = '#DC2626';
  };

  if (cfg.gistId) {
    renderStatus(cfg.lastSync
      ? `✓ 已配置云端同步，上次同步：${new Date(cfg.lastSync).toLocaleString('zh-CN')}`
      : '✓ 已配置云端同步', true);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    let gistId = gistInput.value.trim();
    if (!token) {
      renderStatus('请填写 GitHub Token', false);
      return;
    }
    // 支持粘贴整个 Gist URL
    const urlMatch = gistId.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{20,})/);
    if (urlMatch) gistId = urlMatch[1];

    saveSyncConfig({ ghToken: token, gistId, lastSync: cfg.lastSync || 0, lastMessage: '' });

    // 已指定 Gist：先看云端有没有偏好，避免新域名下用默认值覆盖云端
    if (gistId) {
      renderStatus('正在检查云端备份...', true);
      const remote = await fetchRemotePrefs();
      if (remote.ok) {
        const updated = remote.prefs.updatedAt
          ? new Date(remote.prefs.updatedAt).toLocaleString('zh-CN')
          : '未知时间';
        const wantRestore = window.confirm(
          '云端已存在偏好备份（更新于 ' + updated + '）。\n\n' +
          '点【确定】= 用云端备份恢复到本机（换电脑/换网站时选这个）\n' +
          '点【取消】= 用本机当前偏好覆盖云端'
        );
        if (wantRestore) {
          try {
            applyRemotePrefs(remote.prefs);
            renderStatus('✓ 已从云端恢复偏好，页面即将刷新...', true);
            setTimeout(() => location.reload(), 800);
            return;
          } catch (err) {
            renderStatus('恢复失败：' + err.message, false);
            return;
          }
        }
      }
      // 云端没有偏好文件（或 Gist 为空）→ 走下面的上传
    }

    renderStatus('正在上传偏好...', true);

    const result = await uploadPreferences();
    if (result.ok) {
      gistInput.value = result.gistId;
      renderStatus(result.message + '（Gist ID: ' + result.gistId.slice(0, 8) + '...）', true);
      showToast('云端同步成功');
    } else {
      renderStatus(result.message, false);
    }
  });
}
