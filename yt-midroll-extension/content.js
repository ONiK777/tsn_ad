'use strict';

// ─── КОНФІГ (defaults, overridden by UI) ─────────────────────────────────────
const CONFIG = {
  targetAdsCount: 20,
  autoGap: true,
  minGapSec: 110,
  shortVideoCutoff: 600,   // < 10 хв = "коротке"
  longVideoGapSec: 110,    // ОНОВЛЕНО: 110 сек (майже 2 хв)
  shortVideoGapSec: 90,    // 90 сек
  minSilenceSec: 1.5,
  maxSilenceSec: 10.0,
  silenceThresholdPct: 15,
  focusStart: true,
  smoothingFrames: 5,
  actionDelay: 700,
};

// ─── СТАН ────────────────────────────────────────────────────────────────────
let state = {
  silences: [],
  selected: [],
  waveformUrl: null,
  waveformData: null, // Додаємо збереження даних вейвформи для візуалізації
  cachedAudioBuffer: null, // Кеш для миттєвого перерахунку
  cachedAudioUrl: null
};

let isPanelClosedByUser = false;

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
  if (event.source === window && event.data && event.data.type === 'MRA_WAVEFORM_URL') {
    state.waveformUrl = event.data.url;
    log('Перехоплено URL вейвформи', 'success');
    updateStatus('✅ API перехоплено! Натисніть "Аналізувати".', 'success');
  }
});

// ─── УТИЛІТИ ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms + Math.random() * 200)); }

function waitForElement(selector, timeout = 10000, interval = 100) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      const el = typeof selector === 'function' ? selector() : document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - t0 >= timeout) return reject(new Error(`Елемент не знайдено за ${timeout}мс`));
      setTimeout(check, interval);
    };
    check();
  });
}

function log(msg, type = 'info') {
  const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' };
  console.log(`%c🎬 [MRA] ${msg}`, `color:${c[type] || c.info}`);
}

function findInsertAdBreakButton() {
  for (const sel of ['button[aria-label*="ad break"]', 'ytcp-button[aria-label*="ad break"]', '#insert-ad-break-button', 'ytcp-button.insert-ad-break-button', 'ytve-ad-breaks-editor button']) {
    const b = document.querySelector(sel); if (b) return b;
  }
  for (const btn of document.querySelectorAll('button, ytcp-button')) {
    const t = btn.textContent?.toLowerCase() || '';
    if (['insert ad break', 'вставити рекламне', 'вставить рекламу', 'ad-unterbrechung', 'insertar pausa'].some(v => t.includes(v))) return btn;
  }
  return null;
}

function findTimestampInput() {
  return document.querySelector('input.ytcp-media-timestamp-input') ||
    document.querySelector('input[type="text"][placeholder*="00:00"]') ||
    [...document.querySelectorAll('input[type="text"]')].find(el => el.className.includes('timestamp') || el.className.includes('time-input'));
}

function findConfirmButton() {
  for (const btn of document.querySelectorAll('ytcp-dialog button, .ytcp-dialog button')) {
    const t = btn.textContent?.toLowerCase() || '';
    if (['insert', 'вставити', 'ok', 'confirm', 'підтвердити'].some(v => t.includes(v))) return btn;
  }
  return null;
}

function setInputValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function toTimecode(seconds) {
  // ВАЖЛИВО: YouTube Studio приймає формат [ГГ:]ММ:СС:КК
  // Останні 2 цифри - це КАДРИ (зазвичай 25-30 fps), а не соті долі секунди!
  // Якщо ми передавали 65 "сотих", YouTube рахував це як 65 кадрів = 2.5 секунди додатково!
  const f = Math.min(24, Math.floor((seconds % 1) * 25));
  const sec = Math.floor(seconds) % 60;
  const min = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

function updateStatus(msg, type = 'info') {
  const el = document.getElementById('mra-status');
  if (!el) return;
  const c = { info: '#a0c4ff', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' };
  el.style.color = c[type] || c.info;
  el.textContent = msg;
}

function updateProgress(cur, total) {
  const bar = document.getElementById('mra-progress-bar');
  const label = document.getElementById('mra-progress-label');
  if (!bar || !label) return;
  bar.style.width = (total ? Math.round(cur / total * 100) : 0) + '%';
  label.textContent = total ? `${cur} / ${total}` : '';
}

// ─── ЧИТАННЯ НАЛАШТУВАНЬ З ПАНЕЛІ ────────────────────────────────────────────
function readSettings() {
  CONFIG.targetAdsCount = parseInt(document.getElementById('mra-count')?.textContent) || 3;
  CONFIG.minSilenceSec = getVal('mra-min-silence') ?? 3.0;
  CONFIG.maxSilenceSec = getVal('mra-max-silence') ?? 10.0;
  CONFIG.silenceThresholdPct = getVal('mra-threshold') ?? 15;
  CONFIG.focusStart = document.getElementById('mra-focus-start')?.checked ?? true;
  CONFIG.autoGap = document.getElementById('mra-auto-gap')?.checked ?? true;
  CONFIG.minGapSec = getVal('mra-min-gap') ?? 180;
  CONFIG.shortVideoCutoff = (getVal('mra-cutoff') ?? 10) * 60;
  CONFIG.longVideoGapSec = getVal('mra-long-gap') ?? 180;
  CONFIG.shortVideoGapSec = getVal('mra-short-gap') ?? 60;
}

// ─── АНАЛІЗ АУДІО ────────────────────────────────────────────────────────────

// Спроба визначити формат даних та витягти правильний масив амплітуд
function detectAndParseSamples(buffer, duration) {
  const totalBytes = buffer.byteLength;

  // YouTube зазвичай віддає Uint8Array (0-255 амплітудна огинаюча)
  const u8 = new Uint8Array(buffer);

  // Перевіримо, чи це натомість справжній Float32
  // Якщо це справжні флоати (Float32), там будуть адекватні значення ~ 0.01 - 1.0. 
  // Якщо ж це байти (Uint8), які МИ прочитаємо як Float32, то 99% з них будуть 
  // або "сміттям" або мікроскопічними числами на кшталт 1.4e-40 (бо байти маленькі), і багато нулів
  const f32 = new Float32Array(buffer);
  let validFloats = 0;
  for (let i = 0; i < f32.length; i += 10) {
    const v = Math.abs(f32[i]);
    if (v > 0.0001 && v < 2.0) validFloats++;
  }
  // Якщо хоча б 5% чисел схожі на нормальний аудіо-флоат (не тиша і не сміття)
  const isFloat32 = (validFloats > f32.length / 50);

  let samples, fmt, totalSamples;
  if (isFloat32) {
    samples = f32;
    fmt = 'Float32';
    totalSamples = f32.length;
  } else {
    // Якщо сервером повернуто байти (Uint8) - перевіримо, це PCM (центр ~128) чи Огинаюча (центр ~0)
    let sumU8 = 0;
    const checkCnt = Math.min(2000, totalBytes);
    for (let i = 0; i < checkCnt; i++) sumU8 += u8[Math.floor((i / checkCnt) * totalBytes)];
    const avgU8 = sumU8 / checkCnt;

    // Якщо це PCM, тиша знаходиться біля значення 128
    const isPCM128 = (avgU8 > 100 && avgU8 < 156);

    samples = new Float32Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      if (isPCM128) {
        samples[i] = (u8[i] - 128) / 128.0; // перетворюємо на [-1 .. 1]
      } else {
        samples[i] = u8[i] / 255.0; // перетворюємо на [0 .. 1] (Огинаюча)
      }
    }
    fmt = isPCM128 ? 'Uint8 (PCM-128)' : 'Uint8 (Envelope)';
    totalSamples = totalBytes;
  }

  const secPerSample = duration / totalSamples;

  // Визначаємо еквівалентну "частоту дискретизації" даних
  const equivalentSampleRate = Math.round(totalSamples / duration);

  // Статистика
  let min = Infinity, max = -Infinity, sumAbs = 0, nonZero = 0;
  for (let i = 0; i < totalSamples; i++) {
    const v = samples[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sumAbs += Math.abs(v);
    if (Math.abs(v) > 0.001) nonZero++;
  }
  const avgAbs = sumAbs / totalSamples;
  const nonZeroPct = (nonZero / totalSamples * 100).toFixed(1);

  console.group('%c🎬 [MRA] ДІАГНОСТИКА ВЕЙВФОРМИ', 'color:#ffd166;font-weight:bold;font-size:13px');
  console.log(`📦 Розмір буфера:    ${totalBytes} байт`);
  console.log(`📐 Формат:           ${fmt}`);
  console.log(`🔢 К-сть семплів:    ${totalSamples.toLocaleString()}`);
  console.log(`⏱️  Тривалість відео: ${duration.toFixed(2)} с`);
  console.log(`⚡ Ефект. частота:   ${equivalentSampleRate} sample/с`);
  console.log(`   (PCM аудіо = 44100 | Візуалізація = 10-200)`);
  console.log(`📊 Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}, AvgAbs: ${avgAbs.toFixed(4)}`);
  console.log(`📈 Ненульових семплів: ${nonZeroPct}%`);

  // Міні-вейвформа (ASCII) — перші 100 "кроків" → допомагає побачити структуру
  const step = Math.max(1, Math.floor(totalSamples / 100));
  let ascii = '';
  for (let i = 0; i < totalSamples; i += step) {
    const v = Math.abs(samples[i]);
    if (v < avgAbs * 0.1) ascii += '░';
    else if (v < avgAbs * 0.5) ascii += '▒';
    else if (v < avgAbs * 1.5) ascii += '▓';
    else ascii += '█';
  }
  console.log(`\n🌊 Міні-вейвформа (${ascii.length} знаків = вся тривалість):\n${ascii}\n`);
  console.log(`   ░ = майже тиша  ▒ = тихо  ▓ = нормально  █ = голосно`);
  console.groupEnd();

  return { samples, fmt, secPerSample, equivalentSampleRate, avgAbs };
}



async function analyzeWaveform() {
  if (!state.waveformUrl) {
    updateStatus('❌ URL вейвформи не знайдено. Перезавантажте сторінку.', 'error');
    return false;
  }

  readSettings();
  const video = document.querySelector('video');
  if (!video) throw new Error('Відео не знайдено');
  const duration = video.duration;

  let buffer;
  if (state.cachedAudioUrl === state.waveformUrl && state.cachedAudioBuffer) {
    updateStatus('⚡ Швидкий перерахунок (використовуємо кеш аудіо)...', 'info');
    buffer = state.cachedAudioBuffer;
  } else {
    updateStatus('⬇️ Завантажуємо вейвформу...', 'info');
    const response = await fetch(state.waveformUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = await response.arrayBuffer();
    state.cachedAudioUrl = state.waveformUrl;
    state.cachedAudioBuffer = buffer;
  }

  const { samples, fmt, secPerSample, equivalentSampleRate, avgAbs } = detectAndParseSamples(buffer, duration);

  updateStatus(`⚙️ ${fmt}, ~${equivalentSampleRate} sps. Будуємо огинаючу...`, 'info');

  const totalSamples = samples.length;
  const BLOCK = equivalentSampleRate > 5000
    ? Math.max(1, Math.floor(0.02 / secPerSample))
    : 1;
  const totalBlocks = Math.ceil(totalSamples / BLOCK);
  const secPerBlock = BLOCK * secPerSample;

  // ── Amplitude envelope (absolute value per block) ──────────────────────────
  const amp = new Float32Array(totalBlocks);
  for (let i = 0; i < totalBlocks; i++) {
    let sum = 0;
    const s = i * BLOCK, e = Math.min(s + BLOCK, totalSamples);
    for (let j = s; j < e; j++) sum += Math.abs(samples[j]);
    amp[i] = sum / (e - s);
  }

  // ── Згладжування (Швидкий алгоритм ковзного вікна O(N)) ─────────
  const smBlocks = Math.max(1, Math.round(0.15 / secPerBlock));
  const smoothed = new Float32Array(totalBlocks);
  let currentSum = 0;
  let windowSize = 0;

  for (let k = 0; k <= Math.min(totalBlocks - 1, smBlocks); k++) {
    currentSum += amp[k];
    windowSize++;
  }
  smoothed[0] = currentSum / windowSize;

  for (let i = 1; i < totalBlocks; i++) {
    if (i + smBlocks < totalBlocks) {
      currentSum += amp[i + smBlocks];
      windowSize++;
    }
    if (i - smBlocks - 1 >= 0) {
      currentSum -= amp[i - smBlocks - 1];
      windowSize--;
    }
    smoothed[i] = currentSum / windowSize;
  }

  log(`Огинаюча: ${totalBlocks} блоків, ${secPerBlock.toFixed(3)}с/блок, згладж. ±${smBlocks}бл, fmt=${fmt}`, 'info');

  // ── Глобальний пошук справжніх пауз ──────────────────────────────────────────
  // 1. Повертаємо мін. паузу, щоб шукати справжні розриви в розмові.
  // 2. Поріг тиші (silenceThresholdPct) — це процент ВІД СЕРЕДНЬОЇ ГУЧНОСТІ. 
  // Наприклад 30% означає: все, що тихіше за 30% середнього — це тиша.
  const count = CONFIG.targetAdsCount;
  const gap = CONFIG.autoGap
    ? (duration < CONFIG.shortVideoCutoff ? CONFIG.shortVideoGapSec : CONFIG.longVideoGapSec)
    : CONFIG.minGapSec;

  // ВИПРАВЛЕННЯ: Тепер поріг рахується через ПЕРЦЕНТИЛЬ, а не відсоток від максимуму чи середнього!
  // Це найефективніший спосіб: ми сортуємо всю гучність, і якщо поріг = 15%, 
  // то лише 15% найтихіших моментів у ВСЬОМУ ВІДЕО будуть вважатися "тишею".
  let maxAmp = -Infinity;
  for (let i = 0; i < totalBlocks; i++) {
    if (smoothed[i] > maxAmp) maxAmp = smoothed[i];
  }

  const sortedAmps = Array.from(smoothed).sort((a, b) => a - b);
  const p10 = sortedAmps[Math.floor(totalBlocks * 0.10)];
  const p50 = sortedAmps[Math.floor(totalBlocks * 0.50)];

  // Перцентиль! Якщо користувач обрав 15% у налаштуваннях — беремо 15-й перцентиль.
  const pctIndex = Math.floor(totalBlocks * Math.max(0.01, Math.min(0.99, CONFIG.silenceThresholdPct / 100)));
  const GLOBAL_THRESHOLD = sortedAmps[pctIndex];

  console.group('%c🔍 АНАЛІЗ ПОРОГІВ (Перцентиль)', 'color:#ffd166;font-weight:bold');
  console.log(`  Max амплітуда:     ${maxAmp.toFixed(4)}`);
  console.log(`  Середня (avgAbs):  ${avgAbs.toFixed(4)}`);
  console.log(`  10-й перцентиль:   ${p10.toFixed(4)}`);
  console.log(`  Медіана (50%):     ${p50.toFixed(4)}`);
  console.log(`  Поріг тиші (${CONFIG.silenceThresholdPct} перцентиль): ${GLOBAL_THRESHOLD.toFixed(4)} амплітуди`);
  console.groupEnd();

  // Знаходимо ВІДРІЗКИ ТИШІ: поспіль блоки < GLOBAL_THRESHOLD
  let currentSilenceStart = null;
  const rawSilences = [];

  for (let b = 0; b < totalBlocks; b++) {
    const isQuiet = smoothed[b] < GLOBAL_THRESHOLD;

    if (isQuiet && currentSilenceStart === null) {
      currentSilenceStart = b;
    } else if (!isQuiet && currentSilenceStart !== null) {
      // Тиша закінчилась, перевіряємо її довжину
      const silenceBlocks = b - currentSilenceStart;
      const silenceSecs = silenceBlocks * secPerBlock;

      // Якщо пауза достатньо довга (мінімум 3 секунди)
      const minS = CONFIG.minSilenceSec ?? 3.0;
      if (silenceSecs >= minS) {
        // Знаходимо саме "дно" всередині цієї довгої паузи
        let minAmp = Infinity;
        for (let j = currentSilenceStart; j < b; j++) {
          if (smoothed[j] < minAmp) { minAmp = smoothed[j]; }
        }

        // Ставимо мітку на ПОЧАТКУ паузи + 0.5с (стабільніше, одразу після слова)
        const markSec = currentSilenceStart * secPerBlock + 0.5;

        // ІГНОРУВАТИ початок відео (перші 10 секунд - там ніколи немає пауз)
        if (markSec < 10) {
          currentSilenceStart = null;
          continue;
        }

        rawSilences.push({
          timecode: toTimecode(markSec),
          seconds: +markSec.toFixed(2),
          duration_sec: +silenceSecs.toFixed(1), // ДОВЖИНА паузи у секундах!
          amplitude: +minAmp.toFixed(4)
        });
      }
      currentSilenceStart = null;
    }
  }

  // Якщо відео закінчилось паузою
  if (currentSilenceStart !== null) {
    const silenceBlocks = totalBlocks - currentSilenceStart;
    const silenceSecs = silenceBlocks * secPerBlock;
    const minS = CONFIG.minSilenceSec ?? 3.0;
    if (silenceSecs >= minS) {
      const markSec = currentSilenceStart * secPerBlock + 0.5;

      // ІГНОРУВАТИ початок відео
      if (markSec >= 10) {
        rawSilences.push({
          timecode: toTimecode(markSec),
          seconds: +markSec.toFixed(2),
          duration_sec: +silenceSecs.toFixed(1),
          amplitude: 0
        });
      }
    }
  }

  log(`Знайдено ${rawSilences.length} справжніх пауз довжиною ≥ ${CONFIG.minSilenceSec || 3.0}с (поріг ${CONFIG.silenceThresholdPct}% від max)`, rawSilences.length > 0 ? 'success' : 'warn');

  // Візуалізація знайдених пауз на тімлайні
  if (rawSilences.length > 0) {
    const step = Math.max(1, Math.floor(totalBlocks / 80)); // 80 символів
    let timeline = '';
    for (let i = 0; i < totalBlocks; i += step) {
      const timeSec = i * secPerBlock;
      const isPause = rawSilences.some(p => Math.abs(p.seconds - timeSec) < 5);
      timeline += isPause ? '🔇' : (smoothed[i] < GLOBAL_THRESHOLD ? '░' : '█');
    }
    console.log('%c📍 Розташування пауз на тімлайні:', 'color:#06d6a0;font-weight:bold');
    console.log(`  ${timeline}`);
    console.log(`  🔇 = знайдена пауза | ░ = тихо | █ = гучно\n`);
  }

  const selectedCands = [];

  if (CONFIG.focusStart) {
    // ЖАДІБНИЙ АЛГОРИТМ З ПРІОРИТЕТОМ НА ПОЧАТОК
    // Гарантує, що мітки будуть масово скупчуватись на початку відео в рамках дозволеного Gap.
    let candsFocus = rawSilences.map(s => {
      let score = s.duration_sec / ((s.amplitude || 0) + 0.01);
      // Квадратичний множник: на самому початку відео цінність паузи зростає до x3 разів
      score *= (1 + 2 * Math.pow(1 - s.seconds / duration, 2));
      return { ...s, score };
    });

    // Сортуємо за фінальним накрученим скором
    candsFocus.sort((a, b) => b.score - a.score);

    for (const c of candsFocus) {
      if (selectedCands.length >= count) break;
      // ЖОРСТКА ВІДСТАНЬ: Ніяк не дозволяємо ставити мітки ближче, ніж вказаний GAP
      // Це гарантує стабільні 1.5-2 хв між усіма рекламами.
      let currentGap = gap;
      if (!selectedCands.some(sel => Math.abs(sel.seconds - c.seconds) < currentGap)) {
        selectedCands.push(c);
      }
    }
  } else {
    // КЛАСИЧНИЙ РІВНОМІРНИЙ РОЗПОДІЛ
    const cands = rawSilences.map(s => ({ ...s, score: s.duration_sec / ((s.amplitude || 0) + 0.01) }));
    const segDur = duration / (count + 1);

    for (let i = 1; i <= count; i++) {
      let idealSec = duration * (i / (count + 1));
      let bestMatch = null;
      let bestScore = -Infinity;

      for (const c of cands) {
        if (selectedCands.some(sel => Math.abs(sel.seconds - c.seconds) < gap)) continue;
        const diff = Math.abs(c.seconds - idealSec);
        const timeDiffPenalty = Math.max(0, diff - (segDur * 0.15)) * 0.15;
        const compoundScore = c.score - timeDiffPenalty;

        if (diff > (segDur * 0.5) && c.duration_sec < 5) continue;

        if (compoundScore > bestScore) {
          bestScore = compoundScore;
          bestMatch = c;
        }
      }

      if (bestMatch) selectedCands.push(bestMatch);
    }

    if (selectedCands.length < count) {
      cands.sort((a, b) => b.score - a.score);
      for (const c of cands) {
        if (selectedCands.length >= count) break;
        if (!selectedCands.some(sel => Math.abs(sel.seconds - c.seconds) < gap)) {
          selectedCands.push(c);
        }
      }
    }
  }

  state.selected = selectedCands;
  state.selected.sort((a, b) => a.seconds - b.seconds);

  console.group('%c🎬 [MRA] Відібрані реальні паузи', 'color:#06d6a0;font-weight:bold');
  state.selected.forEach((s, i) =>
    console.log(`  ${i + 1}. ${s.timecode}  (пауза: ${s.duration_sec}с, амп: ${s.amplitude})`)
  );
  if (state.selected.length === 0)
    console.log('  ⚠️ Не вдалось знайти підходящих пауз з таким інтервалом та параметрами!');
  console.groupEnd();

  log(`Відібрано ${state.selected.length}/${count} рекламних місць (gap=${gap}с)`, state.selected.length > 0 ? 'success' : 'warn');
  updateStatus(
    state.selected.length > 0
      ? `✅ ${state.selected.length}/${count} місць знайдено (≥${CONFIG.minSilenceSec || 3}с тиші)`
      : `⚠️ 0 місць! Зменш "Мін. паузу" або збільш "Поріг"`,
    state.selected.length > 0 ? 'success' : 'warn'
  );

  state.silences = rawSilences; // зберігаємо всі для тестування

  // Зберігаємо дані для візуалізації
  state.waveformData = {
    smoothed: smoothed,
    duration: duration,
    totalBlocks: totalBlocks,
    secPerBlock: secPerBlock,
    threshold: GLOBAL_THRESHOLD
  };

  renderSelectedList();
  renderWaveform(); // Малюємо вейвформу!
  return true;
}

function renderSelectedList() {
  const list = document.getElementById('mra-list');
  if (!list) return;
  list.innerHTML = '';
  state.selected.forEach((s, i) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;';
    const manualBadge = s.manual ? '<span style="color:#ffffff;font-size:10px;" title="Вручну додано">✋</span>' : '';
    item.innerHTML = `
      <span style="color:#c91c1c;font-weight:bold;">${i + 1}.</span>
      <span style="color:#e0e0e0;">${s.timecode}</span>
      <span style="color:#888;font-size:11px;">(${s.duration_sec}с)</span>
      ${manualBadge}
      <button style="margin-left:auto;background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
    `;
    item.querySelector('button').addEventListener('click', () => { state.selected.splice(i, 1); renderSelectedList(); renderWaveform(); });
    list.appendChild(item);
  });
  const insertBtn = document.getElementById('mra-insert');
  if (insertBtn) insertBtn.disabled = state.selected.length === 0;
}

// ─── ВІЗУАЛІЗАЦІЯ ВЕЙВФОРМИ ───────────────────────────────────────────────────
function renderWaveform() {
  const canvas = document.getElementById('mra-waveform');
  const section = document.getElementById('mra-waveform-section');

  if (!canvas || !state.waveformData) {
    if (section) section.style.display = 'none';
    return;
  }

  // Показати секцію
  if (section) section.style.display = '';

  const { smoothed, duration, totalBlocks, threshold } = state.waveformData;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Очистити canvas
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);

  // Намалювати вейвформу
  const step = Math.max(1, Math.ceil(totalBlocks / w));
  const maxAmp = Math.max(...smoothed);

  for (let x = 0; x < w; x++) {
    const blockIdx = Math.floor(x * step);
    if (blockIdx >= totalBlocks) break;

    const amp = smoothed[blockIdx];
    const normalizedAmp = amp / maxAmp;
    const barHeight = normalizedAmp * h * 0.8;

    // Колір залежить від гучності
    const isQuiet = amp < threshold;
    ctx.fillStyle = isQuiet ? '#222222' : '#888888';

    const barY = (h - barHeight) / 2;
    ctx.fillRect(x, barY, 1, barHeight);
  }

  // Намалювати лінію порогу тиші
  const thresholdY = h - (threshold / maxAmp * h * 0.8);
  ctx.strokeStyle = '#555555';
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.moveTo(0, thresholdY);
  ctx.lineTo(w, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Намалювати всі знайдені паузи (темні напівпрозорі зони)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  state.silences.forEach(s => {
    const x = (s.seconds / duration) * w;
    ctx.fillRect(x - 1, 0, 2, h);
  });

  // Намалювати відібрані паузи (яскраві ТОВСТІ маркери)
  state.selected.forEach((s, i) => {
    const x = (s.seconds / duration) * w;
    const isManual = s.manual;

    // Вертикальна лінія (Червона для авто, Біла для ручних)
    ctx.strokeStyle = isManual ? 'rgba(255, 255, 255, 0.9)' : 'rgba(201, 28, 28, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // Номер мітки
    ctx.fillStyle = isManual ? '#ffffff' : '#ff0000';
    ctx.font = 'bold 11px Arial';
    const label = isManual ? `✋${i + 1}` : (i + 1).toString();
    ctx.fillText(label, x + 4, 12);
  });

  // Додати часові мітки внизу
  ctx.fillStyle = '#666';
  ctx.font = '9px Arial';
  const timeMarks = 6;
  for (let i = 0; i <= timeMarks; i++) {
    const x = (i / timeMarks) * w;
    const timeSec = (i / timeMarks) * duration;
    const timeStr = Math.floor(timeSec / 60) + 'm';
    ctx.fillText(timeStr, x, h - 2);
  }

  log('Вейвформа оновлена', 'info');
}

// ─── АВТОВСТАВКА ─────────────────────────────────────────────────────────────
async function insertTimecodes() {
  const silences = state.selected;
  if (!silences.length) return;

  updateStatus(`⏳ Вставляємо ${silences.length} таймкоди...`, 'info');
  updateProgress(0, silences.length);

  let ok = 0, fail = 0;

  for (let idx = 0; idx < silences.length; idx++) {
    const s = silences[idx];
    log(`[${idx + 1}/${silences.length}] Вставка: ${s.timecode}`, 'info');

    try {
      // ХИТРІСТЬ: Спочатку пересуваємо "головку" плеєра на потрібний час.
      // Тоді YouTube автоматично створить мітку саме в цьому місці, а не на початку 00:00:00
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = s.seconds;
        video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        video.dispatchEvent(new Event('seeked', { bubbles: true }));
        await sleep(300); // Даємо компонентам YouTube час оновити UI на новий таймкод
      }

      const inputsBefore = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));

      const btn = findInsertAdBreakButton();
      if (!btn) throw new Error('Кнопка вставки не знайдена');
      btn.click();
      await sleep(CONFIG.actionDelay);

      // ВИПРАВЛЕННЯ 00:00:00 - шукаємо ТІЛЬКИ ЩО доданий рядок (через активний елемент або різницю DOM)
      let input = null;
      for (let attempts = 0; attempts < 15; attempts++) {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT' && (activeEl.classList.contains('ytcp-media-timestamp-input') || activeEl.placeholder?.includes('00:00'))) {
          input = activeEl;
          break;
        }

        const inputsAfter = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));
        const newInputs = inputsAfter.filter(el => !inputsBefore.includes(el) && (el.classList.contains('ytcp-media-timestamp-input') || el.placeholder?.includes('00:00')));
        if (newInputs.length > 0) { input = newInputs[0]; break; }

        await sleep(200);
      }

      if (!input) {
        // Якщо все ще не знайшли фокус, беремо ОСТАННІЙ (так як YouTube додає їх останніми)
        const allTimeInputs = document.querySelectorAll('input.ytcp-media-timestamp-input, input[placeholder*="00:00"]');
        if (allTimeInputs.length > 0) input = allTimeInputs[allTimeInputs.length - 1];
      }

      if (!input) throw new Error('Поле вводу часу не з\'явилося!');

      // Значно більша затримка для ПЕРШОГО поля, бо React дуже агресивно блокує ввід при ініціалізації
      if (idx === 0) await sleep(1200);
      else await sleep(200);

      const typeTimecode = async () => {
        input.focus(); await sleep(100);
        input.select(); await sleep(50);

        // Хакаємо React: спочатку відправляємо реальне стирання (Backspace)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true }));
        await sleep(50);

        document.execCommand('insertText', false, s.timecode);
        await sleep(400); // Даємо час React "перетравити" події
      };

      await typeTimecode();

      // Перевірка: чи React скинув ввід на 00:00:00?
      let val = (input.value || '').replace(/[^0-9]/g, '');
      const isStillZero = !val || val === '00000000' || val === '000000';

      if (isStillZero) {
        log('⚠️ React заблокував ввід (fallback #1). Перезаписуємо...', 'warn');
        input.blur(); await sleep(300);

        await typeTimecode();
        val = (input.value || '').replace(/[^0-9]/g, '');

        if (!val || val === '00000000' || val === '000000') {
          log('⚠️ Жорсткий рівень 2 (Native Setter)...', 'error');
          // Жорсткий рівень 2: Змінюємо сам прототип, щоб обдурити React
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(input, s.timecode);
          input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          await sleep(200);
          input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          await sleep(300);
        }
      }

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(300);

      const confirmBtn = findConfirmButton();
      if (confirmBtn) confirmBtn.click();

      ok++;
      updateProgress(ok, silences.length);
      log(`✅ ${s.timecode} вставлено`, 'success');
      await sleep(1000);
    } catch (e) {
      fail++;
      log(`❌ ${s.timecode}: ${e.message}`, 'error');
      const closeBtn = document.querySelector('ytcp-dialog [aria-label*="close"], ytcp-dialog .close-button');
      if (closeBtn) { closeBtn.click(); await sleep(500); }
    }
  }

  updateStatus(
    fail === 0 ? `🏁 Готово! ${ok} маркери вставлено. Натисніть "Зберегти"!` : `⚠️ Вставлено: ${ok}, помилок: ${fail}`,
    fail === 0 ? 'success' : 'warn'
  );
  updateProgress(ok, silences.length);
}

// ─── ШАБЛОНИ UI ──────────────────────────────────────────────────────────────
function row(label, ctrl, hint = '') {
  return `<div class="mr"><span class="ml">${label}</span><span class="mc">${ctrl}</span>${hint ? `<span class="mh">${hint}</span>` : ''}</div>`;
}

// Власний stepper: −  [value]  + (без input type=number → ніякого scroll-hijacking)
function stepper(id, val, min, max, step) {
  return `<div class="stp" data-id="${id}" data-val="${val}" data-min="${min}" data-max="${max}" data-step="${step}">
    <button class="mcb stp-m">−</button>
    <span class="stp-v">${val}</span>
    <button class="mcb stp-p">+</button>
  </div>`;
}

function getVal(id) {
  const el = document.querySelector(`.stp[data-id="${id}"] .stp-v`);
  return el ? parseFloat(el.textContent) : null;
}

// ─── UI ПАНЕЛЬ ────────────────────────────────────────────────────────────────
function createPanel() {
  if (document.getElementById('mra-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'mra-panel';
  panel.innerHTML = `
<style>
#mra-panel{position:fixed;top:72px;right:16px;z-index:99999;background:#111111;color:#e0e0e0;border-radius:8px;border:1px solid #333;box-shadow:0 8px 32px rgba(0,0,0,.8);font-family:'Roboto',sans-serif;font-size:12px;width:340px;overflow:hidden;user-select:none;display:flex;flex-direction:column;max-height:calc(100vh - 100px);}
#mra-header{background:linear-gradient(135deg,#222,#111);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:move;border-bottom:2px solid #c91c1c;flex-shrink:0;}
#mra-title{font-weight:900;font-size:14px;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;}
#mra-minimize, #mra-close, #mra-reload{background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:0;line-height:1;margin-left:4px}
#mra-minimize:hover{color:#fff}
#mra-close:hover{color:#ff6b6b}
#mra-reload:hover{color:#06d6a0}
#mra-body{padding:10px 14px;overflow-y:auto;overflow-x:hidden;}
.ms{margin-bottom:8px}
.mst{font-size:11px;font-weight:900;color:#c91c1c;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #333}
.mr{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap}
.ml{color:#bbb;font-size:11px;flex:1;min-width:110px}
.mc{display:flex;align-items:center;gap:4px}
.mh{color:#666;font-size:10px;width:100%;padding-left:4px}
.mcnt,.stp{display:flex;align-items:center;gap:4px}
.mcb{width:22px;height:22px;background:#222;border:1px solid #444;color:#e0e0e0;border-radius:4px;cursor:pointer;font-size:14px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:0.1s;}
.mcb:hover{background:#c91c1c;color:#fff;border-color:#c91c1c}
#mra-count,.stp-v{min-width:38px;text-align:center;color:#fff;font-size:13px;font-weight:900;background:#1a1a1a;border:1px solid #444;border-radius:4px;padding:2px 6px}
#mra-count{color:#c91c1c;font-size:15px}
.mtw{display:flex;align-items:center;gap:6px;margin-bottom:5px}
.mt{position:relative;width:32px;height:17px;display:inline-block}
.mt input{opacity:0;width:0;height:0}
.msl{position:absolute;inset:0;background:#444;border-radius:17px;cursor:pointer;transition:.2s}
.msl:before{content:'';position:absolute;height:12px;width:12px;left:3px;bottom:2.5px;background:#aaa;border-radius:50%;transition:.2s}
input:checked+.msl{background:#c91c1c}
input:checked+.msl:before{transform:translateX(14px);background:#fff}
.mtl{color:#bbb;font-size:11px}
#mra-analyze,#mra-insert{width:100%;padding:10px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;transition:all .2s;margin-bottom:6px}
#mra-analyze{background:#c91c1c;color:#ffffff}
#mra-analyze:hover{background:#cc0000}
#mra-insert{background:#222;color:#ffffff;border:1px solid #c91c1c}
#mra-insert:hover:not(:disabled){background:#c91c1c}
#mra-insert:disabled{opacity:.4;cursor:not-allowed;border-color:#444;color:#777}
#mra-list{margin:6px 0;max-height:120px;overflow-y:auto}
#mra-list::-webkit-scrollbar{width:4px}
#mra-list::-webkit-scrollbar-track{background:#111}
#mra-list::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
#mra-divider{border:none;border-top:1px solid #333;margin:8px 0}
#mra-progress-wrap{height:4px;background:#222;border-radius:2px;margin:6px 0;overflow:hidden}
#mra-progress-bar{height:100%;background:#c91c1c;width:0%;transition:width .3s;border-radius:2px}
#mra-progress-label{color:#888;font-size:10px;text-align:right;margin-bottom:3px}
#mra-status{font-size:11px;color:#ccc;min-height:16px;word-break:break-word;line-height:1.4}
</style>

<div id="mra-header">
  <div id="mra-title"><span style="background:#c91c1c;color:#fff;padding:2px 5px;border-radius:3px;margin-right:6px;">ТСН</span> АВТОРЕКЛАМА</div>
  <div style="display:flex;align-items:center;gap:6px">
    <button id="mra-reload" title="Перезапустити розширення (Очистити дані)">↻</button>
    <button id="mra-minimize" title="Згорнути">−</button>
    <button id="mra-close" title="Закрити панель">✕</button>
  </div>
</div>

<div id="mra-body">

  <div class="ms">
    <div class="mst">📊 Основне</div>
    <div class="mr">
      <span class="ml">К-сть реклам:</span>
      <span class="mc">
        <div class="mcnt">
          <button class="mcb" id="mra-count-dec">−</button>
          <span id="mra-count">20</span>
          <button class="mcb" id="mra-count-inc">+</button>
        </div>
      </span>
    </div>
  </div>

  <div class="ms">
    <div class="mst">🔇 Де ставити рекламу</div>
    ${row('Мін. тривалість паузи (с):', stepper('mra-min-silence', 1.5, 0.5, 30, 0.5))}
    ${row('Поріг тиші (%):', stepper('mra-threshold', 15, 1, 50, 1), '% від максимуму (↓ = більше пауз)')}
  </div>

  <div class="ms">
    <div class="mst">↔️ Відстань між рекламами</div>
    <div class="mtw">
      <label class="mt"><input type="checkbox" id="mra-auto-gap" checked><span class="msl"></span></label>
      <span class="mtl">Авто-режим (за тривалістю відео)</span>
    </div>
    <div class="mtw">
      <label class="mt"><input type="checkbox" id="mra-focus-start" checked><span class="msl"></span></label>
      <span class="mtl" style="color:#06d6a0;">Більше реклами на початку (утримання)</span>
    </div>
    <div id="mra-auto-sect">
      ${row('Поріг "коротке" відео (хв):', stepper('mra-cutoff', 10, 1, 120, 1))}
      ${row('Gap короткого відео (с):', stepper('mra-short-gap', 90, 10, 600, 10))}
      ${row('Gap довгого відео (с):', stepper('mra-long-gap', 110, 10, 3600, 10))}
    </div>
    <div id="mra-manual-sect" style="display:none">
      ${row('Мін. відстань між рекламами (с):', stepper('mra-min-gap', 110, 10, 7200, 10))}
    </div>
  </div>

  <button id="mra-analyze">🔴 Аналізувати паузи</button>

  <div class="ms" id="mra-waveform-section" style="display:none;">
    <div class="mst">🌊 Вейвформа (те, що бачить бот ВАЛЕРА)</div>
    <canvas id="mra-waveform" width="282" height="80" style="width:100%;border:1px solid #333;border-radius:6px;cursor:crosshair;background:#1a1a1a;" title="Клік = додати/видалити мітку"></canvas>
    <div style="color:#666;font-size:9px;margin-top:3px;">
      <span style="color:#e60000;">━</span> = авто-паузи |
      <span style="color:#ffffff;">━✋</span> = вручну |
      <span style="color:#ffd166;">- -</span> = поріг |
      <span style="color:#888;">Клік = додати/видалити</span>
    </div>
  </div>

  <div id="mra-list"></div>
  <hr id="mra-divider">
  <button id="mra-insert" disabled>⚡ Вставити маркери</button>
  <div id="mra-progress-label"></div>
  <div id="mra-progress-wrap"><div id="mra-progress-bar"></div></div>
  <div id="mra-status">Готовий до роботи</div>
</div>
  `;

  document.body.appendChild(panel);

  // ── Авто-перерахунок при зміні налаштувань ──
  let analyzeTimer = null;
  function triggerAutoAnalyze() {
    if (state.cachedAudioBuffer) {
      clearTimeout(analyzeTimer);
      analyzeTimer = setTimeout(() => {
        analyzeWaveform().catch(e => console.error(e));
      }, 250); // Легка затримка щоб не перераховувати під час швидкого клікання
    }
  }

  // ── Прив'язуємо stepper-кнопки (−/+) до всіх контролів ──
  panel.querySelectorAll('.stp').forEach(stp => {
    const valEl = stp.querySelector('.stp-v');
    const minVal = parseFloat(stp.dataset.min);
    const maxVal = parseFloat(stp.dataset.max);
    const step = parseFloat(stp.dataset.step);

    stp.querySelector('.stp-m').addEventListener('click', () => {
      const cur = parseFloat(valEl.textContent);
      const next = Math.round((cur - step) * 1000) / 1000;
      if (next >= minVal) { valEl.textContent = next; triggerAutoAnalyze(); }
    });
    stp.querySelector('.stp-p').addEventListener('click', () => {
      const cur = parseFloat(valEl.textContent);
      const next = Math.round((cur + step) * 1000) / 1000;
      if (next <= maxVal) { valEl.textContent = next; triggerAutoAnalyze(); }
    });
  });

  // ── Лічильник реклам (без обмеження зверху) ──
  const countEl = document.getElementById('mra-count');
  document.getElementById('mra-count-dec').addEventListener('click', () => {
    const v = parseInt(countEl.textContent) || 3;
    if (v > 1) { countEl.textContent = v - 1; triggerAutoAnalyze(); }
  });
  document.getElementById('mra-count-inc').addEventListener('click', () => {
    countEl.textContent = (parseInt(countEl.textContent) || 3) + 1;
    triggerAutoAnalyze();
  });

  // ── Тогл авто-gap ──
  const autoGapCb = document.getElementById('mra-auto-gap');
  autoGapCb.addEventListener('change', () => {
    document.getElementById('mra-auto-sect').style.display = autoGapCb.checked ? '' : 'none';
    document.getElementById('mra-manual-sect').style.display = autoGapCb.checked ? 'none' : '';
    triggerAutoAnalyze();
  });

  const focusStartCb = document.getElementById('mra-focus-start');
  if (focusStartCb) focusStartCb.addEventListener('change', triggerAutoAnalyze);

  // ── Аналізувати ──
  document.getElementById('mra-analyze').addEventListener('click', async () => {
    updateStatus('⏳ Аналізуємо...', 'info');
    try { await analyzeWaveform(); }
    catch (e) { updateStatus('❌ Помилка: ' + e.message, 'error'); log(e.message, 'error'); }
  });

  // ── Клік по вейвформі для додавання мітки вручну ──
  const waveformCanvas = document.getElementById('mra-waveform');
  if (waveformCanvas) {
    waveformCanvas.addEventListener('click', (e) => {
      if (!state.waveformData) return;

      const rect = waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickPercent = x / rect.width;
      const clickSec = clickPercent * state.waveformData.duration;

      // Перевірити, чи клік близько до існуючої мітки (для видалення)
      const existingIdx = state.selected.findIndex(s => Math.abs(s.seconds - clickSec) < 5);

      if (existingIdx !== -1) {
        // Видалити мітку
        state.selected.splice(existingIdx, 1);
        log(`Видалено мітку на ${toTimecode(clickSec)} `, 'warn');
      } else {
        // Додати нову мітку
        let finalSec = clickSec;
        // МАГНІТ: Примагнітити до найближчого реального розриву (якщо він ближче ніж 2.5с)
        let closestRaw = null;
        let minDist = 2.5;
        state.silences.forEach(s => {
          const dist = Math.abs(s.seconds - clickSec);
          if (dist < minDist) { minDist = dist; closestRaw = s; }
        });

        if (closestRaw) {
          finalSec = closestRaw.seconds;
          log('🧲 Клік примагнітився до реальної паузи (ідеального початку)!', 'info');
        }

        state.selected.push({
          timecode: toTimecode(finalSec),
          seconds: +finalSec.toFixed(2),
          duration_sec: closestRaw ? closestRaw.duration_sec : 0,
          amplitude: closestRaw ? closestRaw.amplitude : 0,
          manual: true // позначка що це вручну додано
        });
        state.selected.sort((a, b) => a.seconds - b.seconds);
        log(`Додано вручну мітку на ${toTimecode(finalSec)} `, 'success');
      }

      renderSelectedList();
      renderWaveform();
    });
  }

  // ── Вставити ──
  document.getElementById('mra-insert').addEventListener('click', insertTimecodes);

  // ── Мінімізувати та Закрити ──
  document.getElementById('mra-minimize').addEventListener('click', () => {
    const body = document.getElementById('mra-body');
    const btn = document.getElementById('mra-minimize');
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    btn.textContent = hidden ? '−' : '+';
  });

  document.getElementById('mra-close').addEventListener('click', () => {
    isPanelClosedByUser = true;
    panel.style.display = 'none';
  });

  // ── Перезавантаження ──
  document.getElementById('mra-reload').addEventListener('click', () => {
    log('♻️ Перезавантаження розширення...', 'info');
    state.cachedAudioBuffer = null;
    state.cachedAudioUrl = null;
    state.waveformData = null;
    state.silences = [];
    state.selected = [];
    isPanelClosedByUser = false;
    panel.remove();
    setTimeout(init, 300);
  });

  // ── Drag ──
  let isDragging = false, sx, sy, sl, st;
  document.getElementById('mra-header').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return; // Не тягнути за кнопки
    isDragging = true; sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect(); sl = r.left; st = r.top;
    panel.style.right = 'auto';
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    panel.style.left = (sl + e.clientX - sx) + 'px';
    panel.style.top = (st + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ─── UI ПАНЕЛЬ ────────────────────────────────────────────────────────────────


// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────
function init() {
  const observer = new MutationObserver(() => {
    const isAdBreaksPage =
      document.querySelector('ytve-ad-breaks-editor') ||
      document.querySelector('ytve-audio-waveform') ||
      window.location.href.includes('ad_breaks');

    if (isAdBreaksPage && !document.getElementById('mra-panel') && !isPanelClosedByUser) {
      createPanel();
      updateStatus(
        state.waveformUrl ? '✅ API перехоплено! Натисніть "Аналізувати".' : '⏳ Очікуємо завантаження вейвформи...',
        state.waveformUrl ? 'success' : 'info'
      );
    }
  });

  const startObserving = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else setTimeout(startObserving, 100);
  };
  startObserving();
}

// ── Слухач для кнопки розширення (щоб відновити панель) ──
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
      init(); // Якщо панелі немає, вона створиться через observer
    }
  }
});

init();
