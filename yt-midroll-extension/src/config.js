var CONFIG = {
  autoOpenPanel: true,
  autoGap: true,
  guaranteeStandard: true, // Без пропусків: якщо у вікні немає справжньої паузи — ставимо запасну мітку в найтихішому місці
  rhythmFlexPct: 50,   // Гнучкість ритму: ±% від інтервалу при пошуку паузи (ручний режим)
  minQualityPct: 0,    // Мінімальна якість паузи, % (ручний режим; 0 = будь-яка тиша)
  fallbackMinQualityPct: 35, // Мінімальна якість запасної мітки, %: якщо навіть найтихіше місце вікна слабше — слот пропускається, щоб YT не позначав мітку
  startOffsetSec: 40,  // Не ставити рекламу в перші N секунд
  endOffsetSec: 45,    // Не ставити рекламу в останні N секунд
  minGapSec: 120,
  shortVideoCutoff: 600,
  longVideoGapSec: 120,
  shortVideoGapSec: 60,
  minSilenceSec: 1.5,
  silenceThresholdPct: 15,
  focusStart: true,
  autoSaveAfterInsert: true, // Автоматично натискати "Продовжити" та "Зберегти" після вставки міток
  fullAutoInsert: false, // Нуль кліків: відкрив редактор без міток → бот сам аналізує, вставляє і зберігає
  preserveManualMarks: false,
};

// 3-зонна модель AVD: густий старт (00:40–05:30) → друге вікно (05:30–10:00) → догляд (10:00+)
function getIdealAdGapAt(timeSec, baseGap = 120) {
  if (!CONFIG.focusStart) return baseGap;
  if (CONFIG.autoGap) {
    if (timeSec < 330) return 70;   // 00:00 – 05:30: пікова щільність (60–75с)
    if (timeSec < 600) return 130;  // 05:30 – 10:00: друге вікно (120–150с)
    return 165;                     // 10:00+: зона догляду (150–180с)
  }
  if (timeSec < 330) return Math.max(30, baseGap * 0.6);
  if (timeSec < 600) return baseGap * 1.05;
  return baseGap * 1.35;
}

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
  existingMarks: [], // Мітки, які ВЖЕ стоять на відео (зчитані з редактора перед плануванням)
  ytAutoMarks: [],   // Таймкоди авто-міток YouTube — 100% якорі плану
  fullAutoActive: false, // Йде повний цикл авто-вставки: аналіз-звіт не шлемо, його замінить звіт вставки
};

var isPanelClosedByUser = false;

// SVG path для кнопки видалення (trash icon) в YouTube Studio ad breaks editor
var AD_BREAK_TRASH_PATH = 'M19 3h-4V2a1 1 0 00-1-1h-4a1 1 0 00-1 1v1H5a2 2 0 00-2 2h18a2 2 0 00-2-2ZM6 19V7H4v12a4 4 0 004 4h8a4 4 0 004-4V7h-2v12a2 2 0 01-2 2H8a2 2 0 01-2-2Zm4-11a1 1 0 00-1 1v8a1 1 0 102 0V9a1 1 0 00-1-1Zm4 0a1 1 0 00-1 1v8a1 1 0 002 0V9a1 1 0 00-1-1Z';

// ─── CLEANUP ─────────────────────────────────────────────────────────────────
var activeObservers = [];
var activeEventListeners = [];

var panelObservers = [];
var panelEventListeners = [];

function addPanelEventListener(element, event, handler, options = false) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  panelEventListeners.push({ element, event, handler, options });
}

function cleanupPanel() {
  panelObservers.forEach(obs => {
    try { obs.disconnect(); } catch (e) { /* ignore */ }
  });
  panelObservers = [];
  panelEventListeners.forEach(({ element, event, handler, options }) => {
    try {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler, options);
      }
    } catch (e) { /* ignore */ }
  });
  panelEventListeners = [];
}

// Хелпер для додавання event listener з автоматичним трекінгом
function addTrackedEventListener(element, event, handler, options = false) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  activeEventListeners.push({ element, event, handler, options });
}

function cleanup() {
  cleanupPanel();

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
