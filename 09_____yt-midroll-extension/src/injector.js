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

function _onInterceptMessage(event) {
  try {
    if (event.source !== window || !event.data) return;

    // Перехоплення тривалості відео з videoplayback URL
    if (event.data.type === 'MRA_VIDEO_DURATION') {
      const dur = event.data.duration;
      if (typeof dur === 'number' && isFinite(dur) && dur > 0) {
        state.interceptedDuration = dur;
        log(`Перехоплено тривалість відео з URL: ${dur.toFixed(1)}с`, 'info');
      }
      return;
    }

    if (event.data.type !== 'MRA_WAVEFORM_URL') return;

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
      state.interceptedDuration = null;
      lastStatsAdCount = null;
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
}
// НЕ через addTrackedEventListener — цей listener має жити ЗАВЖДИ,
// бо cleanup() викликається з init() і видалить його до того, як прийде waveform URL
window.addEventListener('message', _onInterceptMessage);
