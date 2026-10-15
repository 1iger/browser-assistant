import {
  mergeSettings,
  CLIENT_HINT_HEADERS,
  originPattern,
  hostFromUrl
} from './defaults.js';
import {
  buildStealthConfig,
  anonPresetById,
  applyTabStealth,
  restoreTabStealth
} from './anon-profiles.js';
import './vkpoints-bg.js';

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return mergeSettings(data.settings);
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function ensureDefaults() {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) await saveSettings(mergeSettings(null));
}

/* ---------------- declarativeNetRequest rules ---------------- */

function buildHeaderOps(settings) {
  const ops = [];
  const anon = settings.anon;
  if (anon.ua && anon.uaValue) {
    ops.push({ header: 'user-agent', operation: 'set', value: anon.uaValue });
  }
  if (anon.acceptLanguage) {
    ops.push({ header: 'accept-language', operation: 'set', value: 'en-US,en;q=0.9' });
  }
  if (anon.referer) {
    ops.push({ header: 'referer', operation: 'remove' });
  }
  if (anon.clientHints) {
    for (const h of CLIENT_HINT_HEADERS) {
      ops.push({ header: h, operation: 'remove' });
    }
  }
  return ops;
}

async function rebuildRules() {
  if (!chrome.declarativeNetRequest) return;
  try {
    const settings = await getSettings();
    const ops = buildHeaderOps(settings);
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = existing
      .filter((r) => r.id >= 10000 && r.id < 20000)
      .map((r) => r.id);
    const addRules = [];
    if (ops.length && settings.anonSites.length) {
      let id = 10000;
      for (const host of settings.anonSites) {
        addRules.push({
          id: id++,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: ops },
          condition: { initiatorDomains: [host] }
        });
        addRules.push({
          id: id++,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: ops },
          condition: { requestDomains: [host] }
        });
      }
    }
    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules
      });
    }
  } catch (e) {
    console.warn('[BA] rebuildRules failed', e);
  }
}

/* ---------------- fingerprint injection ---------------- */

function fingerprintMain(cfg) {
  cfg = cfg || {};
  const UA = cfg.ua || '';

  const def = (obj, prop, desc) => {
    try {
      Object.defineProperty(obj, prop, Object.assign({ configurable: true }, desc));
    } catch (e) { /* ignore */ }
  };
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  if (cfg.navigator !== false) {
    const nav = Navigator.prototype;
    const uaVer = (UA.match(/Chrome\/(\d+)/) || [])[1] || '131';

    if (UA) {
      def(nav, 'userAgent', { get: () => UA });
      def(nav, 'appVersion', { get: () => UA.replace(/^Mozilla\//, '') });
      def(nav, 'userAgentData', {
        get: () => {
          const brands = Object.freeze([
            { brand: 'Not:A-Brand', version: '24' },
            { brand: 'Chromium', version: uaVer },
            { brand: 'Google Chrome', version: uaVer }
          ]);
          return {
            brands,
            mobile: false,
            platform: 'Windows',
            toJSON() { return { brands, mobile: false, platform: 'Windows' }; },
            getHighEntropyValues() {
              return Promise.resolve({
                arch: 'x86',
                bitness: '64',
                model: '',
                platform: 'Windows',
                platformVersion: '15.0.0',
                uaFullVersion: uaVer + '.0.0.0',
                fullVersionList: brands,
                wow64: false,
                formFactors: ['Desktop']
              });
            }
          };
        }
      });
    }

    def(nav, 'platform', { get: () => 'Win32' });
    def(nav, 'vendor', { get: () => 'Google Inc.' });
    def(nav, 'vendorSub', { get: () => '' });
    def(nav, 'productSub', { get: () => '20030107' });
    def(nav, 'language', { get: () => 'en-US' });
    def(nav, 'languages', { get: () => Object.freeze(['en-US', 'en']) });
    def(nav, 'hardwareConcurrency', { get: () => 8 });
    if ('deviceMemory' in nav) def(nav, 'deviceMemory', { get: () => 8 });
  }

  if (cfg.canvas) {
    const seed = 0x1234abcd;
    const hash = (x) => {
      x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
      x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
      return (x ^ (x >>> 16)) >>> 0;
    };
    const nz = (i) => (hash(i + seed) & 3) - 1;

    const noiseImage = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        const n = nz(i >> 2);
        data[i] = clamp(data[i] + n);
      }
    };
    const copyWithNoise = (src) => {
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const x = c.getContext('2d');
      if (!x || !c.width || !c.height) return src;
      try {
        x.drawImage(src, 0, 0);
        const img = x.getImageData(0, 0, c.width, c.height);
        noiseImage(img.data);
        x.putImageData(img, 0, 0);
      } catch (e) { return src; }
      return c;
    };

    const oToDataURL = HTMLCanvasElement.prototype.toDataURL;
    def(HTMLCanvasElement.prototype, 'toDataURL', {
      value: function () { return oToDataURL.apply(copyWithNoise(this), arguments); }
    });
    const oToBlob = HTMLCanvasElement.prototype.toBlob;
    def(HTMLCanvasElement.prototype, 'toBlob', {
      value: function () { return oToBlob.apply(copyWithNoise(this), arguments); }
    });

    const oGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    def(CanvasRenderingContext2D.prototype, 'getImageData', {
      value: function () {
        const img = oGetImageData.apply(this, arguments);
        noiseImage(img.data);
        return img;
      }
    });
  }

  if (cfg.webgl) {
    const VENDOR = 'Google Inc. (Intel)';
    const RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const patch = (proto) => {
      if (!proto || typeof proto.getParameter !== 'function') return;
      const orig = proto.getParameter;
      def(proto, 'getParameter', {
        value: function (p) {
          if (p === 37445) return VENDOR;
          if (p === 37446) return RENDERER;
          return orig.apply(this, arguments);
        }
      });
    };
    try { patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch (e) {}
    try { patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch (e) {}
  }

  if (cfg.timezone) {
    const TZ = cfg.timezoneValue || 'America/New_York';
    const OrigDTF = Intl.DateTimeFormat;

    const offsetOf = (date) => {
      const dtf = new OrigDTF('en-US', {
        timeZone: TZ,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const p = {};
      for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return -(asUTC - date.getTime()) / 60000;
    };

    const PatchedDTF = function (locales, options) {
      const opts = Object.assign({}, options || {}, { timeZone: TZ });
      return new OrigDTF(locales, opts);
    };
    PatchedDTF.prototype = OrigDTF.prototype;
    PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF);
    def(Intl, 'DateTimeFormat', { value: PatchedDTF });

    const origResolved = OrigDTF.prototype.resolvedOptions;
    def(OrigDTF.prototype, 'resolvedOptions', {
      value: function () {
        const o = origResolved.call(this);
        o.timeZone = TZ;
        return o;
      }
    });

    def(Date.prototype, 'getTimezoneOffset', { value: function () { return offsetOf(this); } });

    const origToString = Date.prototype.toString;
    def(Date.prototype, 'toString', {
      value: function () {
        try {
          const dtf = new OrigDTF('en-US', {
            timeZone: TZ,
            hourCycle: 'h23',
            weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZoneName: 'longOffset'
          });
          const p = {};
          for (const part of dtf.formatToParts(this)) p[part.type] = part.value;
          const off = (p.timeZoneName || 'GMT+0000')
            .replace('GMT+', 'GMT+')
            .replace(/^GMT$/, 'GMT+0000');
          const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
          const offStr = m
            ? 'GMT' + m[1] + String(m[2]).padStart(2, '0') + (m[3] || '00')
            : off;
          return (
            p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year + ' ' +
            p.hour + ':' + p.minute + ':' + p.second + ' ' + offStr + ' (' + TZ + ')'
          );
        } catch (e) {
          return origToString.call(this);
        }
      }
    });

    const locale = (defaults) => {
      return function (locales, options) {
        const opts = Object.assign({}, defaults, options || {}, { timeZone: TZ });
        return new OrigDTF(locales, opts).format(this);
      };
    };
    def(Date.prototype, 'toLocaleString', { value: locale({ dateStyle: 'medium', timeStyle: 'medium' }) });
    def(Date.prototype, 'toLocaleDateString', { value: locale({ dateStyle: 'medium' }) });
    def(Date.prototype, 'toLocaleTimeString', { value: locale({ timeStyle: 'medium' }) });
  }
}

async function buildFpConfig(settings) {
  return {
    ua: settings.anon.ua ? settings.anon.uaValue : '',
    navigator: settings.fp.navigator,
    canvas: settings.fp.canvas,
    webgl: settings.fp.webgl,
    timezone: settings.fp.timezone,
    timezoneValue: settings.fp.timezoneValue
  };
}

async function injectIntoTab(tabId, settings) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      injectImmediately: true,
      func: fingerprintMain,
      args: [await buildFpConfig(settings)]
    });
  } catch (e) { /* page not injectable */ }
}

async function isAnonUrl(url, settings) {
  const host = hostFromUrl(url);
  if (!host) return false;
  return settings.anonSites.some((h) => host === h || host.endsWith('.' + h));
}

async function syncInjectedTabs() {
  const settings = await getSettings();
  if (!settings.anonSites.length) return;
  const patterns = settings.anonSites.map(originPattern);
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: patterns }); } catch (e) { return; }
  for (const tab of tabs) {
    if (tab.id != null) await injectIntoTab(tab.id, settings);
  }
}

/* ---------------- anonimizer: профиль вкладки ---------------- */

const ANON_RULE_BASE = 20000;
const ANON_BADGE_COLOR = '#2e7d32';
const ANON_RES_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'
];

const anonTabSet = new Set();
const anonTabRuleIds = {};
let anonTabCounter = 0;

function anonTabHeaderOps(sett, cfg) {
  const ops = [];
  if (sett.spoofUA && cfg.ua) {
    ops.push({ header: 'user-agent', operation: 'set', value: cfg.ua });
  }
  if (sett.spoofLocale && sett.stripAcceptLanguage !== false && cfg.acceptLanguage) {
    ops.push({ header: 'accept-language', operation: 'set', value: cfg.acceptLanguage });
  }
  if (sett.stripClientData !== false) {
    for (const h of CLIENT_HINT_HEADERS) {
      ops.push({ header: h, operation: 'remove' });
    }
  }
  return ops;
}

async function anonTabCtx() {
  const settings = await getSettings();
  const realUA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const cfg = buildStealthConfig(settings.anonTab, realUA);
  return {
    cfg,
    ops: anonTabHeaderOps(settings.anonTab, cfg),
    label: anonPresetById(settings.anonTab.profileId).label
  };
}

async function ensureAnonTabRule(tabId, ctx) {
  let ruleId = anonTabRuleIds[tabId];
  if (!ctx.ops.length) {
    if (ruleId != null) {
      delete anonTabRuleIds[tabId];
      try {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      } catch (e) {}
    }
    return null;
  }
  if (ruleId == null) {
    ruleId = ANON_RULE_BASE + (anonTabCounter++);
    anonTabRuleIds[tabId] = ruleId;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: ctx.ops },
          condition: { tabIds: [tabId], resourceTypes: ANON_RES_TYPES }
        }]
      });
    } catch (e) { console.warn('[BA] anon DNR rule failed', e); }
  } else {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [{
          id: ruleId,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: ctx.ops },
          condition: { tabIds: [tabId], resourceTypes: ANON_RES_TYPES }
        }]
      });
    } catch (e) { console.warn('[BA] anon DNR rule update failed', e); }
  }
  return ruleId;
}

async function paintAnonBadge(tabId, label) {
  try {
    await chrome.action.setBadgeText({ tabId, text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: ANON_BADGE_COLOR });
    await chrome.action.setTitle({ tabId, title: 'Анонимизация: ' + label });
  } catch (e) { /* вкладка могла быть закрыта */ }
}

function clearAnonBadge(tabId) {
  try {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Browser Assistant' });
  } catch (e) { /* вкладка могла быть закрыта */ }
}

async function enableAnonTab(tabId) {
  if (anonTabSet.has(tabId)) return true;
  try {
    const ctx = await anonTabCtx();
    await ensureAnonTabRule(tabId, ctx);
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      injectImmediately: true,
      func: applyTabStealth,
      args: [ctx.cfg]
    }).catch(() => {});
    anonTabSet.add(tabId);
    await paintAnonBadge(tabId, ctx.label);
    return true;
  } catch (e) {
    console.warn('[BA] enableAnonTab failed', e);
    return false;
  }
}

async function disableAnonTab(tabId) {
  const ruleId = anonTabRuleIds[tabId];
  if (ruleId != null) {
    delete anonTabRuleIds[tabId];
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    } catch (e) {}
  }
  anonTabSet.delete(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      injectImmediately: true,
      func: restoreTabStealth
    }).catch(() => {});
  } catch (e) { /* страница не инжектируется */ }
  clearAnonBadge(tabId);
  return true;
}

// Применяет актуальные заголовки и бейдж на активных вкладках (после смены настроек или старта SW).
async function reapplyAnonTabs() {
  const tabs = [...anonTabSet];
  for (const tabId of tabs) {
    try {
      const ctx = await anonTabCtx();
      await ensureAnonTabRule(tabId, ctx);
      await paintAnonBadge(tabId, ctx.label);
    } catch (e) { /* вкладка закрыта */ }
  }
}

// Восстанавливает набор активных вкладок из session-DNR-правил после перезапуска service worker.
async function restoreAnonTabs() {
  if (!chrome.declarativeNetRequest) return;
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    let maxId = ANON_RULE_BASE - 1;
    for (const r of rules) {
      if (r.id < ANON_RULE_BASE || r.id >= 30000) continue;
      const tids = (r.condition && r.condition.tabIds) || [];
      for (const tid of tids) {
        if (typeof tid === 'number') {
          anonTabSet.add(tid);
          anonTabRuleIds[tid] = r.id;
          if (r.id > maxId) maxId = r.id;
        }
      }
    }
    anonTabCounter = maxId - ANON_RULE_BASE + 1;
  } catch (e) { console.warn('[BA] restoreAnonTabs failed', e); }
}

// Активирует вкладку из попапа: проверяет host-доступ, без него просит права.
async function anonTabRequest(tabId, enabled) {
  if (!enabled) return disableAnonTab(tabId);
  if (anonTabSet.has(tabId)) return true;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const host = tab && tab.url ? hostFromUrl(tab.url) : null;
  if (host) {
    try {
      const pattern = originPattern(host);
      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (!has) {
        await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
      }
    } catch (e) {}
  }
  return enableAnonTab(tabId);
}

let anonReapplyTimer = null;
function scheduleAnonReapply() {
  clearTimeout(anonReapplyTimer);
  setTimeout(reapplyAnonTabs, 200);
}

/* ---------------- image upload (context menu) ---------------- */

const IMAGE_MENU_ID = 'ba-upload-image';
const IMAGE_HOST_URL = 'https://catbox.moe/user/api.php';

function ensureImageMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.create({
    id: IMAGE_MENU_ID,
    title: 'Загрузить и получить ссылку',
    contexts: ['image']
  }, () => { void chrome.runtime.lastError; });
}

function baNotify(title, message) {
  if (!chrome.notifications) return;
  try {
    chrome.notifications.create('ba-upload-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: (message || '').slice(0, 250)
    }, () => { void chrome.runtime.lastError; });
  } catch (e) { /* нет notifications */ }
}

async function fetchImageBlob(srcUrl, tabId) {
  try {
    const r = await fetch(srcUrl, { credentials: 'omit', cache: 'no-store' });
    if (r.ok) return await r.blob();
  } catch (e) { /* нет доступа к домену — пробуем через вкладку */ }
  if (typeof tabId === 'number') {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [srcUrl],
        func: async (url) => {
          try {
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) return null;
            const buf = new Uint8Array(await r.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            return { b64: btoa(bin), type: r.headers.get('content-type') || 'image/png' };
          } catch (e) { return null; }
        }
      });
      const out = res && res[0] && res[0].result;
      if (out && out.b64) {
        const bin = atob(out.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: out.type });
      }
    } catch (e) { /* активная вкладка недоступна */ }
  }
  return null;
}

function imageFileName(srcUrl, type) {
  try {
    const name = decodeURIComponent(new URL(srcUrl).pathname.split('/').pop() || '');
    if (name && name.includes('.')) return name;
  } catch (e) { /* невалидный url */ }
  const ext = (type || '').split('/')[1] || 'png';
  return 'image.' + ext.replace(/[^a-z0-9]/gi, '').slice(0, 5);
}

async function copyToClipboard(text) {
  if (!chrome.offscreen) return false;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Копирование прямой ссылки на изображение в буфер обмена'
      });
    }
  } catch (e) { return false; }
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'offscreen:copy', text });
    return !!(resp && resp.ok);
  } catch (e) { return false; }
}

async function uploadImageToCatbox(srcUrl, tabId) {
  baNotify('Загрузка изображения…', 'Отправляю на catbox.moe');
  const blob = await fetchImageBlob(srcUrl, tabId);
  if (!blob || !blob.size) {
    baNotify('Не удалось получить изображение', 'Разрешите доступ к сайту в панели расширения');
    return;
  }
  let link = '';
  try {
    const fd = new FormData();
    fd.append('reqtype', 'fileupload');
    fd.append('fileToUpload', blob, imageFileName(srcUrl, blob.type));
    const up = await fetch(IMAGE_HOST_URL, { method: 'POST', body: fd });
    link = (await up.text()).trim();
  } catch (e) { link = ''; }
  if (!/^https?:\/\//i.test(link)) {
    baNotify('Ошибка загрузки', link || 'catbox.moe недоступен');
    return;
  }
  try { await chrome.storage.local.set({ lastImageLink: link }); } catch (e) {}
  const copied = await copyToClipboard(link);
  baNotify(copied ? 'Ссылка скопирована' : 'Ссылка получена', link);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === IMAGE_MENU_ID && info.srcUrl) {
    uploadImageToCatbox(info.srcUrl, tab && tab.id).catch(() => {});
  }
});

ensureImageMenu();

chrome.runtime.onStartup.addListener(() => { ensureImageMenu(); });

/* ---------------- events ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  ensureImageMenu();
  await ensureDefaults();
  await restoreAnonTabs();
  await rebuildRules();
  await reapplyAnonTabs();
  await syncInjectedTabs();
});

let rebuildTimer = null;
let syncTimer = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const s = changes.settings.newValue || {};
    badgeMode = s.badgeMode === 'points' ? 'points' : 'mem';
    refreshBadgeFromMode();
    clearTimeout(rebuildTimer);
    clearTimeout(syncTimer);
    rebuildTimer = setTimeout(rebuildRules, 60);
    syncTimer = setTimeout(syncInjectedTabs, 150);
    scheduleAnonReapply();
  }
  if (changes.vkpoints_state) {
    if (badgeMode === 'points') {
      const st = changes.vkpoints_state.newValue || {};
      paintPointsBadge(st.clicks || 0);
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'loading') return;
  const url = info.url || tab.url;
  if (!url || !/^https?:/.test(url)) return;
  if (anonTabSet.has(tabId)) {
    enableAnonTab(tabId).catch(() => {});
    return;
  }
  getSettings().then(async (settings) => {
    if (await isAnonUrl(url, settings)) await injectIntoTab(tabId, settings);
  }).catch(() => {});
});

chrome.permissions.onRemoved.addListener(() => {
  getSettings().then(async (settings) => {
    const kept = [];
    for (const host of settings.anonSites) {
      let has = false;
      try {
        has = await chrome.permissions.contains({ origins: [originPattern(host)] });
      } catch (e) { has = false; }
      if (has) kept.push(host);
    }
    if (kept.length !== settings.anonSites.length) {
      settings.anonSites = kept;
      await saveSettings(settings);
    }
  }).catch(() => {});
});

ensureDefaults().then(async () => {
  await restoreAnonTabs();
  await rebuildRules();
  await reapplyAnonTabs();
});

/* ---------------- badge mode (память | баллы) ---------------- */

let badgeMode = 'mem';
let lastTotal = 0;

function setBadgeTotal(total) {
  if (badgeMode !== 'mem') return;
  if (!chrome.action || !chrome.action.setBadgeText) return;
  const f = badgeFormat(total);
  chrome.action.setBadgeText({ text: f.text });
  chrome.action.setTitle({ title: f.title });
  if (total > 0) chrome.action.setBadgeBackgroundColor({ color: f.color });
}

function paintPointsBadge(clicks) {
  if (badgeMode !== 'points') return;
  if (!chrome.action || !chrome.action.setBadgeText) return;
  const count = clicks || 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setTitle({ title: count > 0 ? 'Баллы: ' + count : 'Browser Assistant' });
  if (count > 0) chrome.action.setBadgeBackgroundColor({ color: '#4f8cff' });
}

function refreshBadgeFromMode() {
  if (badgeMode === 'mem') {
    if (lastTotal > 0) setBadgeTotal(lastTotal);
    return;
  }
  chrome.storage.local.get('vkpoints_state', (d) => {
    const st = (d && d.vkpoints_state) || {};
    paintPointsBadge(st.clicks || 0);
  });
}

getSettings().then((s) => {
  badgeMode = s.badgeMode === 'points' ? 'points' : 'mem';
  refreshBadgeFromMode();
}).catch(() => {});

/* ---------------- memory sampling + badge (фоновый опрос) ---------------- */

let procMem = {};
let procTabs = {};
let tabPid = {};
let heapMem = {};
let heapFail = {};
let memListenerOk = false;
let lastSampleAt = 0;
let samplingPromise = null;
let popupLastSeen = 0;
let lastSnap = { memMap: {}, srcMap: {}, ready: false, apiOk: !!chrome.processes, perm: false };

const MEM_HEAP_PROBE = () => {
  try {
    const m = performance.memory;
    return m && typeof m.usedJSHeapSize === 'number' ? m.usedJSHeapSize : 0;
  } catch (e) { return 0; }
};

function hasProcData() {
  return Object.keys(procMem).length > 0;
}

function memOf(p) {
  if (!p) return null;
  let v = null;
  if (typeof p.privateMemory === 'number') v = p.privateMemory;
  else if (typeof p.memory === 'number') v = p.memory;
  else if (typeof p.jsMemoryUsed === 'number') v = p.jsMemoryUsed + (p.jsMemoryAllocated || 0);
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
}

function mergeProc(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'number') return;
  const m = memOf(p);
  if (m != null) procMem[p.id] = m;
  if (Array.isArray(p.tasks)) {
    procTabs[p.id] = [...new Set(
      p.tasks.map((t) => (t ? t.tabId : null)).filter((t) => typeof t === 'number')
    )];
  }
}

function mergeProcInfo(info) {
  if (!info || typeof info !== 'object') return;
  for (const k of Object.keys(info)) mergeProc(info[k]);
}

function buildTabMap(tabIds) {
  const known = new Set(tabIds);
  const map = {};

  const taskTabs = {};
  for (const pid of Object.keys(procTabs)) {
    if (!procMem[pid]) continue;
    const list = [...new Set(procTabs[pid].filter((t) => known.has(t)))];
    if (list.length) taskTabs[pid] = list;
  }

  const covered = new Set();
  for (const pid of Object.keys(taskTabs)) {
    for (const t of taskTabs[pid]) covered.add(t);
  }

  const extras = {};
  for (const t of tabIds) {
    if (covered.has(t)) continue;
    const pid = tabPid[t];
    if (!pid || pid <= 0 || !procMem[pid]) continue;
    if (!extras[pid]) extras[pid] = [];
    extras[pid].push(t);
  }

  const pids = new Set([...Object.keys(taskTabs), ...Object.keys(extras)]);
  for (const pid of pids) {
    const list = [
      ...new Set([...(taskTabs[pid] || []), ...(extras[pid] || [])])
    ].filter((t) => !(t in map));
    if (!list.length) continue;
    const share = procMem[pid] / list.length;
    for (const t of list) map[t] = share;
  }
  return map;
}

function getProcessInfo(ids) {
  return new Promise((resolve) => {
    if (!chrome.processes || typeof chrome.processes.getProcessInfo !== 'function') {
      return resolve(null);
    }
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const r = chrome.processes.getProcessInfo(ids, true);
      if (r && typeof r.then === 'function') {
        r.then((v) => finish(v), () => finish(null));
        return;
      }
    } catch (e) { /* нет промис-формы — пробуем callback */ }
    try {
      chrome.processes.getProcessInfo(ids, true, (info) => {
        if (chrome.runtime.lastError) return finish(null);
        finish(info || null);
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 6000);
  });
}

async function pidForTab(tabId) {
  if (!chrome.processes || !chrome.processes.getProcessIdForTab) return null;
  try {
    const r = chrome.processes.getProcessIdForTab(tabId);
    if (r && typeof r.then === 'function') {
      const pid = await r;
      return typeof pid === 'number' && pid > 0 ? pid : null;
    }
  } catch (e) { /* try callback style */ }
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    try {
      chrome.processes.getProcessIdForTab(tabId, (pid) => {
        if (chrome.runtime.lastError) return finish(null);
        finish(typeof pid === 'number' && pid > 0 ? pid : null);
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 1500);
  });
}

function startProcMonitor() {
  if (!chrome.processes || memListenerOk) return;
  if (chrome.processes.onUpdatedWithMemory) {
    try {
      chrome.processes.onUpdatedWithMemory.addListener(mergeProcInfo);
      memListenerOk = true;
    } catch (e) { memListenerOk = false; }
  }
}

async function sampleHeapsBg(tabs) {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  if (hasProcData()) return;

  const now = Date.now();
  const targets = tabs.filter((t) =>
    typeof t.id === 'number' &&
    !t.discarded && !t.frozen &&
    t.status === 'complete' &&
    /^https?:\/\//.test(t.url || '') &&
    now >= (heapFail[t.id] || 0)
  );

  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const t = targets[i++];
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: t.id, frameIds: [0] },
          world: 'MAIN',
          injectImmediately: true,
          func: MEM_HEAP_PROBE
        });
        const v = res && res[0] && res[0].result;
        heapMem[t.id] = typeof v === 'number' && v > 0 ? Math.round(v / 1024) * 1024 : null;
        delete heapFail[t.id];
      } catch (e) {
        heapMem[t.id] = null;
        heapFail[t.id] = Date.now() + 15000;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function badgeFormat(total) {
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
    title = 'Память вкладок: ' + fmtBadge(total);
    color = total >= 4 * 1073741824 ? '#ef4444' : total >= 1073741824 ? '#f59e0b' : '#22c55e';
  }
  return { text, title, color };
}

function fmtBadge(b) {
  const mb = b / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' ГБ';
  if (mb >= 10) return mb.toFixed(0) + ' МБ';
  return mb.toFixed(1) + ' МБ';
}

async function getMemory(fromPopup, force) {
  if (!force) {
    if (!fromPopup && Date.now() - popupLastSeen < 4000) return lastSnap;
    if (Date.now() - lastSampleAt < 7000) return lastSnap;
  }
  if (samplingPromise) {
    if (force) { try { await samplingPromise; } catch (e) {} }
    return lastSnap;
  }
  lastSampleAt = Date.now();
  samplingPromise = doSample();
  try { await samplingPromise; } catch (e) { /* ошибка уже залогирована */ } finally {
    samplingPromise = null;
  }
  return lastSnap;
}

async function doSample() {
  try {
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); } catch (e) { tabs = []; }
    const ids = tabs.map((t) => t.id).filter((x) => typeof x === 'number');
    const idSet = new Set(ids);
    for (const k of Object.keys(heapMem)) if (!idSet.has(Number(k))) delete heapMem[k];
    for (const k of Object.keys(tabPid)) if (!idSet.has(Number(k))) delete tabPid[k];

    startProcMonitor();
    if (chrome.processes && !hasProcData()) {
      const info = await getProcessInfo(undefined);
      if (info) mergeProcInfo(info);
    }

    let procMap = buildTabMap(ids);
    if (hasProcData()) {
      const needPid = ids.filter((id) => !(id in procMap) && tabPid[id] !== 0 && !(tabPid[id] > 0));
      if (needPid.length) {
        await Promise.all(needPid.slice(0, 40).map(async (id) => {
          const pid = await pidForTab(id);
          tabPid[id] = pid && pid > 0 ? pid : -1;
        }));
        procMap = buildTabMap(ids);
      }
    } else {
      await sampleHeapsBg(tabs);
    }

    const memMap = {};
    const srcMap = {};
    for (const id of ids) {
      if (typeof procMap[id] === 'number' && procMap[id] > 0) {
        memMap[id] = procMap[id];
        srcMap[id] = 'proc';
      } else if (heapMem[id] > 0) {
        memMap[id] = heapMem[id];
        srcMap[id] = 'heap';
      }
    }

    const total = ids.reduce((s, id) => s + (memMap[id] || 0), 0);
    lastTotal = total;
    let perm = false;
    try { perm = !!(await chrome.permissions.contains({ origins: ['*://*/*'] })); } catch (e) { perm = false; }

    lastSnap = { memMap, srcMap, ready: total > 0, apiOk: !!chrome.processes, perm };
    if (Date.now() - popupLastSeen >= 4000) setBadgeTotal(total);
  } catch (e) {
    console.warn('[BA] getMemory failed', e);
  }
}

/* heartbeat-скрипт регистрируется только после выдачи host-доступа */
const HEARTBEAT_ID = 'ba-heartbeat';

async function hasAllSitesPerm() {
  try { return await chrome.permissions.contains({ origins: ['*://*/*'] }); }
  catch (e) { return false; }
}

async function ensureHeartbeat() {
  if (!await hasAllSitesPerm()) return;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HEARTBEAT_ID] });
    if (existing && existing.length) return;
    await chrome.scripting.registerContentScripts([{
      id: HEARTBEAT_ID,
      js: ['scripts/heartbeat.js'],
      matches: ['http://*/*', 'https://*/*'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true
    }]);
  } catch (e) { console.warn('[BA] registerContentScripts failed', e); }
}

async function removeHeartbeat() {
  try { await chrome.scripting.unregisterContentScripts({ ids: [HEARTBEAT_ID] }); }
  catch (e) { /* не зарегистрирован */ }
}

ensureHeartbeat();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'mem') {
    popupLastSeen = Date.now();
    getMemory(true, !!msg.force)
      .then((snap) => sendResponse(snap))
      .catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === 'ba:anonTabState') {
    getSettings().then(async (settings) => {
      const tabId = typeof msg.tabId === 'number' ? msg.tabId : (sender.tab && sender.tab.id);
      let profile = {};
      try { profile = anonPresetById(settings.anonTab.profileId); } catch (e) {}
      sendResponse({
        enabled: typeof tabId === 'number' && anonTabSet.has(tabId),
        profileId: settings.anonTab.profileId,
        label: profile.label || ''
      });
    }).catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === 'ba:anonTabSet') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : (sender.tab && sender.tab.id);
    if (typeof tabId !== 'number') {
      sendResponse(false);
      return true;
    }
    anonTabRequest(tabId, !!msg.enabled).then((ok) => sendResponse(!!ok)).catch(() => sendResponse(false));
    return true;
  }
  if (msg.type === 'ba-heartbeat') {
    getMemory(false, false).catch(() => {});
    return false;
  }
  return false;
});

chrome.alarms.create('ba-mem', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'ba-mem') getMemory(false, false).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (anonTabSet.has(tabId)) {
    anonTabSet.delete(tabId);
    delete anonTabRuleIds[tabId];
  }
  getMemory(false, false).catch(() => {});
  if (chrome.declarativeNetRequest) {
    chrome.declarativeNetRequest.getSessionRules().then((rules) => {
      const stale = rules
        .filter((r) => r.id >= ANON_RULE_BASE && r.condition && Array.isArray(r.condition.tabIds) && r.condition.tabIds.includes(tabId))
        .map((r) => r.id);
      if (stale.length) chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale }).catch(() => {});
    }).catch(() => {});
  }
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  getMemory(false, false).catch(() => {});
});

chrome.permissions.onAdded.addListener((perms) => {
  heapFail = {};
  heapMem = {};
  lastSampleAt = 0;
  const origins = (perms && perms.origins) || [];
  if (origins.includes('*://*/*')) ensureHeartbeat();
  getMemory(false, true).catch(() => {});
});

chrome.permissions.onRemoved.addListener((perms) => {
  const origins = (perms && perms.origins) || [];
  if (origins.includes('*://*/*')) removeHeartbeat();
  if (!(perms && perms.origins) || !anonTabSet.size) return;
  const gone = [];
  const pending = [...anonTabSet].map(async (tabId) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      const host = tab.url ? hostFromUrl(tab.url) : null;
      if (!host) return;
      const has = await chrome.permissions.contains({ origins: [originPattern(host)] });
      if (!has) gone.push(tabId);
    } catch (e) { /* вкладка закрыта */ }
  });
  Promise.all(pending).then(() => {
    for (const tid of gone) disableAnonTab(tid).catch(() => {});
  }).catch(() => {});
});