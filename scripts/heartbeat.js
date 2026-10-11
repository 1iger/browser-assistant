(() => {
  let last = 0;
  const beat = () => {
    const now = Date.now();
    if (now - last < 6000) return;
    last = now;
    try {
      chrome.runtime.sendMessage({ type: 'ba-heartbeat' }, () => void chrome.runtime.lastError);
    } catch (e) { /* расширение перезагружается */ }
  };

  if (document.visibilityState === 'visible') beat();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') beat();
  }, 7000);
})();
