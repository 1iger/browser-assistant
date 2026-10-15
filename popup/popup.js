import {
  mergeSettings,
  fmtBytes,
  cleanExtensions,
  matchesExt,
  originPattern,
  hostFromUrl
} from '../scripts/defaults.js';

const $ = (s) => document.querySelector(s);

let settings = null;
let activeTab = null;
let collected = [];
let tabSignature = '';
let tabTimer = null;

init().catch((e) => console.error(e));

async function init() {
  const data = await chrome.storage.local.get('settings');
  settings = mergeSettings(data.settings);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;

  setupNav();
  setupTabsPane();
  setupLinksPane();
  setupPointsPane();
  setupEmotesPane();
  setupAnonPane();

  const nav = await chrome.storage.local.get('lastPane');
  activatePane(nav.lastPane || 'tabs');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = mergeSettings(changes.settings.newValue);
      renderAnonPane();
    }
  });
}

/* ---------------- navigation ---------------- */

function activatePane(name) {
  const btn = document.querySelector('.nav-btn[data-pane="' + name + '"]') ||
    document.querySelector('.nav-btn[data-pane="tabs"]');
  if (!btn) return null;
  const pane = btn.dataset.pane;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = true; });
  const el = $('#pane-' + pane);
  if (el) el.hidden = false;
  if (pane === 'tabs') refreshTabs(true).catch(() => {});
  if (pane === 'points') startPointsRefresh();
  if (pane !== 'points') stopPointsRefresh();
  if (pane === 'emotes' && !collectedEmotes.length) collectEmotes();
  return pane;
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pane = activatePane(btn.dataset.pane);
      if (pane) chrome.storage.local.set({ lastPane: pane }).catch(() => {});
    });
  });
  $('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

/* ---------------- tabs pane ---------------- */

function setupTabsPane() {
  $('#refreshTabs').addEventListener('click', () => refreshTabs(true));
  $('#memPerm').addEventListener('click', async () => {
    let ok = false;
    try { ok = await chrome.permissions.request({ origins: ['*://*/*'] }); } catch (e) { ok = false; }
    if (ok) refreshTabs(true).catch(() => {});
  });
  refreshTabs(true);
  tabTimer = setInterval(() => refreshTabs(false), 3000);
  window.addEventListener('unload', () => clearInterval(tabTimer));
}

/* ---------------- memory: данные приходят из background ---------------- */

let memOpenedAt = Date.now();
let memState = { memMap: {}, srcMap: {}, ready: false, apiOk: false, perm: false };

async function askMemory(force) {
  try {
    const snap = await chrome.runtime.sendMessage({ type: 'mem', force: !!force, popup: true });
    if (snap && typeof snap === 'object') memState = snap;
  } catch (e) { /* service worker ещё не проснулся */ }
  return memState;
}

function updateActionBadge(total) {
  if (settings && settings.badgeMode === 'points') return;
  if (!chrome.action || !chrome.action.setBadgeText) return;
  let text = '';
  let title = 'Browser Assistant';
  let color = '#22c55e';
  if (total > 0) {
    const mb = total / 1048576;
    if (mb >= 1024) {
      const gb = mb / 1024;
      text = (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)).replace(/\.0$/, '');
    } else {
      text = String(Math.max(1, Math.round(mb)));
    }
    title = 'Память вкладок: ' + fmtBytes(total);
    color = total >= 4 * 1073741824 ? '#ef4444' : total >= 1073741824 ? '#f59e0b' : '#22c55e';
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title });
  if (total > 0) chrome.action.setBadgeBackgroundColor({ color });
}

async function refreshTabs(force) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { tabs = []; }
  await askMemory(force);
  renderTabs(tabs, memState.memMap, memState.srcMap);
}

function renderTabs(tabs, memMap, srcMap, forceRender) {
  const rows = tabs.map((tab) => ({
    tab,
    mem: tab.id != null && typeof memMap[tab.id] === 'number' ? memMap[tab.id] : null,
    src: (srcMap && srcMap[tab.id]) || null
  }));

  const winOrder = [];
  rows.forEach((r) => {
    if (!winOrder.includes(r.tab.windowId)) winOrder.push(r.tab.windowId);
  });

  const procTotal = rows.reduce((s, r) => s + (r.src === 'proc' ? (r.mem || 0) : 0), 0);
  const heapTotal = rows.reduce((s, r) => s + (r.src === 'heap' ? (r.mem || 0) : 0), 0);
  const anyMem = !!memState.ready || procTotal > 0 || heapTotal > 0;
  const apiOk = !!memState.apiOk;
  const loading = !anyMem && (Date.now() - memOpenedAt) < 8000;

  const badgeTotal = procTotal > 0 ? procTotal : heapTotal;
  if (badgeTotal > 0 || !loading) updateActionBadge(badgeTotal);

  const permBtn = $('#memPerm');
  permBtn.hidden = apiOk || !!memState.perm;

  let stat;
  if (procTotal > 0) stat = 'память: ' + fmtBytes(procTotal) + ' (оценка)';
  else if (heapTotal > 0) stat = 'память: ≈' + fmtBytes(heapTotal) + ' (JS heap)';
  else if (loading) stat = 'память: …';
  else if (!apiOk && !memState.perm) stat = 'память: нужен доступ к сайтам';
  else stat = 'память: —';
  $('#tabStat').textContent = rows.length + ' вкл. · ' + stat;

  const signature = rows
    .map((r) => r.tab.id + ':' + r.tab.title + ':' + Math.round(r.mem || 0))
    .join('|');
  if (!forceRender && signature === tabSignature) return;
  tabSignature = signature;

  rows.sort((a, b) => (b.mem || 0) - (a.mem || 0));

  const list = $('#tabList');
  const scrollPos = list.scrollTop;
  list.textContent = '';

  for (const { tab, mem, src } of rows) {
    const row = document.createElement('div');
    row.className = 'tab-row';

    const fav = document.createElement('img');
    fav.className = 'fav';
    fav.alt = '';
    if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) fav.src = tab.favIconUrl;
    else fav.hidden = true;
    fav.addEventListener('error', () => { fav.hidden = true; });
    fav.title = 'Открыть окно и перейти на вкладку';
    fav.addEventListener('click', () => focusTab(tab.windowId, tab.id));
    row.appendChild(fav);

    const main = document.createElement('div');
    main.className = 'tab-main';

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || '(без названия)';
    title.title = 'Клик — закрыть вкладку';
    title.addEventListener('click', () => closeTab(tab.id, row));
    main.appendChild(title);

    const url = document.createElement('span');
    url.className = 'tab-url';
    const host = hostFromUrl(tab.url || '');
    const path = (() => {
      try {
        const u = new URL(tab.url || '');
        return u.pathname + u.search;
      } catch (e) { return tab.url || ''; }
    })();
    if (tab.url && /^https?:/.test(tab.url)) {
      const a = document.createElement('a');
      a.href = tab.url;
      a.textContent = host + path;
      a.title = tab.url;
      a.addEventListener('click', (ev) => { ev.preventDefault(); });
      a.addEventListener('auxclick', (ev) => { ev.preventDefault(); });
      url.appendChild(a);
    } else {
      url.textContent = tab.url || '';
    }
    main.appendChild(url);
    row.appendChild(main);

    const winIdx = winOrder.indexOf(tab.windowId);
    if (winOrder.length > 1) {
      const w = document.createElement('span');
      w.className = 'win-tag';
      w.textContent = 'О' + (winIdx + 1);
      w.title = 'Клик — показать окно ' + (winIdx + 1);
      w.addEventListener('click', () => focusWindow(tab.windowId));
      row.appendChild(w);
    }

    const chip = document.createElement('span');
    chip.className = 'mem';
    chip.textContent = mem != null && mem > 0
      ? ((src === 'heap' ? '≈' : '') + fmtBytes(mem))
      : (loading ? '…' : '—');
    chip.title = mem > 0
      ? (src === 'heap' ? 'JS heap — приблизительно' : 'Память процесса (оценка)')
      : '';
    row.appendChild(chip);

    const go = document.createElement('button');
    go.className = 'go-btn';
    go.title = 'Перейти на вкладку';
    go.textContent = '↗';
    go.addEventListener('click', () => focusTab(tab.windowId, tab.id));
    row.appendChild(go);

    list.appendChild(row);
  }

  if (!rows.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Нет вкладок';
    list.appendChild(e);
  }
  list.scrollTop = scrollPos;
}

async function focusWindow(windowId) {
  if (windowId != null) {
    try {
      const win = await chrome.windows.get(windowId);
      const patch = { focused: true };
      if (win && win.state === 'minimized') patch.state = 'normal';
      await chrome.windows.update(windowId, patch);
    } catch (e) {
      try { await chrome.windows.update(windowId, { focused: true }); } catch (e2) {}
    }
  }
  window.close();
}

async function focusTab(windowId, tabId) {
  try { await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
  await focusWindow(windowId);
}

async function closeTab(tabId, row) {
  row.style.opacity = '0.35';
  try {
    await chrome.tabs.remove(tabId);
    row.remove();
    tabSignature = '';
    refreshTabs(true).catch(() => {});
  } catch (e) {
    row.style.opacity = '';
  }
}

/* ---------------- points pane (VK Video Live / Twitch) ---------------- */

let pointsTimer = null;

function startPointsRefresh() {
  refreshPoints(true).catch(() => {});
  if (!pointsTimer) {
    pointsTimer = setInterval(() => refreshPoints(false).catch(() => {}), 2000);
  }
}

function stopPointsRefresh() {
  if (pointsTimer) {
    clearInterval(pointsTimer);
    pointsTimer = null;
  }
}

async function refreshPoints(force) {
  let resp = null;
  try { resp = await chrome.runtime.sendMessage({ type: 'vkpoints:getState' }); } catch (e) { resp = null; }
  let logData = {};
  try { logData = await chrome.storage.local.get('vkpoints_log'); } catch (e) {}
  renderPoints(resp || {}, (logData.vkpoints_log || []));
}

function pkSet(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderPoints(resp, log) {
  const state = resp.state || {};
  const pset = resp.settings || {};

  pkSet('pkToken', resp.hasToken ? '✓ найден' : 'не найден');
  const tokenEl = document.getElementById('pkToken');
  tokenEl.classList.toggle('ok', !!resp.hasToken);
  tokenEl.classList.toggle('no', !resp.hasToken);

  const channels = resp.channels || [];
  pkSet('pkChannels', channels.length
    ? channels.map((c) => c.name + (c.live === false ? ' (offline)' : '')).join(', ')
    : '—');
  pkSet('pkBalance', state.balance !== null && state.balance !== undefined ? state.balance : '—');
  pkSet('pkClicks', state.clicks || 0);
  pkSet('pkLast', state.lastText ? state.lastText : fmtPointsTime(state.lastClickAt));

  $('#pkEnabled').checked = pset.enabled !== false;
  $('#pkInterval').value = pset.pollIntervalMs || 15000;
  $('#pkNotify').checked = pset.notifyEnabled !== false;
  $('#pkAutoBk').checked = pset.autoBackup === true;

  drawPointsChart(resp.mini || []);

  const logEl = $('#pkLog');
  logEl.textContent = '';
  (log || []).forEach((e) => {
    const div = document.createElement('div');
    div.className = 'entry';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtPointsTime(e.t);
    const msg = document.createElement('span');
    msg.textContent = e.msg;
    div.appendChild(time);
    div.appendChild(msg);
    logEl.appendChild(div);
  });
}

function fmtPointsTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ru-RU');
}

function drawPointsChart(values) {
  const canvas = $('#pkChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const max = Math.max(1, ...values);
  const n = values.length;
  const slot = w / n;
  const barW = Math.min(22, slot * 0.6);

  values.forEach((v, i) => {
    const bh = v > 0 ? Math.max(2, (v / max) * (h - 14)) : 2;
    const x = slot * i + (slot - barW) / 2;
    const y = h - bh;
    ctx.fillStyle = v > 0 ? '#4f8cff' : '#2a3040';
    ctx.fillRect(x, y, barW, bh);
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    ctx.fillStyle = '#8b94a3';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.toLocaleDateString('ru-RU', { weekday: 'short' }), slot * i + slot / 2, h - 1);
    ctx.textAlign = 'left';
  });
}

function setupPointsPane() {
  $('#pkEnabled').addEventListener('change', (ev) => {
    chrome.runtime.sendMessage({ type: 'vkpoints:setEnabled', enabled: ev.target.checked }, (resp) => {
      void chrome.runtime.lastError;
      if (resp && resp.ok) refreshPoints(false).catch(() => {});
    });
  });
  $('#pkNotify').addEventListener('change', (ev) => {
    chrome.runtime.sendMessage({ type: 'vkpoints:setNotify', enabled: ev.target.checked }, () => {
      void chrome.runtime.lastError;
    });
  });
  $('#pkAutoBk').addEventListener('change', (ev) => {
    chrome.runtime.sendMessage({ type: 'vkpoints:setAutoBackup', enabled: ev.target.checked }, () => {
      void chrome.runtime.lastError;
    });
  });
  $('#pkSave').addEventListener('click', () => {
    const interval = parseInt($('#pkInterval').value, 10);
    chrome.runtime.sendMessage({ type: 'vkpoints:setInterval', interval }, (resp) => {
      void chrome.runtime.lastError;
      if (!(resp && resp.ok) && $('#pkInterval').value) $('#pkInterval').value = '15000';
    });
  });
  $('#pkStatsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('vkpoints/stats.html') });
  });
}

/* ---------------- links pane ---------------- */

function setupLinksPane() {
  $('#collectBtn').addEventListener('click', collectLinks);
  $('#allLinks').checked = !!settings.allLinks;
  $('#allLinks').addEventListener('change', async (ev) => {
    settings.allLinks = ev.target.checked;
    await chrome.storage.local.set({ settings });
    renderLinks();
  });
  $('#copyBtn').addEventListener('click', copyLinks);
}

function collectLinksFunc() {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('a[href], area[href]').forEach((a) => {
    let href = '';
    try { href = a.href; } catch (e) { return; }
    if (!href || seen.has(href)) return;
    if (!/^(https?|ftp|file):/.test(href)) return;
    seen.add(href);
    let path = href;
    try { path = new URL(href).pathname; } catch (e) {}
    const text = ((a.innerText || '') + '').trim().replace(/\s+/g, ' ').slice(0, 120);
    out.push({ href, path, text });
  });
  return out;
}

async function collectLinks() {
  const btn = $('#collectBtn');
  btn.disabled = true;
  btn.textContent = 'Сбор…';
  try {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || tab.id == null) throw new Error('no tab');
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectLinksFunc
    });
    collected = (res && res[0] && res[0].result) || [];
  } catch (e) {
    collected = [];
    $('#linkEmpty').hidden = false;
    $('#linkEmpty').textContent = 'Не удалось прочитать страницу (chrome:// и т.п. не поддерживаются).';
  }
  btn.disabled = false;
  btn.textContent = 'Собрать ссылки';
  renderLinks();
}

function renderLinks() {
  const list = $('#linkList');
  list.textContent = '';
  const exts = cleanExtensions(settings.fileExtensions);
  const filtered = settings.allLinks
    ? collected
    : collected.filter((l) => matchesExt(l.path, exts));

  $('#linkInfoRow').hidden = !collected.length;
  $('#linkEmpty').hidden = !!collected.length;

  if (collected.length && !filtered.length) {
    $('#linkEmpty').hidden = false;
    $('#linkEmpty').textContent =
      'Совпадений нет. Форматы: ' + (exts.slice(0, 8).join(', ')) + (exts.length > 8 ? '…' : '');
    $('#linkStat').textContent = 'Найдено ' + collected.length + ', под фильтр не подошло';
    return;
  }

  $('#linkStat').textContent = settings.allLinks
    ? 'Всего: ' + filtered.length
    : 'Найдено ' + collected.length + ' · под фильтр: ' + filtered.length;

  for (const l of filtered) {
    const row = document.createElement('div');
    row.className = 'link-row';

    const a = document.createElement('a');
    a.className = 'name';
    let name = l.text;
    try {
      name = decodeURIComponent(l.path.split('/').filter(Boolean).pop() || '') || l.text;
    } catch (e) {}
    a.textContent = name || l.href;
    a.title = l.href;
    a.href = l.href;
    a.target = '_blank';
    a.rel = 'noopener';
    row.appendChild(a);

    const m = l.path.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (m) {
      const tag = document.createElement('span');
      tag.className = 'size-tag';
      tag.textContent = m[1];
      row.appendChild(tag);
    }

    list.appendChild(row);
  }
}

async function copyLinks() {
  const exts = cleanExtensions(settings.fileExtensions);
  const filtered = settings.allLinks
    ? collected
    : collected.filter((l) => matchesExt(l.path, exts));
  try {
    await navigator.clipboard.writeText(filtered.map((l) => l.href).join('\n'));
    $('#copyBtn').textContent = 'Скопировано';
    setTimeout(() => { $('#copyBtn').textContent = 'Копировать'; }, 1200);
  } catch (e) {}
}

/* ---------------- emotes pane (Twitch / BTTV / FFZ / 7TV) ---------------- */

let collectedEmotes = [];
let emotesDownloading = false;
let emoteProgressTimer = null;

function setupEmotesPane() {
  $('#collectEmotes').addEventListener('click', collectEmotes);
  $('#downloadAllEmotes').addEventListener('click', downloadAllEmotes);
  const sel = $('#emoteFormat');
  if (sel) {
    sel.value = settings && settings.emoteFormat === 'gif' ? 'gif' : 'webp';
    updateEmoteFormatHint();
    sel.addEventListener('change', async () => {
      settings.emoteFormat = sel.value === 'gif' ? 'gif' : 'webp';
      updateEmoteFormatHint();
      try { await chrome.storage.local.set({ settings }); } catch (e) {}
    });
  }
}

function updateEmoteFormatHint() {
  const el = $('#emoteFormatHint');
  if (el) el.textContent = settings && settings.emoteFormat === 'gif' ? 'файл как на CDN' : 'квадрат для VK';
}

// Выполняется в контексте страницы Twitch: собирает emote-изображения из DOM.
function collectEmotesFunc() {
  const PROVIDERS = [
    { name: 'twitch', re: /(?:^|\.)jtvnw\.net$/ },
    { name: 'bttv', re: /(?:^|\.)betterttv\.net$/ },
    { name: 'ffz', re: /(?:^|\.)frankerfacez\.com$/ },
    { name: '7tv', re: /(?:^|\.)7tv\.app$/ }
  ];
  const providerOf = (u) => {
    let host = '';
    try { host = new URL(u, location.href).hostname; } catch (e) { return null; }
    for (const p of PROVIDERS) if (p.re.test(host)) return p.name;
    return null;
  };

  const out = [];
  const seen = new Set();
  for (const img of document.querySelectorAll('img')) {
    // Берём атрибут src (у Twitch это обычно 2.0 = 56px), а не currentSrc:
    // currentSrc на 1x-экране часто отдаёт маленький вариант 1.0 = 28px.
    const url = img.src || img.currentSrc || '';
    if (!url) continue;
    const provider = providerOf(url);
    if (!provider) continue;
    const alt = (img.alt || '').trim();
    const key = provider + '|' + (alt || url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: alt,
      url,
      provider,
      w: img.naturalWidth || 0,
      h: img.naturalHeight || 0
    });
  }
  return out;
}

async function collectEmotes() {
  const btn = $('#collectEmotes');
  btn.disabled = true;
  btn.textContent = 'Сбор…';
  try {
    let tab = activeTab;
    if (!tab || tab.id == null || !/twitch\.tv/.test(tab.url || '')) {
      tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    }
    if (!tab || tab.id == null) throw new Error('no tab');
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectEmotesFunc
    });
    collectedEmotes = (res && res[0] && res[0].result) || [];
  } catch (e) {
    collectedEmotes = [];
  }
  btn.disabled = false;
  btn.textContent = 'Собрать смайлы';
  renderEmotes();
}

function renderEmotes() {
  const list = $('#emoteList');
  list.textContent = '';
  $('#emoteInfoRow').hidden = !collectedEmotes.length;
  $('#emoteEmpty').hidden = !!collectedEmotes.length;

  if (!collectedEmotes.length) {
    $('#emoteEmpty').textContent =
      'Смайлы не найдены. Откройте Twitch (чат/панель со смайлами) и нажмите «Собрать смайлы».';
    return;
  }

  $('#emoteStat').textContent = 'Найдено: ' + collectedEmotes.length;

  collectedEmotes.forEach((em, idx) => {
    const card = document.createElement('div');
    card.className = 'emote-card';
    card.title = em.name || em.url;

    const img = document.createElement('img');
    img.src = em.url;
    img.alt = em.name;
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.style.opacity = '.3'; });
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = 'emote-name';
    name.textContent = em.name || '(без имени)';
    card.appendChild(name);

    const prov = document.createElement('div');
    prov.className = 'emote-prov';
    prov.textContent = em.provider + (em.w && em.h ? ' · ' + em.w + '×' + em.h : '');
    card.appendChild(prov);

    card.addEventListener('click', () => downloadEmote(idx, card));
    list.appendChild(card);
  });
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

function emoteFileName(em, ext) {
  let base = (em.name || '').trim();
  if (!base) {
    try {
      const parts = new URL(em.url).pathname.split('/').filter(Boolean);
      base = decodeURIComponent(parts[parts.length - 1] || '');
    } catch (e) { base = ''; }
  }
  base = base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
  return (base || 'emote') + (ext || '.webp');
}

// Определяет формат по «магическим» байтам, если CDN вернул невнятный content-type.
function sniffType(buf) {
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  const ascii = (o, n) => String.fromCharCode.apply(null, Array.from(b.slice(o, o + n)));
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp') return 'image/avif';
  return '';
}

function extFromMime(mime) {
  switch (mime) {
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/avif': return '.avif';
    default: return '';
  }
}

function indexOfBytes(b, str, from) {
  const t = [];
  for (let i = 0; i < str.length; i++) t.push(str.charCodeAt(i));
  for (let i = from || 0; i <= b.length - t.length; i++) {
    let j = 0;
    while (j < t.length && b[i + j] === t[j]) j++;
    if (j === t.length) return i;
  }
  return -1;
}

// Считает кадры GIF, обходя блоки формата (надёжнее, чем искать 0x2C).
function gifFrameCount(b) {
  const len = b.length;
  if (!(b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)) return 0;
  let p = 6 + 7;
  const packed = b[10];
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
  let frames = 0;
  while (p < len) {
    const blk = b[p++];
    if (blk === 0x3B) break;
    if (blk === 0x2C) {
      frames++;
      p += 9;
      const lct = b[p - 1];
      if (lct & 0x80) p += 3 * (1 << ((lct & 7) + 1));
      p++;
      while (p < len) { const sz = b[p++]; if (sz === 0) break; p += sz; }
    } else if (blk === 0x21) {
      p++;
      while (p < len) { const sz = b[p++]; if (sz === 0) break; p += sz; }
    } else break;
  }
  return frames;
}

// Определяет анимацию прямо по байтам: GIF (>1 кадра), анимированный WebP (ANIM/ANMF),
// APNG (acTL), анимированный AVIF (brand 'avis'). Не зависит от поддержки ImageDecoder.
function isAnimatedImage(buf) {
  const b = new Uint8Array(buf);
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50) return indexOfBytes(b, 'acTL', 0) >= 0;
  if (b.length > 12 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return gifFrameCount(b) > 1;
  if (b.length > 16 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46)
    return indexOfBytes(b, 'ANIM', 0) >= 0 || indexOfBytes(b, 'ANMF', 0) >= 0;
  if (indexOfBytes(b, 'ftyp', 0) === 4)
    return String.fromCharCode(b[8], b[9], b[10], b[11]) === 'avis';
  return false;
}

// Ссылка на максимальный/анимированный вариант смайла на CDN провайдера.
// Twitch: format 'default' (аним. если есть) + scale 3.0 (=112px).
// BTTV: 3x, 7TV: 4x (=128px), FFZ: 4. Анимацию отдаёт сам CDN, формат узнаём по байтам.
function bestSourceUrl(url, provider) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const low = parts.map((p) => p.toLowerCase());
    if (provider === 'twitch') {
      const i = low.indexOf('emoticons');
      if (i < 0 || parts.length < i + 6) return url;
      parts[i + 3] = 'default';
      parts[i + 5] = '3.0';
    } else if (provider === 'bttv') {
      const i = low.indexOf('emote');
      if (i < 0 || !parts[i + 2]) return url;
      parts[i + 2] = parts[i + 2].replace(/^\d+x/i, '3x');
    } else if (provider === '7tv') {
      const i = low.indexOf('emote');
      if (i < 0 || !parts[i + 2]) return url;
      parts[i + 2] = parts[i + 2].replace(/^\d+x/i, '4x');
    } else if (provider === 'ffz') {
      const i = low.indexOf('emote');
      if (i < 0) return url;
      for (let j = parts.length - 1; j > i; j--) {
        if (/^\d+$/.test(parts[j]) || /^\d+x$/i.test(parts[j])) { parts[j] = '4'; break; }
      }
    } else {
      return url;
    }
    u.pathname = '/' + parts.join('/');
    return u.href;
  } catch (e) {
    return url;
  }
}

// Ссылка на РОДНОЙ GIF/анимированный вариант смайла (режим «GIF»).
// Twitch: format 'animated'; BTTV: /3x (отдаёт GIF); 7TV: 4x.gif; FFZ: GIF нет — исходный.
function bestGifUrl(url, provider) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const low = parts.map((p) => p.toLowerCase());
    if (provider === 'twitch') {
      const i = low.indexOf('emoticons');
      if (i < 0 || parts.length < i + 6) return url;
      parts[i + 3] = 'animated';
      parts[i + 5] = '3.0';
    } else if (provider === 'bttv') {
      const i = low.indexOf('emote');
      if (i < 0 || !parts[i + 2]) return url;
      parts[i + 2] = parts[i + 2].replace(/^\d+x/i, '3x').replace(/\.[a-z0-9]+$/i, '');
    } else if (provider === '7tv') {
      const i = low.indexOf('emote');
      if (i < 0 || !parts[i + 2]) return url;
      parts[i + 2] = parts[i + 2].replace(/^\d+x/i, '4x').replace(/\.[a-z0-9]+$/i, '') + '.gif';
    } else {
      return url;
    }
    u.pathname = '/' + parts.join('/');
    return u.href;
  } catch (e) {
    return url;
  }
}

/* ---- Требования VK Live: WEBP/PNG, квадрат, 112..4096, <= 1 Мб, анимация ок ---- */
const VK_MIN_SIDE = 112;
const VK_MAX_BYTES = 1024 * 1024;

/* ---- Сборка анимированного WebP (RIFF/VP8X/ANIM/ANMF) без внешних зависимостей ---- */

function readFourCC(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
function writeFourCC(b, o, s) { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); }
function readUint24(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }
function writeUint24(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; }
function evenUp(n) { return n & 1 ? n + 1 : n; }
function evenDown(n) { return n & 1 ? n - 1 : n; }

function concatBytes(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Сериализует список чанков (fourcc + размер LE + данные + паддинг) в байты.
function serializeChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += 8 + c.data.length + (c.data.length & 1);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const c of chunks) {
    writeFourCC(out, p, c.id);
    dv.setUint32(p + 4, c.data.length, true);
    out.set(c.data, p + 8);
    p += 8 + c.data.length + (c.data.length & 1);
  }
  return out;
}

function serializeWebp(chunks) {
  const body = serializeChunks(chunks);
  const out = new Uint8Array(12 + body.length);
  writeFourCC(out, 0, 'RIFF');
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  writeFourCC(out, 8, 'WEBP');
  out.set(body, 12);
  return out;
}

// Разбирает top-level чанки WebP.
function readWebpChunks(bytes) {
  const b = bytes;
  if (b.length < 12 || readFourCC(b, 0) !== 'RIFF' || readFourCC(b, 8) !== 'WEBP') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const id = readFourCC(b, p);
    const size = dv.getUint32(p + 4, true);
    const start = p + 8;
    if (start + size > b.length) break;
    chunks.push({ id, data: b.slice(start, start + size) });
    p = start + size + (size & 1);
  }
  return chunks;
}

// Из статичного WebP (результат canvas.toBlob) достаёт сжатые кадровые данные.
function imageChunksFromWebp(bytes) {
  const chunks = readWebpChunks(bytes);
  if (!chunks) return null;
  const keep = chunks.filter((c) => c.id === 'ALPH' || c.id === 'VP8 ' || c.id === 'VP8L');
  if (!keep.length) return null;
  return serializeChunks(keep);
}

// Собирает анимированный WebP из готовых кадров (каждый — во всю площадь side×side).
function buildAnimatedWebp(side, frames) {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x12; // анимация (0x02) + альфа (0x10)
  writeUint24(vp8x, 4, side - 1);
  writeUint24(vp8x, 7, side - 1);
  const anim = new Uint8Array(6); // фон прозрачный, цикл бесконечный
  const chunks = [{ id: 'VP8X', data: vp8x }, { id: 'ANIM', data: anim }];
  for (const fr of frames) {
    const header = new Uint8Array(16);
    writeUint24(header, 6, side - 1);
    writeUint24(header, 9, side - 1);
    writeUint24(header, 12, Math.max(10, Math.min(0xFFFFFF, fr.durationMs | 0)));
    header[15] = 0x02; // «не смешивать»: полный кадр перезаписывает холст (прозрачные пиксели стирают прошлый кадр)
    chunks.push({ id: 'ANMF', data: concatBytes([header, fr.chunks]) });
  }
  return serializeWebp(chunks);
}

// Паддинг анимированного WebP до квадрата БЕЗ перекодирования пикселей.
// Кадрам принудительно ставится blend=1 («не смешивать»), иначе у полных кадров
// с прозрачным фоном прозрачные пиксели не стирают прошлый кадр (наслаивание).
// Возвращает байты или null, если требуется апскейл (тогда нужен ре-энкод).
function padAnimatedWebpToSquare(bytes, minSide) {
  const chunks = readWebpChunks(bytes);
  if (!chunks) return null;
  const vx = chunks.find((c) => c.id === 'VP8X');
  const anim = chunks.find((c) => c.id === 'ANIM');
  const frames = chunks.filter((c) => c.id === 'ANMF');
  if (!vx || !anim || !frames.length || vx.data.length < 10) return null;
  const cw = readUint24(vx.data, 4) + 1;
  const ch = readUint24(vx.data, 7) + 1;
  if (Math.max(cw, ch) < minSide) return null; // нужен апскейл
  const side = evenUp(Math.max(cw, ch));
  const nvx = vx.data.slice();
  nvx[0] |= 0x02;
  writeUint24(nvx, 4, side - 1);
  writeUint24(nvx, 7, side - 1);
  const dx = evenDown(Math.floor((side - cw) / 2));
  const dy = evenDown(Math.floor((side - ch) / 2));
  const queue = frames.map((f) => {
    const d = f.data.slice();
    const ox = readUint24(d, 0) * 2;
    const oy = readUint24(d, 3) * 2;
    writeUint24(d, 0, (ox + dx) >> 1);
    writeUint24(d, 3, (oy + dy) >> 1);
    d[15] = 0x02; // «не смешивать»: полный кадр перезаписывает прошлый (иначе прозрачный фон копит кадры)
    return { id: 'ANMF', data: d };
  });
  const rebuilt = chunks.map((c) => {
    if (c.id === 'VP8X') return { id: 'VP8X', data: nvx };
    if (c.id === 'ANMF') return queue.shift();
    return c;
  });
  return serializeWebp(rebuilt);
}

// Есть ли в WebP частичные/смешиваемые кадры (ANMF меньше холста, blend или dispose).
// Такие файлы рендереры (напр. VK) могут «наслаивать» друг на друга — их нужно уплоща́ть.
function webpHasPartialFrames(bytes) {
  const chunks = readWebpChunks(bytes);
  if (!chunks) return true;
  const vx = chunks.find((c) => c.id === 'VP8X');
  if (!vx || vx.data.length < 10) return true;
  const cw = readUint24(vx.data, 4) + 1;
  const ch = readUint24(vx.data, 7) + 1;
  const frames = chunks.filter((c) => c.id === 'ANMF');
  if (!frames.length) return true;
  for (const f of frames) {
    const d = f.data;
    if (d.length < 16) return true;
    if (readUint24(d, 6) + 1 !== cw || readUint24(d, 9) + 1 !== ch) return true;
    if (((d[15] >> 1) & 1) === 1 || (d[15] & 1) === 1) return true;
  }
  return false;
}

// Перекодирует любой анимированный источник (gif/webp/apng/avif) в квадратный анимированный WebP.
async function reencodeAnimatedToSquareWebp(buf, mime, minSide, quality) {
  if (typeof ImageDecoder === 'undefined') throw new Error('ImageDecoder unsupported');
  const decoder = new ImageDecoder({ data: buf, type: mime || 'application/octet-stream' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack || decoder.tracks[0];
  const count = track && track.frameCount ? track.frameCount : 1;

  const first = await decoder.decode({ frameIndex: 0 });
  const f0 = first.image;
  const srcW = f0.displayWidth || f0.codedWidth || 0;
  const srcH = f0.displayHeight || f0.codedHeight || 0;
  if (!srcW || !srcH) { try { decoder.close(); } catch (e) {} throw new Error('bad frame'); }
  const side = evenUp(Math.max(minSide, srcW, srcH));
  const scale = side / Math.max(srcW, srcH);

  const work = document.createElement('canvas');
  work.width = srcW; work.height = srcH;
  const wctx = work.getContext('2d');
  wctx.imageSmoothingEnabled = true; wctx.imageSmoothingQuality = 'high';

  const out = document.createElement('canvas');
  out.width = side; out.height = side;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';

  const frames = [];
  for (let i = 0; i < count; i++) {
    const res = i === 0 ? first : await decoder.decode({ frameIndex: i });
    const vf = res.image;
    const durUs = vf.duration || 0;
    wctx.clearRect(0, 0, srcW, srcH);
    wctx.drawImage(vf, 0, 0);
    octx.clearRect(0, 0, side, side);
    octx.drawImage(work, (side - srcW * scale) / 2, (side - srcH * scale) / 2, srcW * scale, srcH * scale);
    if (typeof vf.close === 'function') vf.close();
    const blob = await canvasToBlob(out, 'image/webp', quality);
    if (!blob) continue;
    const chunks = imageChunksFromWebp(new Uint8Array(await blob.arrayBuffer()));
    if (chunks) frames.push({ chunks, durationMs: durUs ? Math.round(durUs / 1000) : 100 });
  }
  try { decoder.close(); } catch (e) {}
  if (!frames.length) throw new Error('no frames');
  return buildAnimatedWebp(side, frames);
}

// Статичная картинка -> квадратный WebP (масштаб с сохранением пропорций, по центру).
async function encodeStaticToSquareWebp(buf, mime, minSide) {
  const img = await blobToImage(new Blob([buf], { type: mime || 'image/png' }));
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = evenUp(Math.max(minSide, w, h));
  const scale = side / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (side - w * scale) / 2, (side - h * scale) / 2, w * scale, h * scale);
  const blob = await canvasToBlob(canvas, 'image/webp', 0.95);
  if (!blob) throw new Error('webp encode failed');
  return blob;
}

async function fetchBytes(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  const buf = await res.arrayBuffer();
  if (!mime || mime === 'application/octet-stream') mime = sniffType(buf) || mime;
  return { buf, mime };
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
}

// Скачивает смайл в РОДНОМ формате провайдера (режим «GIF»): сначала пробуем GIF-вариант,
// затем обычный источник; сохраняем как есть (расширение — по факту содержимого).
async function processEmoteGif(em) {
  const candidates = [bestGifUrl(em.url, em.provider), bestSourceUrl(em.url, em.provider), em.url];
  let picked = null;
  for (const c of candidates) {
    if (!c) continue;
    let s = null;
    try { s = await fetchBytes(c); } catch (e) { continue; }
    const mime = s.mime || sniffType(s.buf) || '';
    if (!picked) picked = { buf: s.buf, mime };
    if (mime === 'image/gif') { picked = { buf: s.buf, mime }; break; }
  }
  if (!picked) throw new Error('download failed');
  const ext = extFromMime(picked.mime) || '.bin';
  await downloadBlob(new Blob([picked.buf], { type: picked.mime || 'application/octet-stream' }), emoteFileName(em, ext));
}

// Скачивает смайл как квадратный WEBP, пригодный для VK Live:
// 112..4096 px, <= 1 Мб, анимация сохраняется.
// - анимированный WebP с «плоскими» кадрами -> паддинг до квадрата (без потери качества);
// - анимированные с частичными кадрами (gif/apng/avif/частичный webp) -> уплощение
//   покадровым ре-энкодом в полноразмерные кадры (иначе VK наслаивает кадры);
// - статичные -> квадратный WebP.
async function processEmote(em) {
  if (settings && settings.emoteFormat === 'gif') return processEmoteGif(em);
  let src = null;
  for (const candidate of [bestSourceUrl(em.url, em.provider), em.url]) {
    if (!candidate) continue;
    try { src = await fetchBytes(candidate); break; } catch (e) { /* пробуем исходный url */ }
  }
  if (!src) throw new Error('download failed');

  if (isAnimatedImage(src.buf)) {
    let bytes = null;
    const raw = new Uint8Array(src.buf);
    // Паддинг безопасен только для «плоских» анимаций (полные кадры, без blend/dispose).
    // Частичные кадры уплощаем через ре-энкод — иначе VK наслаивает кадры (артефакты).
    if (!webpHasPartialFrames(raw)) {
      bytes = padAnimatedWebpToSquare(raw, VK_MIN_SIDE);
      if (bytes && bytes.length > VK_MAX_BYTES) bytes = null;
    }
    if (!bytes) {
      let last = null;
      for (const q of [0.9, 0.7, 0.5]) {
        last = await reencodeAnimatedToSquareWebp(src.buf, src.mime, VK_MIN_SIDE, q);
        if (last.length <= VK_MAX_BYTES) break;
      }
      bytes = last;
    }
    if (!bytes) throw new Error('animated encode failed');
    await downloadBlob(new Blob([bytes], { type: 'image/webp' }), emoteFileName(em, '.webp'));
    return;
  }

  const webp = await encodeStaticToSquareWebp(src.buf, src.mime, VK_MIN_SIDE);
  await downloadBlob(webp, emoteFileName(em, '.webp'));
}

async function downloadEmote(idx, card) {
  const em = collectedEmotes[idx];
  if (!em) return;
  if (card) card.classList.add('busy');
  try {
    await processEmote(em);
    if (card) { card.classList.remove('busy'); card.classList.add('done'); }
  } catch (e) {
    if (card) card.classList.remove('busy');
    flashEmoteProgress('Ошибка: ' + (em.name || em.url));
  }
}

async function downloadAllEmotes() {
  if (emotesDownloading || !collectedEmotes.length) return;
  emotesDownloading = true;
  const btn = $('#downloadAllEmotes');
  btn.disabled = true;
  const cards = Array.from($('#emoteList').children);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < collectedEmotes.length; i++) {
    flashEmoteProgress('Скачиваю ' + (i + 1) + '/' + collectedEmotes.length + '…', true);
    try {
      await processEmote(collectedEmotes[i]);
      if (cards[i]) cards[i].classList.add('done');
      ok++;
    } catch (e) {
      fail++;
    }
  }
  flashEmoteProgress('Готово: ' + ok + (fail ? ', ошибок: ' + fail : ''));
  btn.disabled = false;
  emotesDownloading = false;
}

function flashEmoteProgress(text, keep) {
  const el = $('#emoteProgress');
  if (!el) return;
  el.textContent = text;
  clearTimeout(emoteProgressTimer);
  if (!keep) emoteProgressTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}

/* ---------------- anonymizer pane ---------------- */

function setupAnonPane() {
  $('#anonToggle').addEventListener('change', onToggleAnon);
  const t = $('#anonTabToggle');
  if (t) t.addEventListener('change', onToggleAnonTab);
  $('#anonOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  renderAnonPane();
  refreshAnonTabState().catch(() => {});
  window.addEventListener('focus', () => refreshAnonTabState().catch(() => {}));
}

function currentHost() {
  if (!activeTab || !activeTab.url || !/^https?:/.test(activeTab.url)) return '';
  return hostFromUrl(activeTab.url);
}

async function onToggleAnon(ev) {
  const host = currentHost();
  if (!host) { ev.target.checked = false; return; }
  const on = ev.target.checked;
  const sites = new Set(settings.anonSites);

  if (on) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [originPattern(host)] });
    } catch (e) { granted = false; }
    if (!granted) {
      ev.target.checked = false;
      $('#siteHint').textContent = 'Нет разрешения на доступ к сайту — включить нельзя.';
      return;
    }
    sites.add(host);
  } else {
    sites.delete(host);
  }

  settings.anonSites = Array.from(sites);
  await chrome.storage.local.set({ settings });
  renderAnonPane();
}

async function onToggleAnonTab(ev) {
  const t = ev.target;
  t.disabled = true;
  let ok = false;
  try {
    ok = await chrome.runtime.sendMessage({
      type: 'ba:anonTabSet',
      tabId: activeTab && activeTab.id,
      enabled: t.checked
    });
  } catch (e) { ok = false; }
  t.disabled = false;
  if (!ok) t.checked = !t.checked;
  await refreshAnonTabState();
}

async function refreshAnonTabState() {
  const h = $('#tabAnonHost');
  const prof = $('#tabAnonProfile');
  const hint = $('#tabAnonHint');
  const tg = $('#anonTabToggle');
  const host = currentHost();
  if (h) h.textContent = host || 'Страница недоступна';
  if (tg) {
    tg.disabled = !host;
    tg.checked = false;
  }
  if (!host) {
    if (hint) hint.textContent = 'Анонимизация вкладки работает только на http/https страницах.';
    if (prof) prof.textContent = '';
    return;
  }
  let st = null;
  try {
    st = await chrome.runtime.sendMessage({
      type: 'ba:anonTabState',
      tabId: activeTab && activeTab.id
    });
  } catch (e) { st = null; }
  if (tg) tg.checked = !!(st && st.enabled);
  if (prof) prof.textContent = st && st.label ? st.label : (settings && settings.anonTab ? settings.anonTab.profileId : '');
  if (hint) {
    if (st && st.enabled) hint.textContent = 'Вкл: подменены заголовки, UA, отпечатки по профилю вкладки.';
    else hint.textContent = 'Выкл: поведение соотв. настройкам постоянного режима.';
  }
}

function renderAnonPane() {
  const host = currentHost();
  const enabled = host && settings.anonSites.includes(host);
  $('#siteHost').textContent = host || 'Страница недоступна';
  const toggle = $('#anonToggle');
  toggle.checked = !!enabled;
  toggle.disabled = !host;

  $('#siteHint').textContent = !host
    ? 'Анонимайзер работает только на http/https страницах.'
    : enabled
      ? 'Сайт в списке: заголовки и отпечатки подменяются.'
      : 'Выключено — сайт получает реальные данные браузера.';

  const items = [
    [settings.anon.ua, 'User-Agent подменяется на универсальный (заголовок и navigator)'],
    [settings.anon.acceptLanguage, 'Accept-Language → en-US,en'],
    [settings.anon.referer, 'Referer скрывается'],
    [settings.anon.clientHints, 'Client Hints и служебные заголовки (sec-ch-*, x-client-data) удаляются'],
    [settings.fp.navigator, 'Отпечаток navigator: язык, платформа, ядра, deviceMemory'],
    [settings.fp.canvas, 'Canvas-отпечаток маскируется'],
    [settings.fp.webgl, 'WebGL vendor/renderer маскируется'],
    [settings.fp.timezone, 'Часовой пояс маскируется: ' + settings.fp.timezoneValue]
  ];

  const ul = $('#anonFeatures');
  ul.textContent = '';
  for (const [on, text] of items) {
    const li = document.createElement('li');
    li.textContent = text;
    if (!on) li.classList.add('off');
    ul.appendChild(li);
  }
}
