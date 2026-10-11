export const DEFAULTS = {
  fileExtensions: [
    'pdf', 'zip', 'rar', '7z', 'gz', 'tar', 'exe', 'msi', 'dmg', 'pkg',
    'apk', 'deb', 'rpm', 'iso', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'csv',
    'ppt', 'pptx', 'txt', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mkv',
    'avi', 'mov', 'webm', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
    'woff', 'woff2', 'ttf', 'torrent'
  ],
  allLinks: false,
  badgeMode: 'mem',
  anonSites: [],
  anon: {
    ua: true,
    uaValue: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: true,
    referer: true,
    clientHints: true,
    thirdParty: false
  },
  fp: {
    navigator: true,
    canvas: true,
    webgl: true,
    timezone: false,
    timezoneValue: 'America/New_York'
  },
  anonTab: {
    profileId: 'us-east',
    spoofUA: true,
    spoofLocale: true,
    spoofTimezone: true,
    spoofPlatform: true,
    spoofHardware: true,
    spoofScreen: 0,
    stripAcceptLanguage: true,
    stripClientData: true,
    geoMode: 'off',
    blockWebRTC: true
  }
};

export const CLIENT_HINT_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-wow64',
  'sec-ch-ua-popup-redirection',
  'sec-ch-ua-frozen-ua-full-version',
  'sec-ch-ua-getters',
  'dpr',
  'viewport-width',
  'rtt',
  'downlink',
  'ect',
  'x-client-data',
  'x-client-persisted-data'
];

function isPlain(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  if (Array.isArray(v)) return v.slice();
  if (isPlain(v)) return Object.assign({}, v);
  return v;
}

export function mergeSettings(raw) {
  raw = raw || {};
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const def = DEFAULTS[key];
    const val = raw[key];
    if (val === undefined || val === null) out[key] = clone(def);
    else if (isPlain(def) && isPlain(val)) out[key] = Object.assign({}, def, val);
    else if (Array.isArray(def) && Array.isArray(val)) out[key] = val.slice();
    else out[key] = val;
  }
  return out;
}

export function fmtBytes(b) {
  if (typeof b !== 'number' || !isFinite(b) || b <= 0) return '—';
  const mb = b / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' ГБ';
  if (mb >= 10) return mb.toFixed(0) + ' МБ';
  return mb.toFixed(1) + ' МБ';
}

export function cleanExtensions(exts) {
  return (exts || [])
    .map((e) => String(e).trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

export function matchesExt(pathname, exts) {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch (e) { /* keep raw */ }
  p = p.toLowerCase();
  return exts.some((e) => p.endsWith('.' + e));
}

export function originPattern(host) {
  return '*://' + host + '/*';
}

export function hostFromUrl(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}
