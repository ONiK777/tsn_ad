var CONFIG = {
  autoOpenPanel: true,
  autoGap: true,
  minGapSec: 120,
  shortVideoCutoff: 600,
  longVideoGapSec: 120,
  shortVideoGapSec: 60,
  minSilenceSec: 1.5,
  silenceThresholdPct: 15,
  focusStart: true,
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
  inserting: false,       // Захист від подвійного запуску вставки
  insertAbort: false,     // Для зупинки вставки
};

var isPanelClosedByUser = false;

// SVG path для кнопки видалення (trash icon) в YouTube Studio ad breaks editor
var AD_BREAK_TRASH_PATH = 'M19 3h-4V2a1 1 0 00-1-1h-4a1 1 0 00-1 1v1H5a2 2 0 00-2 2h18a2 2 0 00-2-2ZM6 19V7H4v12a4 4 0 004 4h8a4 4 0 004-4V7h-2v12a2 2 0 01-2 2H8a2 2 0 01-2-2Zm4-11a1 1 0 00-1 1v8a1 1 0 102 0V9a1 1 0 00-1-1Zm4 0a1 1 0 00-1 1v8a1 1 0 002 0V9a1 1 0 00-1-1Z';

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
