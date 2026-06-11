var CONFIG = {
  autoOpenPanel: true,
  autoGap: true,
  guaranteeStandard: true, // Без пропусків: якщо у вікні немає справжньої паузи — ставимо запасну мітку в найтихішому місці
  rhythmFlexPct: 50,   // Гнучкість ритму: ±% від інтервалу при пошуку паузи (ручний режим)
  minQualityPct: 0,    // Мінімальна якість паузи, % (ручний режим; 0 = будь-яка тиша)
  startOffsetSec: 10,  // Не ставити рекламу в перші N секунд
  endOffsetSec: 15,    // Не ставити рекламу в останні N секунд
  minGapSec: 120,
  shortVideoCutoff: 600,
  longVideoGapSec: 120,
  shortVideoGapSec: 60,
  minSilenceSec: 1.5,
  silenceThresholdPct: 15,
  focusStart: true,
  autoSaveAfterInsert: true, // Автоматично натискати "Продовжити" та "Зберегти" після вставки міток
  fullAutoInsert: false, // Нуль кліків: відкрив редактор без міток → бот сам аналізує, вставляє і зберігає
};

// ─── СТАН ────────────────────────────────────────────────────────────────────
var state = {
  silences: [],
  selected: [],
  analysisMeta: null, // Підсумок авто-пілота: ціль, ритм, ескалація чутливості, діагноз відео
  autoRunUrl: null, // URL вейвформи, для якого вже виконувалась авто-вставка (захист від повторів)
  waveformUrl: null,
  waveformData: null,
  waveformZoom: 1,
  waveformOffsetSec: 0,
  waveformManualHints: true,
  cachedAudioBuffer: null,
  cachedAudioUrl: null,
  analyzing: false, // Захист від одночасного запуску
  inserting: false, // Захист від подвійного запуску вставки
  insertAbort: false, // Для зупинки вставки
  interceptedDuration: null, // Тривалість з videoplayback URL (фолбек)
  ytAdHintsRaw: null, // Перехоплені підказки YouTube про природні паузи: {times: [...], url}
  ytHintsSec: null,   // Ті ж підказки, нормовані в секунди (після аналізу)
  tgEvents: [],       // Буфер подій для Telegram-звіту (заповнюється під час вставки)
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

  // Очищаємо offscreen canvas
  if (typeof offscreenCanvas !== 'undefined') {
    offscreenCanvas = null;
    lastRenderSignature = null;
  }

  log('♻️ Cleanup виконано', 'info');
}
