// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────
async function init() {
  cleanup();

  // Завантажуємо збережені налаштування
  await loadSettings();

  if (CONFIG.autoOpenPanel === false) {
    isPanelClosedByUser = true;
  }

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

// ── Слухач для повідомлень з popup.js / background.js ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'mra_toggle_panel' || request.action === 'mra_force_open') {
    const panel = document.getElementById('mra-panel');
    isPanelClosedByUser = false; // У будь-якому випадку скасовуємо "закриття"

    // Якщо нас попросили примусово відкрити
    if (request.action === 'mra_force_open') {
      const btn = document.getElementById('mra-reopen-btn');
      if (btn) btn.remove();
      if (!panel) init(); // ініт сам створить панель оскільки isPanelClosedByUser = false
      return;
    }

    // Стара логіка тогла (про всяк випадок, якщо потрібна)
    if (panel) {
      if (panel.style.display === 'none') {
        panel.style.display = '';
      } else {
        panel.style.display = 'none';
        isPanelClosedByUser = true;
      }
    } else {
      init();
    }
  }
});

init();
