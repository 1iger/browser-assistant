chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'offscreen:copy' && typeof msg.text === 'string') {
    try {
      navigator.clipboard.writeText(msg.text).then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false })
      );
    } catch (e) {
      sendResponse({ ok: false });
    }
    return true;
  }
  return false;
});
