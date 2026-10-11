// Профили анонимизации по вкладке (портуровано из Anonymizer Tab).
// Здесь: профили стран/локалей (ANON_PRESETS), платформы (ANON_PLATFORMS),
// сборка конфига (buildStealthConfig) и два самодостаточных скрипта для
// MAIN world страницы (applyTabStealth / restoreTabStealth).

export const ANON_PLATFORMS = {
  windows: {
    label: 'Windows',
    platform: 'Win32',
    udPlatform: 'Windows',
    udPlatformVersion: '15.0.0',
    cpu: 'Windows NT 10.0; Win64; x64',
    arch: 'x86',
    bitness: '64',
    wow64: false,
    maxTouchPoints: 0,
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/VER Safari/537.36'
  },
  mac: {
    label: 'macOS',
    platform: 'MacIntel',
    udPlatform: 'macOS',
    udPlatformVersion: '10_15_7',
    cpu: 'Macintosh; Intel Mac OS X 10_15_7',
    arch: 'x86',
    bitness: '64',
    wow64: false,
    maxTouchPoints: 0,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/VER Safari/537.36'
  },
  linux: {
    label: 'Linux',
    platform: 'Linux x86_64',
    udPlatform: 'Linux',
    udPlatformVersion: '',
    cpu: 'X11; Linux x86_64',
    arch: 'x86',
    bitness: '64',
    wow64: false,
    maxTouchPoints: 0,
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/VER Safari/537.36'
  }
};

export const ANON_PRESETS = [
  { id: 'us-east', label: 'США, Нью-Йорк', locale: 'en-US', languages: ['en-US', 'en'], timeZone: 'America/New_York', acceptLanguage: 'en-US,en;q=0.9', platform: 'windows', lat: 40.7128, lng: -74.006 },
  { id: 'us-west', label: 'США, Лос-Анджелес', locale: 'en-US', languages: ['en-US', 'en'], timeZone: 'America/Los_Angeles', acceptLanguage: 'en-US,en;q=0.9', platform: 'windows', lat: 34.0522, lng: -118.2437 },
  { id: 'gb', label: 'Великобритания, Лондон', locale: 'en-GB', languages: ['en-GB', 'en'], timeZone: 'Europe/London', acceptLanguage: 'en-GB,en;q=0.9', platform: 'windows', lat: 51.5074, lng: -0.1278 },
  { id: 'ca', label: 'Канада, Торонто', locale: 'en-CA', languages: ['en-CA', 'en'], timeZone: 'America/Toronto', acceptLanguage: 'en-CA,en;q=0.9', platform: 'windows', lat: 43.6532, lng: -79.3832 },
  { id: 'au', label: 'Австралия, Сидней', locale: 'en-AU', languages: ['en-AU', 'en'], timeZone: 'Australia/Sydney', acceptLanguage: 'en-AU,en;q=0.9', platform: 'windows', lat: -33.8688, lng: 151.2093 },
  { id: 'de', label: 'Германия, Берлин', locale: 'de-DE', languages: ['de-DE', 'de', 'en-US'], timeZone: 'Europe/Berlin', acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8', platform: 'windows', lat: 52.52, lng: 13.405 },
  { id: 'fr', label: 'Франция, Париж', locale: 'fr-FR', languages: ['fr-FR', 'fr', 'en-US'], timeZone: 'Europe/Paris', acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.8', platform: 'windows', lat: 48.8566, lng: 2.3522 },
  { id: 'nl', label: 'Нидерланды, Амстердам', locale: 'nl-NL', languages: ['nl-NL', 'nl', 'en-US'], timeZone: 'Europe/Amsterdam', acceptLanguage: 'nl-NL,nl;q=0.9,en-US;q=0.8', platform: 'windows', lat: 52.3676, lng: 4.9041 },
  { id: 'se', label: 'Швеция, Стокгольм', locale: 'sv-SE', languages: ['sv-SE', 'sv', 'en-US'], timeZone: 'Europe/Stockholm', acceptLanguage: 'sv-SE,sv;q=0.9,en-US;q=0.8', platform: 'windows', lat: 59.3293, lng: 18.0686 },
  { id: 'fi', label: 'Финляндия, Хельсинки', locale: 'fi-FI', languages: ['fi-FI', 'fi', 'en-US'], timeZone: 'Europe/Helsinki', acceptLanguage: 'fi-FI,fi;q=0.9,en-US;q=0.8', platform: 'windows', lat: 60.1699, lng: 24.9384 },
  { id: 'no', label: 'Норвегия, Осло', locale: 'nb-NO', languages: ['nb-NO', 'nb', 'en-US'], timeZone: 'Europe/Oslo', acceptLanguage: 'nb-NO,nb;q=0.9,en-US;q=0.8', platform: 'windows', lat: 59.9139, lng: 10.7522 },
  { id: 'dk', label: 'Дания, Копенгаген', locale: 'da-DK', languages: ['da-DK', 'da', 'en-US'], timeZone: 'Europe/Copenhagen', acceptLanguage: 'da-DK,da;q=0.9,en-US;q=0.8', platform: 'windows', lat: 55.6761, lng: 12.5683 },
  { id: 'pl', label: 'Польша, Варшава', locale: 'pl-PL', languages: ['pl-PL', 'pl', 'en-US'], timeZone: 'Europe/Warsaw', acceptLanguage: 'pl-PL,pl;q=0.9,en-US;q=0.8', platform: 'windows', lat: 52.2297, lng: 21.0122 },
  { id: 'br', label: 'Бразилия, Сан-Паулу', locale: 'pt-BR', languages: ['pt-BR', 'pt', 'en-US'], timeZone: 'America/Sao_Paulo', acceptLanguage: 'pt-BR,pt;q=0.9,en-US;q=0.8', platform: 'windows', lat: -23.5505, lng: -46.6333 },
  { id: 'mx', label: 'Мексика, Мехико', locale: 'es-MX', languages: ['es-MX', 'es', 'en-US'], timeZone: 'America/Mexico_City', acceptLanguage: 'es-MX,es;q=0.9,en-US;q=0.8', platform: 'windows', lat: 19.4326, lng: -99.1332 },
  { id: 'jp', label: 'Япония, Токио', locale: 'ja-JP', languages: ['ja-JP', 'ja', 'en-US'], timeZone: 'Asia/Tokyo', acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8', platform: 'windows', lat: 35.6762, lng: 139.6503 },
  { id: 'kr', label: 'Корея, Сеул', locale: 'ko-KR', languages: ['ko-KR', 'ko', 'en-US'], timeZone: 'Asia/Seoul', acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8', platform: 'windows', lat: 37.5665, lng: 126.978 },
  { id: 'in', label: 'Индия, Мумбаи', locale: 'en-IN', languages: ['en-IN', 'hi', 'en'], timeZone: 'Asia/Kolkata', acceptLanguage: 'en-IN,en;q=0.9', platform: 'windows', lat: 19.076, lng: 72.8777 },
  { id: 'ua', label: 'Украина, Киев', locale: 'uk-UA', languages: ['uk-UA', 'ru', 'en-US'], timeZone: 'Europe/Kyiv', acceptLanguage: 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7', platform: 'windows', lat: 50.4501, lng: 30.5234 },
  { id: 'za', label: 'ЮАР, Йоханнесбург', locale: 'en-ZA', languages: ['en-ZA', 'en'], timeZone: 'Africa/Johannesburg', acceptLanguage: 'en-ZA,en;q=0.9', platform: 'windows', lat: -26.2041, lng: 28.0473 }
];

export const SCREEN_PRESETS = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24, pixelDepth: 24 },
  { width: 1440, height: 900, availWidth: 1440, availHeight: 860, colorDepth: 24, pixelDepth: 24 }
];

// База смещения (минуты восточнее UTC) на случай, если точный расчёт Intl недоступен.
const TZ_BASE_EAST = {
  'America/New_York': -300, 'America/Los_Angeles': -480, 'Europe/London': 0,
  'America/Toronto': -300, 'Australia/Sydney': 600, 'Europe/Berlin': 60,
  'Europe/Paris': 60, 'Europe/Amsterdam': 60, 'Europe/Stockholm': 60,
  'Europe/Helsinki': 120, 'Europe/Oslo': 60, 'Europe/Copenhagen': 60,
  'Europe/Warsaw': 60, 'America/Sao_Paulo': -180, 'America/Mexico_City': -360,
  'Asia/Tokyo': 540, 'Asia/Seoul': 540, 'Asia/Kolkata': 330,
  'Europe/Kyiv': 120, 'Africa/Johannesburg': 120
};

export function anonPresetById(id) {
  return ANON_PRESETS.find((p) => p.id === id) || ANON_PRESETS[0];
}

function chromeVersionFromUA(ua) {
  const m = /Chrome\/(\d+(?:\.\d+)+)/.exec(ua || '');
  return m ? m[1] : '131.0.0.0';
}

// Точное смещение в минутах (восточнее UTC) для заданного часового пояса на текущий момент.
function eastMinutesFor(tz) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const part of fmt.formatToParts(now)) {
      if (part.type !== 'literal') p[part.type] = part.value;
    }
    let h = parseInt(p.hour, 10);
    if (h === 24) h = 0;
    const localMillis = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
    let diff = Math.round((now.getTime() - localMillis) / 60000);
    while (diff < -720) diff += 1440;
    while (diff > 720) diff -= 1440;
    return diff;
  } catch (e) {
    return TZ_BASE_EAST[tz] !== undefined ? TZ_BASE_EAST[tz] : 0;
  }
}

function tzNames(tz) {
  try {
    const now = new Date();
    const part = (name) => {
      const arr = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: name }).formatToParts(now);
      const f = arr.find((x) => x.type === 'timeZoneName');
      return f ? f.value : '';
    };
    return { short: part('short'), long: part('long') };
  } catch (e) {
    return { short: 'GMT', long: tz };
  }
}

// Сборка конфига по настройкам settings.anonTab. В конфиг попадают только те
// поля, которые соответствуют включённым переключателям.
export function buildStealthConfig(sett, realUA) {
  const preset = anonPresetById(sett.profileId);
  const pf = ANON_PLATFORMS[preset.platform] || ANON_PLATFORMS.windows;
  const realAgent = realUA || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const ver = chromeVersionFromUA(realAgent);
  const major = ver.split('.')[0];
  const brands = [
    { brand: 'Chromium', version: String(major) },
    { brand: 'Google Chrome', version: String(major) },
    { brand: 'Not/A)Brand', version: '24' },
    { brand: 'Not_A Brand', version: '24' }
  ];
  const fullVersionList = [
    { brand: 'Chromium', version: ver },
    { brand: 'Google Chrome', version: ver },
    { brand: 'Not/A)Brand', version: '24.0.0.0' },
    { brand: 'Not_A Brand', version: '24.0.0.0' }
  ];

  const cfg = { blockWebRTC: !!sett.blockWebRTC };

  if (sett.spoofUA) {
    cfg.ua = pf.ua.replace('VER', ver);
    cfg.appVersion = '5.0 (' + pf.cpu + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + ver + ' Safari/537.36';
    cfg.brands = brands.map((b) => ({ ...b }));
    cfg.fullVersionList = fullVersionList.map((b) => ({ ...b }));
  }
  if (sett.spoofPlatform) {
    cfg.platform = pf.platform;
    cfg.udPlatform = pf.udPlatform;
    cfg.udPlatformVersion = pf.udPlatformVersion || '';
    cfg.arch = pf.arch;
    cfg.bitness = pf.bitness;
    cfg.wow64 = !!pf.wow64;
    cfg.vendor = 'Google Inc.';
  }
  if (sett.spoofHardware) {
    cfg.maxTouchPoints = pf.maxTouchPoints;
    cfg.concurrency = 16;
    cfg.deviceMemory = 8;
  }
  if (sett.spoofLocale) {
    cfg.locale = preset.locale;
    cfg.languages = preset.languages.slice();
    cfg.acceptLanguage = preset.acceptLanguage;
  }
  if (sett.spoofTimezone) {
    cfg.timeZone = preset.timeZone;
    cfg.tzOffsetMin = -eastMinutesFor(preset.timeZone);
    const names = tzNames(preset.timeZone);
    cfg.tzShort = names.short;
    cfg.tzLong = names.long;
  }
  if (sett.spoofScreen) {
    cfg.screen = SCREEN_PRESETS[sett.spoofScreen - 1] || SCREEN_PRESETS[0];
  }
  cfg.geoMode = sett.geoMode || 'off';
  if (cfg.geoMode !== 'off') cfg.geoCoords = { lat: preset.lat, lng: preset.lng, accuracy: 10 };
  return cfg;
}

// ---------- Всё ниже выполняется в MAIN world страницы ----------

export function applyTabStealth(cfg) {
  cfg = cfg || {};
  if (window.__baAnonApplied__) return;
  window.__baAnonApplied__ = true;
  const saved = (window.__baAnonSaved__ = window.__baAnonSaved__ || {});

  const targets = [navigator];
  try { targets.push(Object.getPrototypeOf(navigator)); } catch (e) {}

  function patch(key, get) {
    for (const t of targets) {
      try {
        const map = (saved.props = saved.props || {});
        const arr = (map[key] = map[key] || []);
        if (!arr.some((s) => s.obj === t)) {
          arr.push({ obj: t, desc: Object.getOwnPropertyDescriptor(t, key) || null });
        }
        Object.defineProperty(t, key, { get, configurable: true, enumerable: true });
      } catch (e) {}
    }
  }

  // ---- navigator ----
  if (cfg.ua) {
    patch('userAgent', () => cfg.ua);
    patch('appVersion', () => cfg.appVersion || cfg.ua.replace(/^Mozilla\//, ''));
  }
  if (cfg.platform !== undefined) {
    patch('platform', () => cfg.platform);
    patch('vendor', () => cfg.vendor || 'Google Inc.');
  }
  if (cfg.locale !== undefined) {
    patch('language', () => cfg.locale);
    patch('languages', () => (cfg.languages || []).slice());
  }
  if (cfg.maxTouchPoints !== undefined) patch('maxTouchPoints', () => cfg.maxTouchPoints);
  if (cfg.concurrency !== undefined) patch('hardwareConcurrency', () => cfg.concurrency);
  if (cfg.deviceMemory !== undefined) patch('deviceMemory', () => cfg.deviceMemory);

  if (cfg.brands && 'userAgentData' in navigator) {
    const udPlatform = cfg.udPlatform !== undefined ? cfg.udPlatform : 'Windows';
    const uad = {
      brands: cfg.brands.map((b) => ({ ...b })),
      mobile: false,
      platform: udPlatform,
      getHighEntropyValues: async (hints) => {
        const out = {};
        for (const h of (hints || [])) {
          switch (h) {
            case 'architecture': out.architecture = cfg.arch !== undefined ? cfg.arch : 'x86'; break;
            case 'bitness': out.bitness = cfg.bitness !== undefined ? cfg.bitness : '64'; break;
            case 'brands': out.brands = cfg.brands.map((b) => ({ ...b })); break;
            case 'fullVersionList': out.fullVersionList = (cfg.fullVersionList || []).map((b) => ({ ...b })); break;
            case 'mobile': out.mobile = false; break;
            case 'model': out.model = ''; break;
            case 'platform': out.platform = udPlatform; break;
            case 'platformVersion': out.platformVersion = cfg.udPlatformVersion !== undefined ? cfg.udPlatformVersion : ''; break;
            case 'uaFullVersion': out.uaFullVersion = (cfg.ua && cfg.ua.split('Chrome/')[1]) || ''; break;
            case 'wow64': out.wow64 = !!cfg.wow64; break;
            default: out[h] = undefined;
          }
        }
        return out;
      },
      toJSON: () => ({ brands: cfg.brands.map((b) => ({ ...b })), mobile: false, platform: udPlatform })
    };
    patch('userAgentData', () => uad);
  }

  // ---- экран ----
  if (cfg.screen) {
    let st;
    try { st = Object.getPrototypeOf(screen); } catch (e) { st = screen; }
    for (const key of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
      const value = cfg.screen[key];
      if (value === undefined) continue;
      for (const t of [screen, st]) {
        try {
          const map = (saved.props = saved.props || {});
          const arr = (map[key] = map[key] || []);
          if (!arr.some((s) => s.obj === t)) {
            arr.push({ obj: t, desc: Object.getOwnPropertyDescriptor(t, key) || null });
          }
          Object.defineProperty(t, key, { get: () => value, configurable: true, enumerable: true });
        } catch (e) {}
      }
    }
  }

  // ---- геолокация ----
  if (cfg.geoMode && cfg.geoMode !== 'off') {
    const geo = navigator.geolocation;
    if (geo) {
      const pos = {
        coords: {
          latitude: cfg.geoCoords.lat, longitude: cfg.geoCoords.lng, altitude: null,
          accuracy: cfg.geoCoords.accuracy || 10, altitudeAccuracy: null, heading: null, speed: null
        },
        timestamp: Date.now()
      };
      const patchGeo = (key, fn) => {
        try {
          const arr = (saved.geo = saved.geo || []);
          if (!arr.some((s) => s.obj === geo && s.key === key)) {
            arr.push({ obj: geo, key, desc: Object.getOwnPropertyDescriptor(geo, key) || null });
          }
          geo[key] = fn;
        } catch (e) {}
      };
      if (cfg.geoMode === 'block') {
        const deny = (cb) => { if (cb) { setTimeout(() => cb(Object.assign(new Error('User denied Geolocation'), { code: 1 })), 0); } };
        patchGeo('getCurrentPosition', (s, e) => deny(e));
        patchGeo('watchPosition', (s, e) => { deny(e); return 0; });
        patchGeo('clearWatch', () => {});
      } else {
        patchGeo('getCurrentPosition', (s) => { if (s) setTimeout(() => s(pos), 0); });
        patchGeo('watchPosition', (s) => { if (s) setTimeout(() => s(pos), 0); return 1; });
        patchGeo('clearWatch', () => {});
      }
    }
  }

  // ---- дата / часовой пояс ----
  const offsetMin = cfg.tzOffsetMin;
  const DATE_KEYS = ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds'];
  const UTC_OF = { getFullYear: 'getUTCFullYear', getMonth: 'getUTCMonth', getDate: 'getUTCDate', getDay: 'getUTCDay', getHours: 'getUTCHours', getMinutes: 'getUTCMinutes', getSeconds: 'getUTCSeconds', getMilliseconds: 'getUTCMilliseconds' };
  const LOCAL_KEYS = DATE_KEYS.concat(['getTimezoneOffset', 'toString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);

  saved.origDate = {};
  for (const k of LOCAL_KEYS) {
    try { saved.origDate[k] = Date.prototype[k]; } catch (e) {}
  }

  if (offsetMin !== undefined) {
    const shift = offsetMin * 60000;
    const shifted = (d) => new Date(d.getTime() + shift);
    for (const k of DATE_KEYS) {
      const utc = UTC_OF[k];
      Date.prototype[k] = function () { return shifted(this)['getUTC' + utc.slice(3)](); };
    }
    Date.prototype.getTimezoneOffset = function () { return offsetMin; };

    const pad = (n) => String(n).padStart(2, '0');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const sign = offsetMin < 0 ? '-' : '+';
    const a = Math.abs(offsetMin);
    const gmt = 'GMT' + sign + pad(Math.floor(a / 60)) + pad(a % 60);
    const tzName = cfg.tzLong || cfg.tzShort || gmt;

    Date.prototype.toString = function () {
      const d = new Date(this.getTime());
      return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + pad(d.getDate()) + ' ' +
        d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
        ' ' + gmt + ' (' + tzName + ')';
    };
    Date.prototype.toTimeString = function () {
      const d = new Date(this.getTime());
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + gmt + ' (' + tzName + ')';
    };
  }

  if (cfg.timeZone) {
    const fallback = function () { return this.toString(); };
    const setTz = (key) => {
      Date.prototype[key] = function (locales, options) {
        const o = Object.assign({}, options || {});
        if (!o.timeZone) o.timeZone = cfg.timeZone;
        return (saved.origDate[key] || fallback).call(this, locales === undefined ? cfg.locale : locales, o);
      };
    };
    setTz('toLocaleString');
    setTz('toLocaleDateString');
    setTz('toLocaleTimeString');

    const OrigDTF = Intl.DateTimeFormat;
    saved.OrigDTF = OrigDTF;
    Intl.DateTimeFormat = function (locales, options) {
      const o = Object.assign({}, options || {});
      if (!o.timeZone) o.timeZone = cfg.timeZone;
      return new OrigDTF(locales === undefined ? cfg.locale : locales, o);
    };
    Intl.DateTimeFormat.prototype = OrigDTF.prototype;
    try { Object.setPrototypeOf(Intl.DateTimeFormat, OrigDTF); } catch (e) {}
  }

  // ---- WebRTC ----
  if (cfg.blockWebRTC) {
    saved.webrtc = saved.webrtc || {};
    for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
      if (k in window) {
        try {
          saved.webrtc[k] = window[k];
          window[k] = function DisabledRTCPeerConnection() {
            throw new DOMException('WebRTC is disabled in this tab by Browser Assistant', 'NotSupportedError');
          };
        } catch (e) {}
      }
    }
  }
}

export function restoreTabStealth() {
  if (!window.__baAnonSaved__ && !window.__baAnonApplied__) return false;
  const saved = window.__baAnonSaved__ || {};

  if (saved.props) {
    for (const key of Object.keys(saved.props)) {
      for (const { obj, desc } of saved.props[key]) {
        try {
          if (desc) Object.defineProperty(obj, key, desc);
          else delete obj[key];
        } catch (e) {}
      }
    }
  }
  if (saved.geo) {
    for (const { obj, key, desc } of saved.geo) {
      try {
        if (desc) Object.defineProperty(obj, key, desc);
        else delete obj[key];
      } catch (e) {}
    }
  }
  if (saved.origDate) {
    for (const k of Object.keys(saved.origDate)) {
      try { Date.prototype[k] = saved.origDate[k]; } catch (e) {}
    }
  }
  if (saved.OrigDTF) {
    try { Intl.DateTimeFormat = saved.OrigDTF; } catch (e) {}
  }
  if (saved.webrtc) {
    for (const k of Object.keys(saved.webrtc)) {
      try { window[k] = saved.webrtc[k]; } catch (e) {}
    }
  }

  try { delete window.__baAnonApplied__; } catch (e) {}
  try { delete window.__baAnonSaved__; } catch (e) {}
  return true;
}