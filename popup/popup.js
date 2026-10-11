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
  setupAnonPane();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = mergeSettings(changes.settings.newValue);
      renderAnonPane();
    }
  });
}

/* ---------------- navigation ---------------- */

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.pane').forEach((p) => { p.hidden = true; });
      $('#pane-' + btn.dataset.pane).hidden = false;
      if (btn.dataset.pane === 'tabs') refreshTabs(true).catch(() => {});
      if (btn.dataset.pane === 'points') startPointsRefresh();
      if (btn.dataset.pane !== 'points') stopPointsRefresh();
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
      w.title = 'Окно ' + (winIdx + 1);
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
    go.addEventListener('click', async () => {
      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
      window.close();
    });
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
