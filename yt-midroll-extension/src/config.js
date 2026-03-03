// ─── КОНФІГ ──────────────────────────────────────────────────────────────────
var CONFIG = {
  autoGap: true,
  minGapSec: 180,
  shortVideoCutoff: 600,
  longVideoGapSec: 180,
  shortVideoGapSec: 60,
  minSilenceSec: 1.5,
  silenceThresholdPct: 15,
  focusStart: true,
  actionDelay: 700,
};

// ─── СТАН ────────────────────────────────────────────────────────────────────
var state = {
  silences: [],
  selected: [],
  waveformUrl: null,
  waveformData: null,
  cachedAudioBuffer: null,
  cachedAudioUrl: null,
  analyzing: false,       // Захист від одночасного запуску
  insertAbort: false,     // Для зупинки вставки
};

var isPanelClosedByUser = false;

// ─── CLEANUP ─────────────────────────────────────────────────────────────────
var activeObservers = [];
var activeEventListeners = [];

// Хелпер для додавання event listener з автоматичним трекінгом
function addTrackedEventListener(element, event, handler, options = false) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  activeEventListeners.push({ element, event, handler, options });
}

function cleanup() {
  // Відключаємо всі observers
  activeObservers.forEach(obs => {
    try { obs.disconnect(); } catch (e) { /* ignore */ }
  });
  activeObservers = [];

  // Видаляємо всі tracked event listeners
  activeEventListeners.forEach(({ element, event, handler, options }) => {
    try {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler, options);
      }
    } catch (e) { /* ignore */ }
  });
  activeEventListeners = [];

  // Очищаємо кеші
  if (typeof domCacheWithTTL !== 'undefined') {
    domCacheWithTTL.clear();
  }

  log('♻️ Cleanup виконано', 'info');
}
