(function () {
  'use strict';

  const HOST = window.location.hostname;
  const IS_TWITCH = HOST.includes('twitch.tv');
  const IS_VK = HOST.includes('vkvideo.ru') || HOST.includes('vkplay');

  const SETTINGS_KEY = 'vkpoints_settings';
  const DEFAULT_SETTINGS = {
    enabled: true,
    pollIntervalMs: 15000,
    heartbeatIntervalMs: 60000
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS);

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (data) => {
        if (data && data[SETTINGS_KEY]) {
          settings = Object.assign({}, DEFAULT_SETTINGS, data[SETTINGS_KEY]);
        }
        resolve(settings);
      });
    });
  }

  // Настройки меняются из popup через background — content-скрипт узнаёт
  // об этом через storage.onChanged (без рассылки сообщений на вкладки).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes && changes[SETTINGS_KEY]) {
      settings = Object.assign({}, DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
      if (IS_TWITCH) restartTwitchScanner();
    }
  });

  // ---------- VK ----------
  // Извлекает blogUrl канала из URL. Формат стримов: /dimon4game88,
  // /channel30010245, /@nickname. Первый сегмент пути и есть blogUrl.
  // НЕ копаемся в содержимом страницы — там легко подцепить чужой канал
  // из рекомендаций/чата и ошибочно собирать баллы не того стримера.
  function extractBlogUrl() {
    // embed-URL вида /app/embed/<канал> — достаём канал из него.
    const embed = window.location.pathname.split('/').filter(Boolean);
    for (let i = 0; i < embed.length; i++) {
      if (/^embed$/i.test(embed[i]) && embed[i + 1]) {
        const seg = embed[i + 1];
        try { return decodeURIComponent(seg); } catch (_e) { return seg; }
      }
    }
    const m = window.location.pathname.match(/^\/([^/]+)\/?$/);
    if (!m) return null;
    let seg = m[1];
    try { seg = decodeURIComponent(seg); } catch (_e) {}
    if (/^channel\d+$/i.test(seg)) return seg;
    if (/^@/.test(seg)) return seg.replace(/^@/, '');
    return seg;
  }

  // Пытается вытащить токен авторизации из localStorage/sessionStorage страницы.
  // Токены обычно лежат в ключах с "token"/"auth" и выглядят как JWT или длинная строка.
  function extractTokenFromPage() {
    const stores = [window.localStorage, window.sessionStorage];
    // 1) сначала ищем по «говорящим» ключам
    for (const store of stores) {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (!key || !/token|auth|access|session|cred|jwt/i.test(key)) continue;
          const found = tokenInValue(store.getItem(key));
          if (found) return found;
        }
      } catch (_e) {}
    }
    // 2) подстраховка: любой JWT среди всех значений
    for (const store of stores) {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (!key) continue;
          const value = store.getItem(key);
          if (!value) continue;
          if (/token|auth|access|session|cred|jwt/i.test(key)) continue; // уже проверили
          const found = tokenInValue(value);
          if (found) return found;
        }
      } catch (_e) {}
    }
    return null;
  }

  function tokenInValue(val) {
    if (!val || typeof val !== 'string') return null;
    const pieces = [val];
    const embedded = val.match(/Bearer\s+([A-Za-z0-9_.\-~+/=]{20,})/);
    if (embedded) pieces.push(embedded[1]);
    for (const piece of pieces) {
      const t = piece.trim();
      if (isLikelyToken(t)) return t;
    }
    return null;
  }

  function isLikelyToken(t) {
    if (!t || t.length < 20) return false;
    // JWT: xxx.yyy.zzz
    if (/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]+$/.test(t)) {
      // Отсекаем служебные ws-токены страницы (sub начинается с "UNREG:").
      try {
        const body = JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1]))));
        const sub = String(body.sub || '');
        if (/^UNREG/i.test(sub)) return false;
      } catch (_e) {}
      return true;
    }
    // длинная строка base64 самостоятельно
    if (t.length > 60 && !/[\s]/.test(t)) return true;
    return false;
  }

  let lastSentToken = null;
  function notifyToken() {
    const token = extractTokenFromPage();
    if (!token || token === lastSentToken) return;
    lastSentToken = token;
    try {
      chrome.runtime.sendMessage({ type: 'vkpoints:setToken', token }, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
  }

  // Проверяем, идёт ли стрим: есть ли видео на странице.
  // true  — видео есть,
  // false — на странице явные признаки завершённого стрима,
  // null  — неясно (плеер в iframe/реклама/превью) — канал всё равно опрашивается.
  function detectLive() {
    const video = document.querySelector('video');
    if (video) {
      const src = video.currentSrc || video.src || '';
      if (src) return true;
    }
    const bodyText = document.body ? document.body.innerText : '';
    if (bodyText && /стрим окончен|завершён|оффлайн|не в сети|stream (has )?ended|offline/i.test(bodyText)) {
      return false;
    }
    return null;
  }

  let lastReportedLive = null;
  let lastReportedUrl = null;
  function notifyBlogUrl() {
    const blogUrl = extractBlogUrl();
    const live = detectLive();
    if (live === lastReportedLive && blogUrl === lastReportedUrl) return;
    lastReportedLive = live;
    lastReportedUrl = blogUrl;
    try {
      chrome.runtime.sendMessage({ type: 'vkpoints:setBlogUrl', blogUrl, live }, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
  }

  function startVkTracking() {
    // Пробуем сразу вытащить токен из storage страницы.
    notifyToken();
    notifyBlogUrl();
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        lastReportedUrl = null;
        lastReportedLive = null;
        notifyToken();
        notifyBlogUrl();
      } else {
        // периодически обновляем live-статус (стрим мог закончиться)
        notifyBlogUrl();
        // токен мог появиться в storage после гидрации SPA
        notifyToken();
      }
    }, 15000);
  }

  // ---------- Twitch ----------
  // Механика скопирована из открытых проектов автоколлекторов Twitch:
  // superchimpy1-ctrl/Automatic-Twitch-Channel-Point-collector и
  // Xitrus-Sol/twitch-auto-collector.

  // Кнопка бонуса Twitch не имеет стабильного класса, но у неё есть
  // aria-label со словом "bonus". Плюс старый fallback — класс иконки.
  function findTwitchBonusButton() {
    const byAria = document.querySelectorAll('button[aria-label]');
    for (const b of byAria) {
      if (/bonus/i.test(b.getAttribute('aria-label'))) return b;
    }
    const legacy = document.querySelector('.claimable-bonus__icon');
    if (legacy) return legacy.closest('button') || legacy;
    return null;
  }

  let lastTwitchClaimAt = 0;
  const TWITCH_CLAIM_COOLDOWN_MS = 5000; // защита от двойного клика по той же кнопке
  let twitchObserver = null;
  let twitchPollTimer = null;

  function clickTwitchBonus() {
    if (!settings.enabled) return;
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastTwitchClaimAt < TWITCH_CLAIM_COOLDOWN_MS) return;
    const btn = findTwitchBonusButton();
    if (!btn) return;
    lastTwitchClaimAt = now;
    btn.click();
    const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
    notifyTwitchClick(label, getTwitchChannel(), parseBonusAmount(label));
  }

  function getTwitchChannel() {
    const p = window.location.pathname.split('/').filter(Boolean);
    return p.length ? p[0] : '?';
  }

  // В aria-label кнопки бонуса обычно указано число ("Claim 50 Bonus"). Парсим его,
  // а если нет — по умолчанию стандартный бонус 50.
  function parseBonusAmount(label) {
    const m = /\d+/.exec(label || '');
    if (m) { const v = parseInt(m[0], 10); if (v > 0) return v; }
    return null;
  }

  function notifyTwitchClick(text, channel, amount) {
    try {
      chrome.runtime.sendMessage({ type: 'vkpoints:twitchClicked', text, channel, amount }, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
  }

  function stopTwitchScanner() {
    if (twitchObserver) {
      twitchObserver.disconnect();
      twitchObserver = null;
    }
    if (twitchPollTimer) {
      clearInterval(twitchPollTimer);
      twitchPollTimer = null;
    }
  }

  function restartTwitchScanner() {
    stopTwitchScanner();
    if (!settings.enabled) return;

    // Кнопка появляется/исчезает динамически — MutationObserver надёжнее,
    // чем фиксированный интервал.
    twitchObserver = new MutationObserver(() => {
      clickTwitchBonus();
    });
    twitchObserver.observe(document.body, { childList: true, subtree: true });

    // Fallback poll на случай, если кнопка меняет видимость без мутации DOM.
    twitchPollTimer = setInterval(clickTwitchBonus, 5000);

    // Первичный клик сразу после загрузки страницы.
    clickTwitchBonus();
  }

  function startTwitchTracking() {
    restartTwitchScanner();
  }

  // Пинг от background — используется, чтобы понять, внедрён ли content-скрипт
  // в уже открытую вкладку (после перезагрузки расширения Chrome не ставит его сам).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'vkpoints:ping') {
      sendResponse({ ok: true });
    }
  });

  // ---------- init ----------
  loadSettings().then(() => {
    if (IS_TWITCH) {
      startTwitchTracking();
    } else if (IS_VK) {
      startVkTracking();
    }
  });
})();
