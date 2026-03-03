// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────
async function init() {
  cleanup();

  // Завантажуємо збережені налаштування
  await loadSettings();

  var observerTimer = null;
  const observer = new MutationObserver(() => {
    // Debounce: не реагуємо на кожну мікрозміну DOM
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      const isAdBreaksPage =
        document.querySelector('ytve-ad-breaks-editor') ||
        document.querySelector('ytve-audio-waveform') ||
        window.location.href.includes('ad_breaks');

      if (isAdBreaksPage && !document.getElementById('mra-panel') && !isPanelClosedByUser) {
        createPanel();
        const reopenBtn = document.getElementById('mra-reopen-btn');
        if (reopenBtn) reopenBtn.remove();

        updateStatus(
          state.waveformUrl ? '✅ Натисніть "Аналізувати"' : '⏳ Очікуємо завантаження відео...',
          state.waveformUrl ? 'success' : 'info'
        );
      } else if (isAdBreaksPage && isPanelClosedByUser) {
        if (!document.getElementById('mra-reopen-btn')) {
          createReopenButton();
        }
      } else if (!isAdBreaksPage) {
        const panel = document.getElementById('mra-panel');
        if (panel) panel.remove();
        const btn = document.getElementById('mra-reopen-btn');
        if (btn) btn.remove();
      }
    }, 200);
  });

  activeObservers.push(observer);

  const startObserving = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      setTimeout(startObserving, 100);
    }
  };
  startObserving();
}

// ── Слухач для кнопки розширення ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'mra_toggle_panel') {
    const panel = document.getElementById('mra-panel');
    if (panel) {
      if (panel.style.display === 'none') {
        panel.style.display = '';
        isPanelClosedByUser = false;
      } else {
        panel.style.display = 'none';
        isPanelClosedByUser = true;
      }
    } else {
      isPanelClosedByUser = false;
      init();
    }
  }
});

init();
