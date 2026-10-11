(function () {
  'use strict';

  const SETTINGS_KEY = 'vkpoints_settings';
  const DEFAULT_SETTINGS = {
    enabled: true,
    pollIntervalMs: 15000,
    heartbeatIntervalMs: 60000,
    notifyEnabled: true,
    autoBackup: false
  };

  const DEFAULT_STATE = {
    clicks: 0,
    lastClickAt: null,
    lastText: '',
    balance: null,
    log: [],
    authStatus: null // null | 'expired'
  };

  let state = Object.assign({}, DEFAULT_STATE);

  // Токен хранится ТОЛЬКО в памяти (не персистится в storage) —
  // перехватывается заново из запросов страницы или localStorage.
  let authToken = null;
  let tokenKnown = false;
  let lastTokenLogAt = 0;
  let lastChannelNamesAt = 0;

  // Карта отслеживаемых каналов: blogUrl -> { tabs: Set, live: null|boolean }.
  // live === false означает, что стрим оффлайн — канал пропускается.
  const channels = new Map();

  let consecutiveFails = 0;
  const BACKOFF_MAX_MS = 5 * 60 * 1000; // максимум задержки при ошибках

  const MAX_LOG = 14;

  const log = [];
  function pushLog(msg) {
    log.unshift({ t: Date.now(), msg });
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    chrome.storage.local.set({ vkpoints_log: log });
    console.log('[vkpoints]', msg);
  }

  function saveState() {
    chrome.storage.local.set({ vkpoints_state: state });
  }

  // История сборов: массив записей {t, platform, channel, amount, label}.
  // Хранится отдельно от state, чтобы не раздувать его.
  let history = [];
  const HISTORY_KEY = 'vkpoints_history';
  const MAX_HISTORY = 10000;

  function saveHistory() {
    chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY) });
  }

  function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(HISTORY_KEY, (data) => {
        if (data && Array.isArray(data[HISTORY_KEY])) {
          history = data[HISTORY_KEY].slice(0, MAX_HISTORY);
        } else {
          history = [];
        }
        resolve();
      });
    });
  }

  // Имена (никнеймы) каналов: blogUrl -> { nick, title }. Кеш для отображения.
  let channelNames = {};
  const CHANNEL_NAMES_KEY = 'vkpoints_channel_names';

  function saveChannelNames() {
    chrome.storage.local.set({ [CHANNEL_NAMES_KEY]: channelNames });
  }

  function loadChannelNames() {
    return new Promise((resolve) => {
      chrome.storage.local.get(CHANNEL_NAMES_KEY, (data) => {
        channelNames = (data && data[CHANNEL_NAMES_KEY]) || {};
        resolve();
      });
    });
  }

  // ---------- Локальные резервные копии ----------
  // Статистика хранится в chrome.storage.local и теряется при удалении
  // расширения. Чтобы этого не происходило — периодически выгружаем её в файл
  // (папка «Загрузки»): раз в AUTO_BACKUP_HOURS часов или каждые
  // AUTO_BACKUP_DELTA новых сборов. После переустановки восстановление
  // делается из этого файла (страница статистики → «Восстановить из файла»).
  const BACKUP_KEY = 'vkpoints_last_backup';
  const AUTO_BACKUP_HOURS = 6;
  const AUTO_BACKUP_DELTA = 250;
  let lastBackupAt = 0;
  let lastBackupCount = 0;

  function loadBackupState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(BACKUP_KEY, (data) => {
        if (data && data[BACKUP_KEY]) {
          lastBackupAt = data[BACKUP_KEY].at || 0;
          lastBackupCount = data[BACKUP_KEY].count || 0;
        }
        resolve();
      });
    });
  }

  function buildBackupJson(maxEntries) {
    // history хранится от новых к старым — при ограничении берём первые записи.
    const entries = maxEntries && history.length > maxEntries ? history.slice(0, maxEntries) : history;
    return JSON.stringify({
      app: 'vkpoints-backup',
      exportedAt: Date.now(),
      channelNames: channelNames,
      history: entries
    }, null, 2);
  }

  // В MV3 service worker Chrome нет URL.createObjectURL, поэтому для background.js
  // скачиваем через data:-адрес (base64). В Firefox (event page) и в страницах
  // расширения createObjectURL доступен — там используем blob-адрес.
  function buildDownloadUrl(json) {
    if (
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const blob = new Blob([json], { type: 'application/json' });
      return { url: URL.createObjectURL(blob), revokeAfter: true };
    }
    const bytes = new Uint8Array(new TextEncoder().encode(json));
    let bin = '';
    const CHUNK = 32768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return { url: 'data:application/json;base64,' + btoa(bin), revokeAfter: false };
  }

  function backupHistoryToFile(maxEntries) {
    try {
      const json = buildBackupJson(maxEntries);
      const { url, revokeAfter } = buildDownloadUrl(json);
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      chrome.downloads.download(
        {
          url: url,
          filename: 'vkpoints-backup-' + stamp + '.json',
          saveAs: false,
          conflictAction: 'uniquify'
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error('[vkpoints] backup download failed', chrome.runtime.lastError.message || chrome.runtime.lastError);
          }
          // Blob-адрес отдаём после того, как Chrome успел его забрать.
          if (revokeAfter) {
            setTimeout(() => {
              try { URL.revokeObjectURL(url); } catch (_e) {}
            }, 60000);
          }
        }
      );
    } catch (e) {
      console.error('[vkpoints] backup error', e);
    }
  }

  function maybeAutoBackup() {
    try {
      if (typeof chrome.downloads === 'undefined') return;
      if (!DEFAULT_SETTINGS.autoBackup) return;
      const now = Date.now();
      const dueByTime = AUTO_BACKUP_HOURS > 0 && now - lastBackupAt >= AUTO_BACKUP_HOURS * 3600000;
      const dueByCount = history.length - lastBackupCount >= AUTO_BACKUP_DELTA;
      if (!dueByTime && !dueByCount) return;
      lastBackupAt = now;
      lastBackupCount = history.length;
      chrome.storage.local.set({ [BACKUP_KEY]: { at: lastBackupAt, count: lastBackupCount } });
      backupHistoryToFile(3000);
      pushLog('Авто-бэкап сохранён (Загрузки)');
    } catch (_e) {}
  }

  function restoreFromJson(text) {
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.history)) {
        return { ok: false, error: 'Некорректный файл бэкапа: не найдена история' };
      }
      history = data.history.slice(0, MAX_HISTORY);
      if (data.channelNames && typeof data.channelNames === 'object') {
        channelNames = data.channelNames;
      }
      saveHistory();
      saveChannelNames();
      updateBadge();
      pushLog(`Восстановлено записей: ${history.length}`);
      return { ok: true, count: history.length };
    } catch (_e) {
      return { ok: false, error: 'Не удалось прочитать файл' };
    }
  }

  function displayName(channel) {
    const c = channelNames[channel];
    if (c && (c.nick || c.title)) return c.nick || c.title;
    return channel;
  }

  // Суммы баллов за последние 7 дней (для мини-графика в popup).
  function buildMiniSummary() {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({ start: d.getTime(), key: d.toISOString().slice(0, 10), sum: 0 });
    }
    const map = new Map(days.map((d) => [d.key, d]));
    history.forEach((e) => {
      const key = new Date(e.t).toISOString().slice(0, 10);
      if (map.has(key)) map.get(key).sum += (e.amount || 0);
    });
    return days.map((d) => d.sum);
  }

  // Подтягивает ники каналов из списка подписок (по аналогии с проектом klishin16).
  // Вспомогательный запрос: не должен помечать сессию «истёкшей», даже если
  // эндпоинт subscriptions недоступен или требует других прав.
  async function fetchChannelNames() {
    if (!authToken) return;
    try {
      const url = `${API_BASE}/v1/user/public_video_stream/subscriptions`;
      const data = await apiFetch(url, { method: 'GET', headers: apiHeaders() }, true);
      const blogs = data && data.data && data.data.streamBlogs;
      if (!Array.isArray(blogs)) return;
      let changed = false;
      for (const b of blogs) {
        const key = b.blogUrl;
        if (!key) continue;
        const nick = (b.owner && b.owner.nick) || null;
        const title = (b.blog && b.blog.title) || (b.stream && b.stream.title) || null;
        if (!nick && !title) continue;
        if (channelNames[key] && channelNames[key].nick === nick && channelNames[key].title === title) continue;
        channelNames[key] = { nick, title };
        changed = true;
      }
      if (changed) {
        saveChannelNames();
        pushLog('Имена каналов обновлены');
      }
    } catch (e) {
      console.error('[vkpoints] fetchChannelNames error', e);
    }
  }

  // Записывает факт сбора баллов и обновляет счётчики.
  function recordCollect(platform, channel, amount, label) {
    const entry = {
      t: Date.now(),
      platform: platform || 'vk',
      channel: channel || '?',
      amount: amount,
      label: label || ''
    };
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory();
    saveState();
    updateBadge();
    const show = displayName(channel);
    pushLog(`[${entry.platform}/${show}] +${entry.amount}`);
    notifyCollect(`${platform === 'vk' ? 'VK' : 'Twitch'} · ${show} · +${amount}`);
    maybeAutoBackup();
  }

  let lastNotifyAt = 0;
  // Уведомление Chrome при сборе (не чаще раза в минуту, тумблер в настройках).
  function notifyCollect(message) {
    if (!DEFAULT_SETTINGS.notifyEnabled) return;
    const now = Date.now();
    if (now - lastNotifyAt < 60000) return;
    lastNotifyAt = now;
    try {
      chrome.notifications.create('vkpoints-collect', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Баллы собраны',
        message: message
      }, function () {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
  }

  // Показывает общее число собранных бонусов на иконке расширения.
  // Зависит от общей настройки расширения «что показывать на иконке»:
  // бейдж пишется только в режиме 'points', иначе иконку занимает память вкладок.
  function updateBadge() {
    try {
      chrome.storage.local.get('settings', (d) => {
        try {
          const s = (d && d.settings) || {};
          if (s.badgeMode !== 'points') return;
          const count = state.clicks || 0;
          chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
          chrome.action.setBadgeBackgroundColor({ color: '#4f8cff' });
          chrome.action.setTitle({ title: count > 0 ? 'Баллы: ' + count : 'Browser Assistant' });
        } catch (_e) {}
      });
    } catch (_e) {}
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY, 'vkpoints_state', 'vkpoints_log'], (data) => {
        if (data[SETTINGS_KEY]) {
          Object.assign(DEFAULT_SETTINGS, data[SETTINGS_KEY]);
        }
        if (data.vkpoints_state) {
          // Не восстанавливаем токен из storage (если вдруг сохранился ранее).
          const saved = Object.assign({}, data.vkpoints_state);
          delete saved.token;
          state = Object.assign({}, DEFAULT_STATE, saved);
        }
        if (data.vkpoints_log) {
          log.length = 0;
          log.push.apply(log, data.vkpoints_log.slice(0, MAX_LOG));
        }
        resolve();
      });
    });
  }

  const API_BASE = 'https://api.live.vkvideo.ru';
  const X_FROM_ID = '57a5e225-bca7-4794-a30c-70315b006c43';

  function apiHeaders(extra = {}) {
    return Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://live.vkvideo.ru',
        Referer: 'https://live.vkvideo.ru/',
        'X-From-Id': X_FROM_ID
      },
      authToken ? { Authorization: 'Bearer ' + authToken } : {},
      extra
    );
  }

  // Пометка: токен протух. НЕ останавливаем таймеры навсегда — продолжаем
  // тикать, чтобы при разовом 401/403 (транзитный бан/гео/лимит) сбор сам
  // восстановился на следующем цикле или при приходе свежего токена.
  function markAuthExpired() {
    state.authStatus = 'expired';
    saveState();
    updateBadge();
    pushLog('Сессия VK не ответила — попробую снова позже');
  }

  // Сброс статуса при получении свежего токена или успешном цикле.
  function clearAuthExpired() {
    if (state.authStatus !== 'expired') return;
    state.authStatus = null;
    saveState();
    pushLog('Сбор VK возобновлён');
  }

  // apiFetch: возвращает { status, data } или null при сетевой ошибке.
  // suppressAuthMark — для запросов, которые НЕ должны влиять на статус
  // сессии (подтяжка имён каналов и т.п.).
  async function apiFetch(url, options = {}, suppressAuthMark = false) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      console.error('[vkpoints] api error', url, e);
      return null;
    }
    let data = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch (_e) {}
    if (!res.ok) {
      if (!suppressAuthMark && (res.status === 401 || res.status === 403)) {
        markAuthExpired();
      }
      return { status: res.status, data };
    }
    return { status: res.status, data };
  }

  async function fetchPendingBonuses(blogUrl) {
    if (!authToken || !blogUrl) return null;
    const url = `${API_BASE}/v1/channel/${blogUrl}/point/pending_bonus/`;
    const res = await apiFetch(url, { method: 'GET', headers: apiHeaders() });
    if (!res || res.status !== 200) return null;
    return res.data && res.data.data && res.data.data.bonuses ? res.data.data.bonuses : [];
  }

  async function gatherBonus(blogUrl, bonus) {
    if (!authToken || !blogUrl || !bonus || !bonus.id) return false;
    const url = `${API_BASE}/v1/channel/${blogUrl}/point/pending_bonus/${bonus.id}/gather`;
    const body = JSON.stringify({ nextRequestInterval: 60 });
    const res = await apiFetch(url, {
      method: 'PUT',
      headers: apiHeaders(),
      body
    });
    // Успех только при HTTP 200/201; иначе это ошибка, а не «собрано».
    if (!res || (res.status !== 200 && res.status !== 201)) return false;
    if (!res.data) return false;
    state.clicks += 1;
    state.lastClickAt = Date.now();
    const amount = (bonus.bonus && bonus.bonus.channelPointAmount) || 0;
    state.lastText = `[${displayName(blogUrl)}] ${bonus.bonus ? bonus.bonus.name : 'бонус'} (+${amount})`;
    if (res.data.data && res.data.data.balance !== undefined) state.balance = res.data.data.balance;
    pushLog(`Собрано: ${state.lastText}${state.balance !== null ? ' | баланс: ' + state.balance : ''}`);
    recordCollect('vk', blogUrl, amount, state.lastText);
    return true;
  }

  async function sendViewerAlive(blogUrl) {
    if (!authToken || !blogUrl) return;
    const url = `${API_BASE}/v1/blog/${blogUrl}/public_video_stream/heartbeat/viewer`;
    await apiFetch(url, { method: 'PUT', headers: apiHeaders() });
  }

  function currentBlogUrls() {
    // Сбор идёт через API и не зависит от того, найдено ли видео на странице.
    // Пропускать каналы «по оффлайну» нельзя — признак ненадёжный (плеер
    // в iframe, реклама, превью), а баллы копятся и без отображения.
    const out = [];
    for (const [url, info] of channels) {
      if (url) out.push(url);
    }
    return out;
  }

  async function runCollectCycle() {
    if (!DEFAULT_SETTINGS.enabled || !authToken) return;
    const urls = currentBlogUrls();
    if (urls.length === 0) return;

    let cycleErrors = 0;
    for (const blogUrl of urls) {
      try {
        const bonuses = await fetchPendingBonuses(blogUrl);
        if (!bonuses) {
          cycleErrors++;
          continue;
        }
        if (bonuses.length === 0) continue;
        for (const b of bonuses) {
          await gatherBonus(blogUrl, b);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (e) {
        console.error('[vkpoints] collect error', blogUrl, e);
        cycleErrors++;
      }
    }

    if (cycleErrors === 0) {
      // Цикл прошёл успешно — если сессия была помечена истёкшей (ложное
      // срабатывание), снимаем метку и возобновляем таймеры.
      if (state.authStatus === 'expired') {
        clearAuthExpired();
        startTimers();
      }
      if (consecutiveFails > 0) {
        consecutiveFails = 0;
        pushLog('Ошибки прекратились — интервал сброшен');
      }
    } else {
      consecutiveFails++;
      if (consecutiveFails === 3) pushLog('Повторные ошибки API — увеличиваю интервал');
    }
  }

  // Вычисляет задержку с учётом backoff при ошибках.
  function effectivePollDelay() {
    if (consecutiveFails === 0) return jitter(DEFAULT_SETTINGS.pollIntervalMs);
    const factor = Math.min(Math.pow(2, consecutiveFails), 16);
    const delay = DEFAULT_SETTINGS.pollIntervalMs * factor;
    return jitter(Math.min(delay, BACKOFF_MAX_MS));
  }

  // Случайное отклонение в процентах от базового интервала (0..1).
  // Делает время запросов нерегулярным, чтобы активность не выглядела как бот.
  const JITTER_RATIO = 0.4; // ±40%

  function jitter(ms) {
    const spread = ms * JITTER_RATIO;
    return ms + (Math.random() * spread * 2 - spread);
  }

  let pollTimer = null;
  let heartbeatTimer = null;

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!DEFAULT_SETTINGS.enabled) return;
    pollTimer = setTimeout(() => {
      runCollectCycle();
      schedulePoll();
    }, effectivePollDelay());
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (!DEFAULT_SETTINGS.enabled) return;
    heartbeatTimer = setTimeout(() => {
      for (const blogUrl of currentBlogUrls()) {
        sendViewerAlive(blogUrl);
      }
      scheduleHeartbeat();
    }, jitter(DEFAULT_SETTINGS.heartbeatIntervalMs));
  }

  function startTimers() {
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    pollTimer = heartbeatTimer = null;
    if (!DEFAULT_SETTINGS.enabled) return;
    schedulePoll();
    scheduleHeartbeat();
  }

  function stopTimers() {
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    pollTimer = heartbeatTimer = null;
  }

  // --- Защита от «засыпания» сервис-воркера (MV3) ---
  // Если воркер уснул, таймеры могут сброситься. Chrome.alarms будит воркер
  // раз в минуту; при пробуждении перезапускаем таймеры и не пропускаем сбор.
  const WATCHDOG_ALARM = 'vkpoints-watchdog';

  function ensureWatchdog() {
    try {
      chrome.alarms.get(WATCHDOG_ALARM, (alarm) => {
        if (!alarm) chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
      });
    } catch (_e) {}
  }

  function removeWatchdog() {
    try {
      chrome.alarms.clear(WATCHDOG_ALARM);
    } catch (_e) {}
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === WATCHDOG_ALARM) {
      loadSettings().then(() => {
        updateBadge();
        // Воркер мог проспать сбор — догоняем сразу.
        if (DEFAULT_SETTINGS.enabled) {
          runCollectCycle();
          startTimers();
        }
        // Периодически обновляем ники каналов (~раз в 10 минут).
        if (authToken && Math.floor(Date.now() / 600000) % 10 === 0) {
          fetchChannelNames();
        }
        // После перезагрузки расширения Chrome не внедряет content-скрипт в
        // уже открытые вкладки — досыпаем его вручную, чтобы каждая вкладка
        // со стримом зарегистрировала свой канал.
        ensureContentScripts();
        maybeAutoBackup();
      });
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    loadSettings().then(() => {
      if (DEFAULT_SETTINGS.enabled) startTimers();
      ensureContentScripts();
      maybeAutoBackup();
    });
  });

  // ---------- Гарантированное внедрение content-скрипта ----------
  const MATCHING_URLS = [
    'https://live.vkvideo.ru/*',
    'https://*.vkvideo.ru/*',
    'https://www.twitch.tv/*',
    'https://*.twitch.tv/*'
  ];
  const injectingTabs = new Set();

  // Пинговать вкладки наших сайтов; если content-скрипт в них не отвечает —
  // внедрить его самим (executeScript). Вызывается при старте и раз в минуту
  // по watchdog'у, поэтому уже открытые вкладки ловятся в течение минуты.
  function ensureContentScripts() {
    try {
      chrome.tabs.query({ url: MATCHING_URLS }, (tabs) => {
        for (const tab of tabs) {
          const tabId = tab.id;
          if (tabId === undefined || injectingTabs.has(tabId)) continue;
          chrome.tabs.sendMessage(tabId, { type: 'vkpoints:ping' }, (resp) => {
            // Читаем lastError — иначе Chrome пишет «Unchecked runtime.lastError:
            // Receiving end does not exist» для вкладок без content-скрипта.
            if (chrome.runtime.lastError) {
              injectContentScript(tabId);
              return;
            }
            if (resp && resp.ok) return;
            // Receiver не найден — content-скрипт в вкладке отсутствует.
            injectContentScript(tabId);
          });
        }
      });
    } catch (_e) {}
  }

  function injectContentScript(tabId) {
    if (injectingTabs.has(tabId)) return;
    injectingTabs.add(tabId);
    try {
      chrome.scripting.executeScript({ target: { tabId }, files: ['vkpoints/content.js'] })
        .catch(() => { /* вкладка закрылась или не дала доступ */ })
        .finally(() => {
          injectingTabs.delete(tabId);
        });
    } catch (_e) {
      injectingTabs.delete(tabId);
    }
  }

  // Единая обработка получаемого токена. VK раздаёт короткоживущие токены и
  // ротирует их примерно раз в минуту — на каждую ротацию не нужно рестартить
  // таймеры, дёргать API и засорять лог (в нём всего MAX_LOG строк).
  function onTokenCaptured(token, source) {
    if (!token) return;
    // Токен из localStorage страницы (content script) может быть просроченным;
    // перезаписываем им свежий токен из запросов только если токена ещё нет.
    if (source === 'page' && tokenKnown && token !== authToken) return;
    if (token === authToken) {
      // Даже без смены токена изредка обновляем ники каналов.
      const now = Date.now();
      if (now - lastChannelNamesAt >= 10 * 60 * 1000) {
        lastChannelNamesAt = now;
        fetchChannelNames();
      }
      return;
    }
    authToken = token;
    const now = Date.now();
    if (!tokenKnown) {
      tokenKnown = true;
      pushLog('Токен найден (VK)');
    } else if (now - lastTokenLogAt >= 5 * 60 * 1000) {
      lastTokenLogAt = now;
      pushLog('Токен обновлён (ротация)');
    }
    clearAuthExpired();
    // Таймеры рестартуем только если их ещё нет — текущий цикл и так подхватит
    // новый токен на следующем тике.
    if (!pollTimer && !heartbeatTimer) startTimers();
    if (now - lastChannelNamesAt >= 10 * 60 * 1000) {
      lastChannelNamesAt = now;
      fetchChannelNames();
    }
  }

  // Перехват Authorization-токена из исходящих запросов страницы.
  // Токен хранится только в памяти (authToken) и НЕ персистится на диск.
  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      if (!details.requestHeaders) return;
      const auth = details.requestHeaders.find(
        (h) => h.name.toLowerCase() === 'authorization' && h.value && h.value.startsWith('Bearer ')
      );
      if (auth) {
        onTokenCaptured(auth.value.replace(/^Bearer\s+/i, ''), 'request');
      }
    },
    { urls: ['https://api.live.vkvideo.ru/*', 'https://api.live.vkplay.ru/*'] },
    // 'extraHeaders' обязателен в MV3, чтобы видеть чувствительные заголовки
    // вроде Authorization — без него onSendHeaders их просто не отдаёт.
    ['requestHeaders', 'extraHeaders']
  );

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'vkpoints:setToken') {
      // Токен из localStorage страницы (content script) — только в память.
      onTokenCaptured(msg.token, 'page');
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'vkpoints:setBlogUrl') {
      const tabId = sender && sender.tab ? sender.tab.id : null;
      const blogUrl = msg.blogUrl || null;
      // live: true | false | null (null = пока неизвестно, канал всё равно опрашивается)
      const live = msg.live === undefined ? null : msg.live;

      // Убираем вкладку из всех каналов, затем добавляем в новый канал.
      for (const [url, info] of channels) {
        if (tabId !== null) info.tabs.delete(tabId);
        if (info.tabs.size === 0) channels.delete(url);
      }
      if (blogUrl && tabId !== null) {
        if (!channels.has(blogUrl)) channels.set(blogUrl, { tabs: new Set(), live: null });
        const info = channels.get(blogUrl);
        info.tabs.add(tabId);
        if (live !== null && live !== undefined) info.live = !!live;
      }

      const list = currentBlogUrls();
      pushLog('Каналы: ' + (list.length ? list.join(', ') : 'нет'));
      runCollectCycle();
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'vkpoints:getState') {
      sendResponse({
        state,
        settings: DEFAULT_SETTINGS,
        hasToken: !!authToken,
        channelNames,
        // 7-дневное резюме сумм для мини-графика в popup.
        mini: buildMiniSummary(),
        channels: Array.from(channels.entries()).map(([url, info]) => ({
          url,
          name: displayName(url),
          live: info.live
        }))
      });
      return true;
    }
    if (msg && msg.type === 'vkpoints:getHistory') {
      sendResponse({ history, channelNames });
      return true;
    }
    if (msg && msg.type === 'vkpoints:clearHistory') {
      history = [];
      state.clicks = 0;
      state.lastClickAt = null;
      state.lastText = '';
      saveHistory();
      saveState();
      updateBadge();
      pushLog('История очищена');
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'vkpoints:backupNow') {
      backupHistoryToFile();
      lastBackupAt = Date.now();
      lastBackupCount = history.length;
      chrome.storage.local.set({ [BACKUP_KEY]: { at: lastBackupAt, count: lastBackupCount } });
      pushLog('Копия статистики сохранена (Загрузки)');
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'vkpoints:restoreBackup') {
      sendResponse(restoreFromJson(msg.json || ''));
      return true;
    }
    if (msg && msg.type === 'vkpoints:twitchClicked') {
      state.clicks += 1;
      state.lastClickAt = Date.now();
      const amount = (msg.amount && msg.amount > 0) ? msg.amount : 50;
      state.lastText = `Twitch: ${msg.channel || '?'} (+${amount})`;
      pushLog('Собрано: ' + state.lastText);
      recordCollect('twitch', msg.channel || '?', amount, state.lastText);
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'vkpoints:setEnabled') {
      DEFAULT_SETTINGS.enabled = !!msg.enabled;
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
      if (DEFAULT_SETTINGS.enabled) {
        startTimers();
        ensureWatchdog();
      } else {
        stopTimers();
        removeWatchdog();
      }
      updateBadge();
      sendResponse({ ok: true, settings: DEFAULT_SETTINGS });
      return true;
    }
    if (msg && msg.type === 'vkpoints:setInterval') {
      const v = parseInt(msg.interval, 10);
      if (v && v >= 3000 && v <= 120000) {
        DEFAULT_SETTINGS.pollIntervalMs = v;
        chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
        if (DEFAULT_SETTINGS.enabled) startTimers();
        sendResponse({ ok: true, settings: DEFAULT_SETTINGS });
      } else {
        sendResponse({ ok: false, error: 'Интервал от 3000 до 120000 мс' });
      }
      return true;
    }
    if (msg && msg.type === 'vkpoints:setNotify') {
      DEFAULT_SETTINGS.notifyEnabled = !!msg.enabled;
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
      sendResponse({ ok: true, settings: DEFAULT_SETTINGS });
      return true;
    }
    if (msg && msg.type === 'vkpoints:setAutoBackup') {
      DEFAULT_SETTINGS.autoBackup = !!msg.enabled;
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
      if (DEFAULT_SETTINGS.autoBackup) maybeAutoBackup();
      sendResponse({ ok: true, settings: DEFAULT_SETTINGS });
      return true;
    }
  });

  // При закрытии вкладки убираем её из отслеживаемых каналов.
  function removeTab(tabId) {
    for (const [url, info] of channels) {
      info.tabs.delete(tabId);
      if (info.tabs.size === 0) channels.delete(url);
    }
    const list = currentBlogUrls();
    pushLog('Каналы: ' + (list.length ? list.join(', ') : 'нет'));
  }

  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      injectingTabs.delete(tabId);
      removeTab(tabId);
    });
  }

  loadSettings()
    .then(loadHistory)
    .then(loadChannelNames)
    .then(loadBackupState)
    .then(() => {
      // Статус «истёк» не переживает перезапуск воркера: токен и так
      // перехватывается заново, а если он реально протух — первый же
      // запрос снова выставит метку.
      state.authStatus = null;
      updateBadge();
      if (DEFAULT_SETTINGS.enabled) {
        startTimers();
        ensureWatchdog();
        fetchChannelNames();
      }
      // Чтобы вкладки, открытые до перезагрузки расширения, тоже начали
      // отслеживаться (Chrome не перевнедряет content-скрипт сам).
      ensureContentScripts();
    });
})();
