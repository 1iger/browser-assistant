import { mergeSettings, cleanExtensions, originPattern } from '../scripts/defaults.js';
import { ANON_PRESETS } from '../scripts/anon-profiles.js';

const $ = (s) => document.querySelector(s);

let settings = null;
let saveTimer = null;

init().catch((e) => console.error(e));

async function init() {
  const data = await chrome.storage.local.get('settings');
  settings = mergeSettings(data.settings);

  $('#extensions').value = settings.fileExtensions.join(', ');
  $('#allLinks').checked = !!settings.allLinks;

  $('#a-ua').checked = !!settings.anon.ua;
  $('#uaValue').value = settings.anon.uaValue;
  $('#a-lang').checked = !!settings.anon.acceptLanguage;
  $('#a-ref').checked = !!settings.anon.referer;
  $('#a-ch').checked = !!settings.anon.clientHints;
  $('#a-3p').checked = !!settings.anon.thirdParty;

  $('#f-nav').checked = !!settings.fp.navigator;
  $('#f-canvas').checked = !!settings.fp.canvas;
  $('#f-webgl').checked = !!settings.fp.webgl;
  $('#f-tz').checked = !!settings.fp.timezone;
  $('#tzValue').value = settings.fp.timezoneValue;

  await setupAnonTab();

  bind('#extensions', 'input', (v) => {
    settings.fileExtensions = cleanExtensions(v.split(/[\s,;]+/g));
  });
  bind('#allLinks', 'change', (v) => { settings.allLinks = v; });

  bind('#a-ua', 'change', (v) => { settings.anon.ua = v; });
  bind('#uaValue', 'input', (v) => { settings.anon.uaValue = v.trim(); });
  bind('#a-lang', 'change', (v) => { settings.anon.acceptLanguage = v; });
  bind('#a-ref', 'change', (v) => { settings.anon.referer = v; });
  bind('#a-ch', 'change', (v) => { settings.anon.clientHints = v; });

  bind('#f-nav', 'change', (v) => { settings.fp.navigator = v; });
  bind('#f-canvas', 'change', (v) => { settings.fp.canvas = v; });
  bind('#f-webgl', 'change', (v) => { settings.fp.webgl = v; });
  bind('#f-tz', 'change', (v) => { settings.fp.timezone = v; });
  bind('#tzValue', 'input', (v) => { settings.fp.timezoneValue = v.trim(); });

  $('#a-3p').addEventListener('change', onThirdParty);

  $('#badgeMode').value = settings.badgeMode === 'points' ? 'points' : 'mem';
  bind('#badgeMode', 'change', (v) => { settings.badgeMode = v; });

  $('#openStats').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('vkpoints/stats.html') });
  });

  await renderSites();
}

function bind(sel, event, apply) {
  $(sel).addEventListener(event, (ev) => {
    apply(ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value);
    save();
  });
}

function save() {
  clearTimeout(saveTimer);
  setSaveState('…', true);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ settings });
    setSaveState('Сохранено', true);
    setTimeout(() => setSaveState('', false), 1200);
  }, 250);
}

function setSaveState(text, show) {
  const el = $('#saveState');
  el.textContent = text;
  el.classList.toggle('show', !!show);
}

async function onThirdParty(ev) {
  const on = ev.target.checked;
  if (on) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: ['*://*/*'] });
    } catch (e) { granted = false; }
    if (!granted) {
      ev.target.checked = false;
      settings.anon.thirdParty = false;
      save();
      return;
    }
    settings.anon.thirdParty = true;
  } else {
    settings.anon.thirdParty = false;
    try { await chrome.permissions.remove({ origins: ['*://*/*'] }); } catch (e) {}
  }
  save();
}

async function setupAnonTab() {
  const at = settings.anonTab;
  const sel = $('#anTab-profile');
  sel.textContent = '';
  for (const p of ANON_PRESETS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.value = at.profileId;
  bind('#anTab-profile', 'change', (v) => { settings.anonTab.profileId = v; });

  $('#anTab-ua').checked = !!at.spoofUA;
  $('#anTab-lang').checked = !!at.spoofLocale;
  $('#anTab-tz').checked = !!at.spoofTimezone;
  $('#anTab-platform').checked = !!at.spoofPlatform;
  $('#anTab-hw').checked = !!at.spoofHardware;
  $('#anTab-webrtc').checked = !!at.blockWebRTC;
  $('#anTab-strip-lang').checked = !!at.stripAcceptLanguage;
  $('#anTab-strip-ch').checked = !!at.stripClientData;
  $('#anTab-screen').value = String(at.spoofScreen || 0);
  $('#anTab-geo').value = at.geoMode || 'off';

  bind('#anTab-ua', 'change', (v) => { settings.anonTab.spoofUA = v; });
  bind('#anTab-lang', 'change', (v) => { settings.anonTab.spoofLocale = v; });
  bind('#anTab-tz', 'change', (v) => { settings.anonTab.spoofTimezone = v; });
  bind('#anTab-platform', 'change', (v) => { settings.anonTab.spoofPlatform = v; });
  bind('#anTab-hw', 'change', (v) => { settings.anonTab.spoofHardware = v; });
  bind('#anTab-webrtc', 'change', (v) => { settings.anonTab.blockWebRTC = v; });
  bind('#anTab-strip-lang', 'change', (v) => { settings.anonTab.stripAcceptLanguage = v; });
  bind('#anTab-strip-ch', 'change', (v) => { settings.anonTab.stripClientData = v; });
  bind('#anTab-screen', 'change', (v) => { settings.anonTab.spoofScreen = Number(v) || 0; });
  bind('#anTab-geo', 'change', (v) => { settings.anonTab.geoMode = v; });
}

async function renderSites() {
  const box = $('#siteList');
  box.textContent = '';
  $('#siteListEmpty').hidden = settings.anonSites.length > 0;

  for (const host of settings.anonSites) {
    const item = document.createElement('div');
    item.className = 'site-item';

    const name = document.createElement('span');
    name.textContent = host;
    item.appendChild(name);

    let has = false;
    try {
      has = await chrome.permissions.contains({ origins: [originPattern(host)] });
    } catch (e) { has = false; }
    if (!has) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = 'нет доступа';
      item.appendChild(warn);
    }

    const btn = document.createElement('button');
    btn.textContent = 'Убрать';
    btn.addEventListener('click', async () => {
      settings.anonSites = settings.anonSites.filter((h) => h !== host);
      try { await chrome.permissions.remove({ origins: [originPattern(host)] }); } catch (e) {}
      await renderSites();
      save();
    });
    item.appendChild(btn);

    box.appendChild(item);
  }
}
