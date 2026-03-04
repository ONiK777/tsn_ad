// ─── ПЕРЕХОПЛЕННЯ API ЧЕРЕЗ INJECT.JS ────────────────────────────────────────
function injectScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);
}

if (document.head || document.documentElement) {
  injectScript();
} else {
  const earlyObs = new MutationObserver(() => {
    if (document.head || document.documentElement) { earlyObs.disconnect(); injectScript(); }
  });
  earlyObs.observe(document, { childList: true, subtree: true });
}

window.addEventListener('message', function (event) {
  try {
    if (event.source !== window || !event.data || event.data.type !== 'MRA_WAVEFORM_URL') return;

    const url = event.data.url;

    if (!url || typeof url !== 'string') {
      log('⚠️ Некоректний URL вейвформи', 'warn');
      return;
    }

    // SPA-навігація: якщо URL змінився — скидаємо кеш старого відео та оновлюємо UI
    if (state.waveformUrl && state.waveformUrl !== url) {
      state.cachedAudioBuffer = null;
      state.cachedAudioUrl = null;
      state.waveformData = null;
      state.silences = [];
      state.selected = [];
      log('🔄 Нове відео виявлено — кеш скинуто', 'info');
      renderSelectedList();
      renderWaveform();
    }

    state.waveformUrl = url;
    log('Перехоплено URL вейвформи: ' + url.substring(0, 100) + '...', 'success');
    updateStatus('✅ Натисніть "Аналізувати"', 'success');
  } catch (error) {
    log('Помилка обробки повідомлення: ' + error.message, 'error');
  }
});
