'use strict';

// ─── КОНФІГ (defaults, overridden by UI) ─────────────────────────────────────
const CONFIG = {
  autoPlacement: true,     // НОВИЙ: автоматично розміщувати, скільки можна
  autoGap: true,
  minGapSec: 90,          // Мінімум 1.5 хв між рекламами
  maxGapSec: 120,         // Максимум 2 хв між рекламами
  shortVideoCutoff: 600,   // < 10 хв = "коротке"
  longVideoGapSec: 110,    // 110 сек для довгих відео
  shortVideoGapSec: 90,    // 90 сек для коротких
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

// ─── CLEANUP ─────────────────────────────────────────────────────────────────
let activeObservers = [];
let activeEventListeners = [];
let domCache = new WeakMap(); // Кеш для DOM елементів

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

  // Видаляємо всі event listeners
  activeEventListeners.forEach(({ element, event, handler, options }) => {
    try {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler, options);
      }
    } catch (e) { /* ignore */ }
  });
  activeEventListeners = [];

  // Очищаємо кеші
  domCache = new WeakMap();
  if (typeof domCacheWithTTL !== 'undefined') {
    domCacheWithTTL.clear();
  }

  log('♻️ Cleanup виконано', 'info');
}

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
    if (event.source === window && event.data && event.data.type === 'MRA_WAVEFORM_URL') {
      const url = event.data.url;

      // Базова валідація URL
      if (!url || typeof url !== 'string') {
        log('⚠️ Некоректний URL вейвформи', 'warn');
        return;
      }

      state.waveformUrl = url;
      log('Перехоплено URL вейвформи: ' + url.substring(0, 100) + '...', 'success');
      updateStatus('✅ API перехоплено! Натисніть "Аналізувати".', 'success');
    }
  } catch (error) {
    log('Помилка обробки повідомлення: ' + error.message, 'error');
  }
});

// ─── УТИЛІТИ ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Валідація числових значень
function isValidNumber(value) {
  return typeof value === 'number' && isFinite(value) && !isNaN(value) && value > 0;
}

// Валідація URL
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsedUrl = new URL(url);
    // Перевіряємо, що це HTTPS і домен YouTube
    return parsedUrl.protocol === 'https:' && parsedUrl.hostname.includes('youtube.com');
  } catch {
    return false;
  }
}

function waitForElement(selector, timeout = 10000, interval = 100) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let timerId = null;

    const check = () => {
      try {
        const el = typeof selector === 'function' ? selector() : document.querySelector(selector);
        if (el) {
          if (timerId) clearTimeout(timerId);
          return resolve(el);
        }

        const elapsed = Date.now() - t0;
        if (elapsed >= timeout) {
          if (timerId) clearTimeout(timerId);
          return reject(new Error(`Елемент не знайдено за ${timeout}мс`));
        }

        timerId = setTimeout(check, interval);
      } catch (error) {
        if (timerId) clearTimeout(timerId);
        reject(error);
      }
    };

    check();
  });
}

function log(msg, type = 'info') {
  const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' };
  console.log(`%c🎬 [MRA] ${msg}`, `color:${c[type] || c.info}`);
}

// Кеш для DOM елементів з TTL (time-to-live)
const domCacheWithTTL = {
  cache: new Map(),
  TTL: 5000, // 5 секунд кеш

  set(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  },

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Перевіряємо, чи не застарів кеш
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    // Перевіряємо, чи елемент все ще в DOM
    if (cached.value && !document.contains(cached.value)) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  },

  clear() {
    this.cache.clear();
  }
};

function findInsertAdBreakButton() {
  const cacheKey = 'insertAdBreakButton';
  const cached = domCacheWithTTL.get(cacheKey);
  if (cached) return cached;

  for (const sel of ['button[aria-label*="ad break"]', 'ytcp-button[aria-label*="ad break"]', '#insert-ad-break-button', 'ytcp-button.insert-ad-break-button', 'ytve-ad-breaks-editor button']) {
    const b = document.querySelector(sel);
    if (b) {
      domCacheWithTTL.set(cacheKey, b);
      return b;
    }
  }

  for (const btn of document.querySelectorAll('button, ytcp-button')) {
    const t = btn.textContent?.toLowerCase() || '';
    if (['insert ad break', 'вставити рекламне', 'вставить рекламу', 'ad-unterbrechung', 'insertar pausa'].some(v => t.includes(v))) {
      domCacheWithTTL.set(cacheKey, btn);
      return btn;
    }
  }

  return null;
}

function findTimestampInput() {
  // Не кешуємо input, бо він динамічно створюється для кожної вставки
  return document.querySelector('input.ytcp-media-timestamp-input') ||
    document.querySelector('input[type="text"][placeholder*="00:00"]') ||
    [...document.querySelectorAll('input[type="text"]')].find(el => el.className.includes('timestamp') || el.className.includes('time-input'));
}

function findConfirmButton() {
  // Не кешуємо confirm, бо він в динамічному діалозі
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
  try {
    // Валідація та обмеження значень
    const clamp = (val, min, max, defaultVal) => {
      const num = parseFloat(val);
      if (isNaN(num) || !isFinite(num)) return defaultVal;
      return Math.max(min, Math.min(max, num));
    };

    const clampInt = (val, min, max, defaultVal) => {
      const num = parseInt(val);
      if (isNaN(num) || !isFinite(num)) return defaultVal;
      return Math.max(min, Math.min(max, num));
    };

    CONFIG.minSilenceSec = clamp(getVal('mra-min-silence'), 0.5, 30, 1.5);
    CONFIG.maxSilenceSec = clamp(getVal('mra-max-silence'), 1, 60, 10.0);
    CONFIG.silenceThresholdPct = clamp(getVal('mra-threshold'), 1, 50, 15);

    CONFIG.focusStart = document.getElementById('mra-focus-start')?.checked ?? true;
    CONFIG.autoGap = document.getElementById('mra-auto-gap')?.checked ?? true;

    CONFIG.minGapSec = clamp(getVal('mra-min-gap'), 10, 7200, 180);
    CONFIG.shortVideoCutoff = clamp(getVal('mra-cutoff'), 1, 120, 10) * 60;
    CONFIG.longVideoGapSec = clamp(getVal('mra-long-gap'), 10, 3600, 180);
    CONFIG.shortVideoGapSec = clamp(getVal('mra-short-gap'), 10, 600, 60);

    // Логічна перевірка: maxSilence має бути >= minSilence
    if (CONFIG.maxSilenceSec < CONFIG.minSilenceSec) {
      CONFIG.maxSilenceSec = CONFIG.minSilenceSec;
    }

    log(`Налаштування: gap=${CONFIG.autoGap ? 'auto' : CONFIG.minGapSec + 's'}`, 'info');
  } catch (error) {
    log('⚠️ Помилка читання налаштувань, використовуємо defaults: ' + error.message, 'warn');
  }
}

// ─── АНАЛІЗ АУДІО ────────────────────────────────────────────────────────────

// Спроба визначити формат даних та витягти правильний масив амплітуд
function detectAndParseSamples(buffer, duration) {
  const totalBytes = buffer.byteLength;

  if (totalBytes === 0) {
    throw new Error('Порожній буфер даних вейвформи');
  }

  // YouTube зазвичай віддає Uint8Array (0-255 амплітудна огинаюча)
  const u8 = new Uint8Array(buffer);

  // Перевіримо, чи це натомість справжній Float32
  // Перевіряємо КОЖЕН 3-й семпл (а не кожен 10-й) для більшої точності
  const f32 = new Float32Array(buffer);
  let validFloats = 0;
  const sampleStep = 3; // Краща точність детектування
  const samplesToCheck = Math.floor(f32.length / sampleStep);

  for (let i = 0; i < f32.length; i += sampleStep) {
    const v = Math.abs(f32[i]);
    // Перевіряємо діапазон типових аудіо значень
    if (v > 0.0001 && v < 2.0) validFloats++;
  }

  // Підвищений поріг: якщо хоча б 10% чисел схожі на нормальний аудіо-флоат
  const validFloatRatio = validFloats / samplesToCheck;
  const isFloat32 = validFloatRatio > 0.10;

  console.log(`🔍 Детектування формату: перевірено ${samplesToCheck} семплів, валідних: ${validFloats} (${(validFloatRatio * 100).toFixed(1)}%)`);

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

  // Валідація URL
  if (!isValidUrl(state.waveformUrl)) {
    updateStatus('❌ Неприпустимий URL вейвформи!', 'error');
    log('Некоректний URL: ' + state.waveformUrl, 'error');
    return false;
  }

  readSettings();
  const video = document.querySelector('video');
  if (!video) {
    updateStatus('❌ Відео не знайдено на сторінці', 'error');
    return false;
  }

  const duration = video.duration;

  // Валідація тривалості відео
  if (!isValidNumber(duration)) {
    updateStatus('❌ Некоректна тривалість відео (NaN/Infinity/0)', 'error');
    log(`Некоректна тривалість: ${duration}. Можливо, відео ще завантажується.`, 'error');
    return false;
  }

  if (duration < 60) {
    updateStatus('⚠️ Відео занадто коротке (< 1 хв) для реклами', 'warn');
    return false;
  }

  let buffer;
  try {
    if (state.cachedAudioUrl === state.waveformUrl && state.cachedAudioBuffer) {
      updateStatus('⚡ Швидкий перерахунок (використовуємо кеш аудіо)...', 'info');
      buffer = state.cachedAudioBuffer;
    } else {
      updateStatus('⬇️ Завантажуємо вейвформу...', 'info');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 сек таймаут

      try {
        const response = await fetch(state.waveformUrl, {
          credentials: 'include',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP помилка: ${response.status} ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) === 0) {
          throw new Error('Порожній файл вейвформи');
        }

        buffer = await response.arrayBuffer();

        if (!buffer || buffer.byteLength === 0) {
          throw new Error('Отримано порожній буфер');
        }

        state.cachedAudioUrl = state.waveformUrl;
        state.cachedAudioBuffer = buffer;

        log(`Завантажено ${(buffer.byteLength / 1024).toFixed(1)} KB`, 'success');
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Таймаут завантаження вейвформи (>30с)');
        }
        throw fetchError;
      }
    }
  } catch (error) {
    updateStatus(`❌ Помилка завантаження: ${error.message}`, 'error');
    log('Деталі помилки: ' + error.stack, 'error');
    return false;
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
  // НОВА ЛОГІКА: не фіксована кількість, а ставимо скільки можна через gap
  const gap = CONFIG.autoGap
    ? (duration < CONFIG.shortVideoCutoff ? CONFIG.shortVideoGapSec : CONFIG.longVideoGapSec)
    : CONFIG.minGapSec;

  // ВИПРАВЛЕННЯ: Тепер поріг рахується через ПЕРЦЕНТИЛЬ, а не відсоток від максимуму чи середнього!
  // Оптимізовано: замість повного сортування використовуємо вибіркове сортування (QuickSelect)
  let maxAmp = -Infinity;
  for (let i = 0; i < totalBlocks; i++) {
    if (smoothed[i] > maxAmp) maxAmp = smoothed[i];
  }

  // Оптимізована функція для обчислення перцентилів без повного сортування
  function getPercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    if (percentile <= 0) return arr[0];
    if (percentile >= 1) return arr[arr.length - 1];

    // Для малих масивів (<1000) просто сортуємо
    if (arr.length < 1000) {
      const sorted = Array.from(arr).sort((a, b) => a - b);
      const idx = Math.floor(arr.length * percentile);
      return sorted[idx];
    }

    // Для великих масивів - вибіркове обчислення через bucket sort
    // Знаходимо мін/макс
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i];
      if (arr[i] > max) max = arr[i];
    }

    // Створюємо 1000 бакетів
    const bucketCount = 1000;
    const buckets = new Array(bucketCount).fill(0);
    const bucketSize = (max - min) / bucketCount;

    for (let i = 0; i < arr.length; i++) {
      const bucketIdx = Math.min(bucketCount - 1, Math.floor((arr[i] - min) / bucketSize));
      buckets[bucketIdx]++;
    }

    // Знаходимо перцентиль
    const targetCount = Math.floor(arr.length * percentile);
    let count = 0;
    for (let i = 0; i < bucketCount; i++) {
      count += buckets[i];
      if (count >= targetCount) {
        return min + (i + 0.5) * bucketSize; // Середина бакету
      }
    }
    return max;
  }

  const p10 = getPercentile(smoothed, 0.10);
  const p50 = getPercentile(smoothed, 0.50);

  // Перцентиль! Якщо користувач обрав 15% у налаштуваннях — беремо 15-й перцентиль.
  const percentileValue = Math.max(0.01, Math.min(0.99, CONFIG.silenceThresholdPct / 100));
  const GLOBAL_THRESHOLD = getPercentile(smoothed, percentileValue);

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

        // Ставимо мітку ПО ЦЕНТРУ паузи (найкраща позиція)
        const pauseCenter = (currentSilenceStart + (b - currentSilenceStart) / 2) * secPerBlock;
        const markSec = pauseCenter;

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
        const pauseCenter = (currentSilenceStart + (totalBlocks - currentSilenceStart) / 2) * secPerBlock;
        rawSilences.push({
          timecode: toTimecode(pauseCenter),
          seconds: +pauseCenter.toFixed(2),
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

  // НОВИЙ АЛГОРИТМ: Ставимо СКІЛЬКИ МОЖНА пауз з gap 1.5-2 хв
  const selectedCands = [];

  // Сортуємо паузи за якістю (тривалість / амплітуда)
  const sortedPauses = rawSilences.map(s => ({
    ...s,
    score: s.duration_sec / ((s.amplitude || 0) + 0.01)
  })).sort((a, b) => {
    // Пріоритет на початок відео, якщо focusStart
    if (CONFIG.focusStart) {
      // АГРЕСИВНИЙ буст для початку відео!
      // Перші 20% відео отримують 5x буст, далі поступово спадає
      const aPosition = a.seconds / duration; // 0 = початок, 1 = кінець
      const bPosition = b.seconds / duration;

      // Експоненційний буст: початок відео x5, середина x1.5, кінець x1
      const aBoost = 1 + (4 * Math.pow(1 - aPosition, 2)); // 5x на початку -> 1x в кінці
      const bBoost = 1 + (4 * Math.pow(1 - bPosition, 2));

      return (b.score * bBoost) - (a.score * aBoost);
    }
    return b.score - a.score;
  });

  // Жадібно вибираємо паузи з дотриманням gap
  for (const pause of sortedPauses) {
    // Якщо увімкнено focusStart - збільшуємо відстань між рекламами 
    // ближче до кінця відео. Так на початку вони будуть густо (наприклад, кожні 90с), 
    // а в кінці дуже рідко (кожні 3-4 хвилини).
    let currentGap = gap;
    if (CONFIG.focusStart) {
      const position = pause.seconds / duration; // 0..1
      // gap на початку = 1x, в кінці = 3.5x
      currentGap = gap * (1 + 2.5 * position);
    }

    // Перевіряємо, чи не надто близько до вже обраних
    const tooClose = selectedCands.some(sel => Math.abs(sel.seconds - pause.seconds) < currentGap);

    if (!tooClose) {
      selectedCands.push(pause);
    }
  }

  log(`Автоматично відібрано ${selectedCands.length} позицій (початковий gap ~${gap}с)`, 'info');

  state.selected = selectedCands;
  state.selected.sort((a, b) => a.seconds - b.seconds);

  console.group('%c🎬 [MRA] Відібрані реальні паузи', 'color:#06d6a0;font-weight:bold');
  state.selected.forEach((s, i) =>
    console.log(`  ${i + 1}. ${s.timecode}  (пауза: ${s.duration_sec}с, амп: ${s.amplitude})`)
  );
  if (state.selected.length === 0)
    console.log('  ⚠️ Не вдалось знайти підходящих пауз з таким інтервалом та параметрами!');
  console.groupEnd();

  log(`Відібрано ${state.selected.length} рекламних місць (gap=${gap}с)`, state.selected.length > 0 ? 'success' : 'warn');
  updateStatus(
    state.selected.length > 0
      ? `✅ ${state.selected.length} позицій знайдено через ~${gap}с`
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
// Кеш для офскрін canvas (оптимізація)
let offscreenCanvas = null;
let lastRenderSignature = null;

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
  const ctx = canvas.getContext('2d', { alpha: false }); // Оптимізація: вимикаємо alpha
  const w = canvas.width;
  const h = canvas.height;

  // Створюємо сигнатуру для перевірки, чи потрібно перерисовувати
  const signature = `${totalBlocks}_${threshold}_${state.selected.length}`;

  // Перевіряємо, чи змінились дані
  const needsRedraw = lastRenderSignature !== signature;

  if (needsRedraw) {
    // Створюємо офскрін canvas для фонового малюнку (вейвформа + поріг)
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = w;
      offscreenCanvas.height = h;
    }

    const offCtx = offscreenCanvas.getContext('2d', { alpha: false });

    // Очистити
    offCtx.fillStyle = '#111111';
    offCtx.fillRect(0, 0, w, h);

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
      offCtx.fillStyle = isQuiet ? '#222222' : '#888888';

      const barY = (h - barHeight) / 2;
      offCtx.fillRect(x, barY, 1, barHeight);
    }

    // Намалювати лінію порогу тиші
    const thresholdY = h - (threshold / maxAmp * h * 0.8);
    offCtx.strokeStyle = '#555555';
    offCtx.setLineDash([2, 5]);
    offCtx.beginPath();
    offCtx.moveTo(0, thresholdY);
    offCtx.lineTo(w, thresholdY);
    offCtx.stroke();
    offCtx.setLineDash([]);

    // Намалювати всі знайдені паузи
    offCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    state.silences.forEach(s => {
      const x = (s.seconds / duration) * w;
      offCtx.fillRect(x - 1, 0, 2, h);
    });
  }

  // Копіюємо офскрін canvas на видимий
  if (offscreenCanvas) {
    ctx.drawImage(offscreenCanvas, 0, 0);
  } else {
    // Fallback: якщо офскрін не створено, очищаємо
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);
  }

  // Намалювати відібрані паузи (яскраві ТОВСТІ маркери) - завжди поверх
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
    ctx.fillStyle = isManual ? '#ffffff' : 'rgba(201, 28, 28, 1)';
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

  // Оновлюємо сигнатуру
  lastRenderSignature = signature;

  log('Вейвформа оновлена' + (needsRedraw ? ' (повний рендер)' : ' (швидкий)'), 'info');
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
      // ВИПРАВЛЕННЯ: НЕ пересуваємо відео перед кліком, бо це створює 00:00:00
      // Натомість одразу клікаємо і швидко вводимо правильний таймкод

      const inputsBefore = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));

      const btn = findInsertAdBreakButton();
      if (!btn) throw new Error('Кнопка вставки не знайдена');
      btn.click();
      await sleep(CONFIG.actionDelay);

      // ВИПРАВЛЕННЯ 00:00:00 - покращений пошук з адаптивним таймаутом
      let input = null;
      const maxAttempts = 20; // Збільшено кількість спроб
      const baseDelay = 150; // Базова затримка

      for (let attempts = 0; attempts < maxAttempts; attempts++) {
        // Стратегія 1: Перевіряємо активний елемент (найшвидший спосіб)
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT' &&
          (activeEl.classList.contains('ytcp-media-timestamp-input') || activeEl.placeholder?.includes('00:00'))) {
          input = activeEl;
          log(`✅ Знайдено input через activeElement (спроба ${attempts + 1})`, 'success');
          break;
        }

        // Стратегія 2: Порівнюємо DOM до/після
        const inputsAfter = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));
        const newInputs = inputsAfter.filter(el =>
          !inputsBefore.includes(el) &&
          (el.classList.contains('ytcp-media-timestamp-input') || el.placeholder?.includes('00:00'))
        );

        if (newInputs.length > 0) {
          input = newInputs[0];
          log(`✅ Знайдено input через DOM diff (спроба ${attempts + 1})`, 'success');
          break;
        }

        // Стратегія 3: Шукаємо по видимості (останній input, який visible)
        if (attempts > 5) {
          const allTimeInputs = inputsAfter.filter(inp =>
            inp.offsetParent !== null && // Елемент видимий
            (inp.classList.contains('ytcp-media-timestamp-input') || inp.placeholder?.includes('00:00'))
          );
          if (allTimeInputs.length > 0) {
            input = allTimeInputs[allTimeInputs.length - 1];
            log(`⚠️ Використано fallback: останній видимий input (спроба ${attempts + 1})`, 'warn');
            break;
          }
        }

        // Адаптивна затримка: збільшуємо час очікування на повільних системах
        const delay = baseDelay + (attempts * 20);
        await sleep(delay);
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

        // Замінено застарілий execCommand на сучасний InputEvent
        try {
          // Спроба 1: Використання InputEvent (сучасний стандарт)
          const inputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: s.timecode
          });

          if (!input.dispatchEvent(inputEvent)) {
            // Якщо подія скасована, fallback на прямий setter
            throw new Error('beforeinput cancelled');
          }

          // Встановлюємо значення напряму
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(input, s.timecode);

          // Dispatch події input та change
          input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: s.timecode }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          // Fallback: якщо нові методи не працюють, використовуємо старий execCommand
          log('⚠️ Fallback на execCommand: ' + err.message, 'warn');
          if (document.execCommand) {
            document.execCommand('insertText', false, s.timecode);
          }
        }

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
#mra-analyze,#mra-insert,#mra-clear{width:100%;padding:10px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;transition:all .2s;margin-bottom:6px}
#mra-analyze{background:#c91c1c;color:#ffffff}
#mra-analyze:hover{background:#cc0000}
#mra-insert{background:#222;color:#ffffff;border:1px solid #c91c1c}
#mra-insert:hover:not(:disabled){background:#c91c1c}
#mra-insert:disabled{opacity:.4;cursor:not-allowed;border-color:#444;color:#777}
#mra-clear{background:#111;color:#bbb;border:1px solid #333;margin-bottom:8px}
#mra-clear:hover{background:#333;color:#fff;border-color:#555}
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
    <div style="color:#ffffff;font-size:11px;padding:4px 0;font-weight:600;opacity:0.9;text-align:center;">
      🫠 Авто-режим
      <div style="margin-top:4px;font-weight:400;opacity:0.8;">ставимо рекламу скільки можна через 1.5-2 хв</div>
    </div>
    <div style="margin-top:8px;">
      <div class="mtw">
        <label class="mt"><input type="checkbox" id="mra-focus-start" checked><span class="msl"></span></label>
        <span class="mtl" style="color:#ffffff;opacity:0.85;font-weight:500;">🎯 Більше реклами на початку (x5 буст)</span>
      </div>
    </div>
  </div>

  <div class="ms">
    <div class="mst">🔇 Де ставити рекламу</div>
    ${row('Мін. тривалість паузи (с):', stepper('mra-min-silence', 1.5, 0.1, 30, 0.1))}
    ${row('Поріг тиші (%):', stepper('mra-threshold', 15, 1, 50, 1), '% від максимуму (↓ = більше пауз)')}
  </div>

  <div class="ms">
    <div class="mst">↔️ Відстань між рекламами</div>
    <div class="mtw">
      <label class="mt"><input type="checkbox" id="mra-auto-gap" checked><span class="msl"></span></label>
      <span class="mtl">Авто-режим (за тривалістю відео)</span>
    </div>
    <div id="mra-auto-sect">
      ${row('Поріг "коротке" відео (хв):', stepper('mra-cutoff', 10, 1, 120, 1))}
      ${row('Gap короткого відео (с):', stepper('mra-short-gap', 90, 5, 600, 5))}
      ${row('Gap довгого відео (с):', stepper('mra-long-gap', 110, 5, 3600, 5))}
    </div>
    <div id="mra-manual-sect" style="display:none">
      ${row('Мін. відстань між рекламами (с):', stepper('mra-min-gap', 110, 5, 7200, 5))}
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
  <button id="mra-clear">🗑️ Очистити всі мітки на відео</button>
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

  // Лічильник реклам видалено - тепер автоматичний режим

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

  // ── Очистити всі мітки (з YouTube) ──
  document.getElementById('mra-clear').addEventListener('click', async () => {
    updateStatus('🗑️ Очищення міток...', 'info');

    // Шукаємо всі кнопки видалення в редакторі
    let deleteBtns = Array.from(document.querySelectorAll('ytve-ad-breaks-editor ytcp-icon-button, ytve-ad-breaks-editor button'))
      .filter(btn => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        const classes = (btn.className || '').toLowerCase();
        return label.includes('delete') || label.includes('видалити') || label.includes('удалить') ||
          id.includes('delete') || classes.includes('delete');
      })
      .filter(b => b.offsetParent !== null); // тільки видимі елементи

    if (deleteBtns.length === 0) {
      log('Не знайдено міток для видалення', 'warn');
      updateStatus('Не знайдено міток на відео', 'info');
      return;
    }

    log(`Видаляємо ${deleteBtns.length} міток з відео...`, 'info');
    for (const btn of deleteBtns) {
      btn.click();
      await sleep(150); // Невелика затримка для стабільності
    }

    updateStatus('✅ Всі мітки успішно видалено!', 'success');
  });

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
  // Спочатку очищаємо попередні ресурси
  cleanup();

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
    } else if (!isAdBreaksPage && document.getElementById('mra-panel')) {
      // Видаляємо панель, якщо користувач покинув сторінку ad_breaks
      const panel = document.getElementById('mra-panel');
      if (panel) panel.remove();
    }
  });

  // Додаємо observer до списку активних
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
