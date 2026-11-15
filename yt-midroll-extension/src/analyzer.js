// ─── АНАЛІЗ АУДІО ────────────────────────────────────────────────────────────

// ── Спрощений режим (за порадою): бот аналізує аудіо й ставить мітки.
//    Телеграм-звіти ПОВЕРНУТО — тепер ідуть через власний проксі (Apps Script),
//    токен бота більше не живе в клієнтському коді (див. proxy/README.md).
//    Пост-вставкове читання вердикту YouTube (пересування/чистка ⚠️) лишається
//    вимкненим свідомо — трималося на крихкому скрейпінгу чужого інтерфейсу. ──
var MRA_VERIFY_AFTER_INSERT = false; // читати вердикт YT і чистити/пересувати ⚠️ після вставки
var MRA_SEND_TG_REPORTS = true;      // слати телеграм-звіти (аналіз «мало пауз» / вставка / no_spots)

// Назва відео: document.title на сторінці редактора міток показує назву РОЗДІЛУ Studio
// («Способи заробляти»), тому спершу пробуємо елементи з реальною назвою відео.
function getVideoTitle() {
  const sources = [
    () => document.querySelector('#entity-name'),                  // верхня панель Studio на /video/*
    () => document.querySelector('ytcp-entity-name'),
    () => document.querySelector('ytcp-video-metadata-editor #title-textarea textarea'),
  ];
  for (const get of sources) {
    try {
      const el = get();
      const txt = el && (el.value || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length > 1) return txt.substring(0, 90);
    } catch (e) {}
  }
  const fromDoc = document.title.replace(/\s*[-–|]?\s*YouTube Studio\s*$/i, '').trim();
  // Назви розділів Studio — не назва відео, відсіюємо найвідоміші
  if (fromDoc && !/^(Способи заробляти|Монетизація|Відео|Контент|Аналітика|Редактор|Субтитри)$/i.test(fromDoc)) {
    return fromDoc.substring(0, 90);
  }
  return fromDoc || 'Невідоме відео';
}

// Спроба визначити формат даних та витягти правильний масив амплітуд
function detectAndParseSamples(buffer, duration) {
  const totalBytes = buffer.byteLength;

  if (totalBytes === 0) {
    throw new Error('Порожній буфер даних вейвформи');
  }

  const u8 = new Uint8Array(buffer);

  // Перевіримо, чи це Float32 (тільки якщо буфер вирівняний по 4 байти)
  let f32 = null;
  if (totalBytes % 4 === 0) {
    f32 = new Float32Array(buffer);

    let validFloats = 0;
    const sampleStep = 3;
    const samplesToCheck = Math.floor(f32.length / sampleStep);

    for (let i = 0; i < f32.length; i += sampleStep) {
      const v = Math.abs(f32[i]);
      if (v > 0.0001 && v < 2.0) validFloats++;
    }

    const validFloatRatio = validFloats / samplesToCheck;
    if (validFloatRatio <= 0.10) {
      f32 = null; // Не схоже на Float32
    }

    console.log(`🔍 Детектування формату: перевірено ${samplesToCheck} семплів, валідних: ${validFloats} (${(validFloatRatio * 100).toFixed(1)}%)`);
  }

  let samples, fmt, totalSamples;
  if (f32) {
    samples = f32;
    fmt = 'Float32';
    totalSamples = f32.length;
  } else {
    // Uint8 — перевіряємо PCM (центр ~128) чи Огинаюча (центр ~0)
    let sumU8 = 0;
    const checkCnt = Math.min(2000, totalBytes);
    for (let i = 0; i < checkCnt; i++) sumU8 += u8[Math.floor((i / checkCnt) * totalBytes)];
    const avgU8 = sumU8 / checkCnt;

    const isPCM128 = (avgU8 > 100 && avgU8 < 156);

    samples = new Float32Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      if (isPCM128) {
        samples[i] = (u8[i] - 128) / 128.0;
      } else {
        samples[i] = u8[i] / 255.0;
      }
    }
    fmt = isPCM128 ? 'Uint8 (PCM-128)' : 'Uint8 (Envelope)';
    totalSamples = totalBytes;
  }

  const secPerSample = duration / totalSamples;
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
  console.log(`📊 Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}, AvgAbs: ${avgAbs.toFixed(4)}`);
  console.log(`📈 Ненульових семплів: ${nonZeroPct}%`);

  // Міні-вейвформа (ASCII)
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

// Обчислення перцентилю без повного сортування
function getPercentile(arr, percentile) {
  const len = arr.length;
  if (len === 0) return 0;

  // Знаходимо мін/макс для граничних випадків та bucket sort
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < len; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }

  if (percentile <= 0) return min;
  if (percentile >= 1) return max;

  // Для малих масивів — просто сортуємо копію
  if (len < 1000) {
    const sorted = Array.from(arr).sort((a, b) => a - b);
    return sorted[Math.floor(len * percentile)];
  }

  // Для великих масивів — bucket sort
  const bucketCount = 1000;
  const buckets = new Array(bucketCount).fill(0);
  const range = max - min;
  if (range === 0) return min;
  const bucketSize = range / bucketCount;

  for (let i = 0; i < len; i++) {
    const bucketIdx = Math.min(bucketCount - 1, Math.floor((arr[i] - min) / bucketSize));
    buckets[bucketIdx]++;
  }

  const targetCount = Math.floor(len * percentile);
  let count = 0;
  for (let i = 0; i < bucketCount; i++) {
    count += buckets[i];
    if (count >= targetCount) {
      return min + (i + 0.5) * bucketSize;
    }
  }
  return max;
}

// Найкращий відрізок для запасної мітки у вікні [fromSec, toSec].
// Шукаємо не просто найтихіше місце, а "провал" звуку: тихо В МОМЕНТІ
// і помітно гучніше довкола (±4с) — так виглядає пауза між реченнями,
// і саме такі місця YouTube вважає природними паузами.
function findQuietestSpot(smoothed, secPerBlock, fromSec, toSec, spanSec) {
  const startB = Math.max(0, Math.floor(fromSec / secPerBlock));
  const endB = Math.min(smoothed.length, Math.ceil(toSec / secPerBlock));
  const spanB = Math.max(1, Math.round(spanSec / secPerBlock));
  if (endB - startB < spanB) return null;

  const padB = Math.max(1, Math.round(4 / secPerBlock));
  const pStart = Math.max(0, startB - padB);
  const pEnd = Math.min(smoothed.length, endB + padB);

  // Префіксні суми → середнє будь-якого відрізка за O(1)
  const prefix = new Float64Array(pEnd - pStart + 1);
  for (let i = pStart; i < pEnd; i++) {
    prefix[i - pStart + 1] = prefix[i - pStart] + smoothed[i];
  }
  const rangeAvg = (a, b) => {
    const aa = Math.max(pStart, a), bb = Math.min(pEnd, b);
    if (bb <= aa) return 0;
    return (prefix[bb - pStart] - prefix[aa - pStart]) / (bb - aa);
  };

  let bestScore = Infinity;
  let bestStart = startB;
  let bestAvg = Infinity;

  for (let s = startB; s <= endB - spanB; s++) {
    const spotAvg = rangeAvg(s, s + spanB);
    const surroundAvg = Math.max(rangeAvg(s - padB, s), rangeAvg(s + spanB, s + spanB + padB));
    // contrast < 1 → провал відносно оточення; чим глибший, тим краще
    const contrast = surroundAvg > 0 ? spotAvg / surroundAvg : 1;
    const score = spotAvg * (0.6 + 0.4 * Math.min(contrast, 1.25) / 1.25);

    if (score < bestScore) {
      bestScore = score;
      bestStart = s;
      bestAvg = spotAvg;
    }
  }

  // Максимальна згладжена амплітуда у відібраному відрізку (для формули якості пікового шуму)
  let bestMax = 0;
  for (let i = bestStart; i < bestStart + spanB && i < smoothed.length; i++) {
    if (smoothed[i] > bestMax) bestMax = smoothed[i];
  }

  // Контраст обраного відрізка з оточенням (±4с) — та сама метрика, що й у циклі вище,
  // але вже для фінально вибраного bestStart (потрібна формулі якості getPauseQuality)
  const surroundAvg = Math.max(rangeAvg(bestStart - padB, bestStart), rangeAvg(bestStart + spanB, bestStart + spanB + padB));

  return {
    centerSec: (bestStart + spanB / 2) * secPerBlock,
    avgAmp: bestAvg,
    maxAmp: bestMax,
    surroundAvg
  };
}

// ─── ГЛОБАЛЬНИЙ ПЛАНУВАЛЬНИК (DP) ────────────────────────────────────────────
// Жадібний прохід дивиться лише на поточне вікно; DP підбирає НАБІР міток,
// найкращий по всьому відео одразу. Чиста функція — без стану, легко тестується.
// cands: [{seconds, quality_score, duration_sec}] (відсортовані за часом, вже відфільтровані за якістю)
// opts: { duration, gap, idealGapAt(t), flex, flexWide, startOffset, endOffset, minS, segStart, segEnd, targetCount }
// Повертає масив індексів вибраних кандидатів (зростаючий) або null, якщо план не знайдено.
function dpPlanMarks(cands, opts) {
  let n = cands.length;
  if (!n) return null;

  const segStart = typeof opts.segStart === 'number' ? opts.segStart : 0;
  const segEnd = typeof opts.segEnd === 'number' ? opts.segEnd : opts.duration;
  const targetCount = typeof opts.targetCount === 'number' ? opts.targetCount : 0;
  const minTime = Math.max(opts.startOffset, segStart);
  const maxTime = Math.min(opts.duration - opts.endOffset, segEnd);

  // Фільтруємо кандидатів у межах [minTime, maxTime]
  const filtered = [];
  const origIdx = [];
  for (let i = 0; i < n; i++) {
    const t = cands[i].seconds;
    if (t >= minTime && t <= maxTime) {
      filtered.push(cands[i]);
      origIdx.push(i);
    }
  }
  n = filtered.length;
  if (!n) return null;

  // Якщо кандидатів забагато — залишаємо 800 найякісніших (зберігаємо маппінг)
  let workCands = filtered;
  let workOrigIdx = origIdx;
  if (n > 800) {
    // Сортуємо за якістю спадно, беремо 800, потім ресортуємо за часом
    const ranked = filtered.map((c, i) => ({ c, oi: origIdx[i] }))
      .sort((a, b) => b.c.quality_score - a.c.quality_score)
      .slice(0, 800)
      .sort((a, b) => a.c.seconds - b.c.seconds);
    workCands = ranked.map(r => r.c);
    workOrigIdx = ranked.map(r => r.oi);
    n = 800;
  }

  const g0 = opts.idealGapAt(segStart);

  // Максимальна кількість міток (оцінка зверху)
  const estK = Math.max(1, Math.ceil(
    Math.max(0, maxTime - minTime) /
    Math.max(opts.gap * (1 - opts.flex), 1)
  ) + 1);
  const K = targetCount > 0 ? Math.max(estK, targetCount + 2) : estK;

  // Захист від вибуху складності
  if (n * K > 600_000) return null;

  const maxIdealGap = opts.maxIdealGap || opts.gap * 1.4;
  const maxTransDist = maxIdealGap * (1 + opts.flexWide);
  const minTransDist = Math.max(3, (opts.minIdealGap || opts.gap * 0.5) * (1 - opts.flex));

  // Функції цінності та штрафу
  const value = (c) =>
    c.quality_score * 10 +
    Math.min(c.duration_sec || 0, opts.minS * 3) / opts.minS * 0.4;

  const pen = (d, g) =>
    Math.pow((d - g) / (g * opts.flex), 2) * 2;

  // Перевірка дозволеності першої мітки
  const allowedFirst = (j) => {
    const t = workCands[j].seconds;
    if (t < minTime) return false;
    if ((t - segStart) > g0 * (1 + opts.flexWide)) return false;
    return true;
  };

  // Перевірка дозволеності переходу i → j
  const allowedTrans = (i, j) => {
    const ti = workCands[i].seconds;
    const tj = workCands[j].seconds;
    const d = tj - ti;
    const g = opts.idealGapAt(ti);
    return d >= Math.max(3, g * (1 - opts.flex)) && d <= g * (1 + opts.flexWide);
  };

  // dp[k][i] = найкраща сума для k міток, що закінчуються на кандидаті i
  // Використовуємо плоский масив для економії пам'яті
  const NEG_INF = -1e18;
  const dp = new Float64Array(K * n).fill(NEG_INF);
  // parent[k][i] = індекс попередника (або -1 для першої мітки)
  const parent = new Int32Array(K * n).fill(-1);

  // k=1 (перші мітки, індекс 0-based = k-1 = 0)
  for (let j = 0; j < n; j++) {
    if (!allowedFirst(j)) continue;
    const d = workCands[j].seconds - segStart;
    dp[0 * n + j] = value(workCands[j]) - pen(d, g0);
  }

  // k >= 2
  for (let k = 1; k < K; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const dist = workCands[j].seconds - workCands[i].seconds;
        if (dist > maxTransDist) break;
        if (dist < minTransDist) continue;
        if (dp[(k - 1) * n + i] <= NEG_INF / 2) continue;
        if (!allowedTrans(i, j)) continue;
        const ti = workCands[i].seconds;
        const tj = workCands[j].seconds;
        const g = opts.idealGapAt(ti);
        const d = tj - ti;
        const score = dp[(k - 1) * n + i] + value(workCands[j]) - pen(d, g);
        if (score > dp[k * n + j]) {
          dp[k * n + j] = score;
          parent[k * n + j] = i;
        }
      }
    }
  }

  // Знаходимо глобальний максимум по всіх k, j
  let bestScore = NEG_INF;
  let bestK = -1;
  let bestJ = -1;
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < n; j++) {
      if (dp[k * n + j] <= NEG_INF / 2) continue;
      let finalScore = dp[k * n + j];
      if (targetCount > 0) {
        const count = k + 1;
        const over = Math.max(0, count - targetCount);
        const under = Math.max(0, targetCount - count);
        finalScore -= over * over * 8.0 + under * under * 2.5;
      }
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestK = k;
        bestJ = j;
      }
    }
  }

  if (bestK < 0 || bestScore <= NEG_INF / 2) return null;

  // Відновлення шляху
  const path = [];
  let curK = bestK;
  let curJ = bestJ;
  while (curK >= 0 && curJ >= 0) {
    path.push(workOrigIdx[curJ]);
    const prev = parent[curK * n + curJ];
    curK--;
    curJ = prev;
  }
  path.reverse();

  if (!path.length) return null;
  return path;
}


async function analyzeWaveform() {
  if (state.analyzing) {
    log('⚠️ Аналіз вже виконується, зачекайте...', 'warn');
    return false;
  }
  state.analyzing = true;

  try {
    return await _doAnalyze();
  } finally {
    state.analyzing = false;
  }
}

async function _doAnalyze() {
  if (!state.waveformUrl) {
    updateStatus('❌ URL вейвформи не знайдено. Перезавантажте сторінку.', 'error');
    return false;
  }

  if (!isValidUrl(state.waveformUrl)) {
    updateStatus('❌ Неприпустимий URL вейвформи!', 'error');
    log('Некоректний URL: ' + state.waveformUrl, 'error');
    return false;
  }

  readSettings();
  // Завантажуємо калібрування якості ДО обчислення qualityFloor (потрібне для getYtAcceptQuality)
  await loadQualityCalib();
  const video = document.querySelector('video');

  // Визначаємо тривалість з кількох джерел (фолбеки)
  let duration = null;

  // 1) <video>.duration — найточніше, якщо метадані завантажені
  if (video && isFinite(video.duration) && video.duration > 0) {
    duration = video.duration;
    log(`Тривалість з <video>: ${duration.toFixed(1)}с`, 'info');
  }

  // 2) Перехоплена тривалість з videoplayback URL (dur= параметр)
  if (!duration && state.interceptedDuration) {
    duration = state.interceptedDuration;
    log(`Тривалість з videoplayback URL: ${duration.toFixed(1)}с (фолбек)`, 'warn');
  }

  // 3) Якщо video є але ще не завантажився — чекаємо loadedmetadata
  if (!duration && video) {
    updateStatus('⏳ Очікуємо метадані відео...', 'info');
    const waited = await waitForVideoDuration(5000);
    if (waited) {
      duration = waited;
      log(`Тривалість після очікування: ${duration.toFixed(1)}с`, 'info');
    }
  }

  if (duration) {
    _cachedVideoDuration = duration;
  }

  if (!isValidNumber(duration)) {
    updateStatus('❌ Не вдалося визначити тривалість відео', 'error');
    log(`Тривалість недоступна. video.duration=${video ? video.duration : 'no element'}, intercepted=${state.interceptedDuration}`, 'error');
    return false;
  }

  if (duration < 480) {
    updateStatus('⚠️ Відео до 8 хв (Реклама недоступна)', 'warn');
    log('Відео менше 8 хвилин (YouTube забороняє mid-roll рекламу)', 'warn');

    // Очищаємо всі поточні дані/міточки, не пропускаємо далі
    state.waveformData = null;
    state.silences = [];
    state.selected = [];

    const uiList = document.getElementById('mra-list');
    const uiStats = document.getElementById('mra-stats');
    if (uiList) uiList.innerHTML = '';
    if (uiStats) uiStats.style.display = 'none';

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
      const timeoutId = setTimeout(() => controller.abort(), 30000);

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

  let parseResult;
  try {
    parseResult = detectAndParseSamples(buffer, duration);
  } catch (e) {
    updateStatus(`❌ Помилка формату аудіо: ${e.message}`, 'error');
    log('Деталі: ' + e.stack, 'error');
    return false;
  }
  const { samples, fmt, secPerSample, equivalentSampleRate, avgAbs } = parseResult;

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

  // ── Згладжування (ковзне вікно O(N)) ─────────
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

  // ── Авто-пілот: ціль за стандартом ТСН (~1 реклама / 2 хв) ──────────────────
  const idealAds = Math.max(1, Math.floor(duration / 120));
  const gap = CONFIG.autoGap ? duration / idealAds : CONFIG.minGapSec;

  // Експертні параметри (в авто-режимі — дефолти, у ручному — з повзунків)
  const startOffset = Math.max(0, CONFIG.startOffsetSec ?? 10);
  const endOffset = Math.max(0, CONFIG.endOffsetSec ?? 15);
  const flex = Math.min(0.9, Math.max(0.1, (CONFIG.rhythmFlexPct ?? 50) / 100));
  const flexWide = Math.min(0.95, flex * 1.6);

  // Локальна опора якості та адаптивного порогу: враховує локальну гучність мовлення
  const BIN_SEC = 5;
  const numBins = Math.max(1, Math.ceil(duration / BIN_SEC));
  const binSpeech = new Float64Array(numBins);

  for (let bin = 0; bin < numBins; bin++) {
    const startB = Math.floor((bin * BIN_SEC) / secPerBlock);
    const endB = Math.min(totalBlocks, Math.floor(((bin + 1) * BIN_SEC) / secPerBlock));
    const vals = [];
    for (let b = startB; b < endB; b++) {
      const v = smoothed[b];
      if (v > 0.0001) vals.push(v);
    }
    if (vals.length > 0) {
      vals.sort((a, b) => a - b);
      const idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.70));
      binSpeech[bin] = vals[idx];
    } else {
      binSpeech[bin] = 0;
    }
  }

  const prefSpeechSum = new Float64Array(numBins + 1);
  const prefSpeechValid = new Int32Array(numBins + 1);
  for (let i = 0; i < numBins; i++) {
    prefSpeechSum[i + 1] = prefSpeechSum[i] + binSpeech[i];
    prefSpeechValid[i + 1] = prefSpeechValid[i] + (binSpeech[i] > 0 ? 1 : 0);
  }

  const getLocalSpeechAt = (sec) => {
    const binIdx = Math.max(0, Math.min(numBins - 1, Math.floor((sec || 0) / BIN_SEC)));
    const halfWin = 9; // ±45с (9 * 5с)
    const fromBin = Math.max(0, binIdx - halfWin);
    const toBin = Math.min(numBins, binIdx + halfWin + 1);
    const validCnt = prefSpeechValid[toBin] - prefSpeechValid[fromBin];
    return validCnt > 0 ? (prefSpeechSum[toBin] - prefSpeechSum[fromBin]) / validCnt : avgAbs;
  };

  const getQualityRefAt = (sec) => {
    return Math.max(getLocalSpeechAt(sec) * 0.35, avgAbs * 0.08, 0.000001);
  };

  // Поточна межа прийняття YT (може бути самонавчена, або дефолт 0.70)
  const ytAccept = getYtAcceptQuality();

  // Авто-пілот: паузи слабші за межу прийняття YouTube навіть не ставимо.
  const qualityFloor = CONFIG.autoGap
    ? ytAccept
    : Math.min(0.9, Math.max(0, (CONFIG.minQualityPct ?? 0) / 100));

  // Підказки YouTube (перехоплені сніфером): позиції, які YT сам вважає природними.
  // Одиниці невідомі заздалегідь (мс чи с) — нормуємо за тривалістю відео.
  const ytHints = (() => {
    const raw = state.ytAdHintsRaw?.times;
    if (!Array.isArray(raw) || raw.length < 3) return [];
    const maxT = arrayMax(raw);
    const scale = maxT > duration * 2 ? 1 / 1000 : 1;
    const secs = raw.map(t => t * scale)
      .filter(s => isFinite(s) && s >= startOffset && s <= duration - endOffset)
      .sort((a, b) => a - b);
    // Якщо після нормування все одно за межами відео — це не таймкоди, ігноруємо
    if (!secs.length || secs[secs.length - 1] > duration) return [];
    log(`🎯 Бот використовує підказки YouTube: ${secs.length} природних позицій від самого YT`, 'success');
    return secs;
  })();
  state.ytHintsSec = ytHints; // для пересування червоних міток у verifyAndFixFlaggedBreaks

  const maxAmp = arrayMax(smoothed);
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const MIN_CONTRAST = 0.25;
  const applyContrastPenalty = (score, amp, surroundAvg, contrast) => {
    if (amp > 0.001 && surroundAvg > 0 && contrast < MIN_CONTRAST) {
      return clamp01(score * (0.45 + 0.55 * (contrast / MIN_CONTRAST)));
    }
    return score;
  };

  console.group('%c🔍 АНАЛІЗ', 'color:#ffd166;font-weight:bold');
  console.log(`  Max амплітуда:    ${maxAmp.toFixed(4)}`);
  console.log(`  Середня (avgAbs): ${avgAbs.toFixed(4)}`);
  console.log(`  Ціль: ${idealAds} міток (1/~2хв), ритм ~${Math.round(gap)}с (${CONFIG.autoGap ? 'авто-пілот' : 'вручну'})`);
  console.groupEnd();

  // Пошук пауз при заданій чутливості. Поріг = max(відсоток від середньої гучності, перцентиль)
  const runDetection = (minS, thresholdPct) => {
    const thresholdFromMean = avgAbs * (thresholdPct / 100);
    const thresholdFromPercentile = getPercentile(smoothed, Math.max(0.01, Math.min(0.99, thresholdPct / 100)));
    const GLOBAL_THRESHOLD = Math.max(thresholdFromMean, thresholdFromPercentile);

    const localThrByBin = new Float64Array(numBins);
    for (let bin = 0; bin < numBins; bin++) {
      const rawLocalThr = getLocalSpeechAt((bin + 0.5) * BIN_SEC) * (thresholdPct / 100);
      localThrByBin[bin] = Math.max(GLOBAL_THRESHOLD * 0.2, Math.min(GLOBAL_THRESHOLD * 2.2, rawLocalThr));
    }

    let currentSilenceStart = null;
    const rawSilences = [];

    const pushSilenceSegment = (startBlock, endBlock, minSilenceSec, silencesList) => {
      const silenceBlocks = endBlock - startBlock;
      const silenceSecs = silenceBlocks * secPerBlock;
      if (silenceSecs < minSilenceSec) return;

      let minAmpVal = Infinity;
      let maxAmpVal = 0;
      let sumAmpVal = 0;
      for (let j = startBlock; j < endBlock; j++) {
        const v = smoothed[j];
        if (v < minAmpVal) minAmpVal = v;
        if (v > maxAmpVal) maxAmpVal = v;
        sumAmpVal += v;
      }
      const avgAmpVal = sumAmpVal / silenceBlocks;

      const idealBlocks = Math.max(1, Math.round(minSilenceSec / secPerBlock));
      let bestStart = startBlock;
      let bestAvg = avgAmpVal;

      if (silenceBlocks > idealBlocks) {
        let rollingSum = 0;
        for (let j = startBlock; j < startBlock + idealBlocks; j++) rollingSum += smoothed[j];
        let unpaddedAvg = rollingSum / idealBlocks;
        let unpaddedStart = startBlock;

        for (let start = startBlock + 1; start <= endBlock - idealBlocks; start++) {
          rollingSum += smoothed[start + idealBlocks - 1] - smoothed[start - 1];
          const avg = rollingSum / idealBlocks;
          if (avg < unpaddedAvg) {
            unpaddedAvg = avg;
            unpaddedStart = start;
          }
        }

        bestStart = unpaddedStart;
        bestAvg = unpaddedAvg;

        // Захисний буфер (атака/затухання): до 0.4с праворуч перед атакою слова і до 0.25с ліворуч після затухання
        const rightPadBlocks = Math.min(Math.floor(silenceBlocks * 0.3), Math.round(0.4 / secPerBlock));
        const leftPadBlocks = Math.min(Math.floor(silenceBlocks * 0.2), Math.round(0.25 / secPerBlock));
        const paddedMinStart = startBlock + leftPadBlocks;
        const paddedMaxStart = endBlock - idealBlocks - rightPadBlocks;

        if (paddedMaxStart >= paddedMinStart) {
          const attackCheckB = Math.max(1, Math.round(0.35 / secPerBlock));
          let pRollingSum = 0;
          for (let j = paddedMinStart; j < paddedMinStart + idealBlocks; j++) pRollingSum += smoothed[j];
          let initialAvg = pRollingSum / idealBlocks;
          let initialRightMax = smoothed[Math.min(endBlock - 1, paddedMinStart + idealBlocks + Math.floor(attackCheckB / 2))];
          let bestScore = initialAvg + 0.15 * initialRightMax;
          let paddedStart = paddedMinStart;
          let paddedAvg = initialAvg;

          for (let start = paddedMinStart + 1; start <= paddedMaxStart; start++) {
            pRollingSum += smoothed[start + idealBlocks - 1] - smoothed[start - 1];
            const avg = pRollingSum / idealBlocks;
            const rightMax = smoothed[Math.min(endBlock - 1, start + idealBlocks + Math.floor(attackCheckB / 2))];
            const score = avg + 0.15 * rightMax;
            if (score < bestScore) {
              bestScore = score;
              paddedStart = start;
              paddedAvg = avg;
            }
          }

          // Віддаємо перевагу захищеному підвікну, якщо воно не більше ніж в 1.5 рази гірше за небуферизований мінімум
          if (paddedAvg <= unpaddedAvg * 1.5) {
            bestStart = paddedStart;
            bestAvg = paddedAvg;
          }
        }
      }

      const bestCenterBlock = bestStart + Math.min(silenceBlocks, idealBlocks) / 2;
      const pauseCenter = bestCenterBlock * secPerBlock;

      // Ігноруємо захисну зону на початку
      if (pauseCenter >= startOffset) {
        silencesList.push({
          timecode: toTimecode(pauseCenter),
          seconds: +pauseCenter.toFixed(2),
          start_sec: +(startBlock * secPerBlock).toFixed(2),
          end_sec: +(endBlock * secPerBlock).toFixed(2),
          duration_sec: +silenceSecs.toFixed(1),
          ideal_duration_sec: +Math.min(silenceSecs, minSilenceSec).toFixed(1),
          amplitude: +minAmpVal.toFixed(4),
          avg_amplitude: +avgAmpVal.toFixed(4),
          best_avg_amplitude: +bestAvg.toFixed(4),
          max_amplitude: +maxAmpVal.toFixed(4)
        });
      }
    };

    for (let b = 0; b < totalBlocks; b++) {
      const bin = Math.min(numBins - 1, Math.floor((b * secPerBlock) / BIN_SEC));
      const isQuiet = smoothed[b] < localThrByBin[bin];

      if (isQuiet && currentSilenceStart === null) {
        currentSilenceStart = b;
      } else if (!isQuiet && currentSilenceStart !== null) {
        pushSilenceSegment(currentSilenceStart, b, minS, rawSilences);
        currentSilenceStart = null;
      }
    }

    // Якщо відео закінчилось паузою
    if (currentSilenceStart !== null) {
      pushSilenceSegment(currentSilenceStart, totalBlocks, minS, rawSilences);
      currentSilenceStart = null;
    }

    // Стабільна базова мінімальна пауза для durationFit (не залежить від рівня ескалації)
    const baseMinSStable = CONFIG.minSilenceSec ?? 1.5;

    const getPauseQuality = (p) => {
      // Використовуємо локальну опору якості на позиції паузи (±45с активного мовлення)
      const qRef = getQualityRefAt(p.seconds);
      const bestAvg = Number(p.best_avg_amplitude ?? p.avg_amplitude ?? p.amplitude ?? qRef);
      const avgAmpVal = Number(p.avg_amplitude ?? bestAvg);
      const peakAmp = Number(p.max_amplitude ?? bestAvg);
      const durationSec = Number(p.duration_sec) || 0;

      const coreQuiet = clamp01((qRef - bestAvg) / qRef);
      const avgQuiet = clamp01((qRef - avgAmpVal) / qRef);
      const peakClean = clamp01((qRef - peakAmp) / qRef);
      // durationFit прив'язаний до стабільного baseMinSStable, а не до поточного minS ескалації
      const durationFit = clamp01(durationSec / Math.max(baseMinSStable * 2, baseMinSStable + 0.001));

      // contrast: наскільки пауза є ПРОВАЛОМ гучності відносно оточення (±4с), а не просто
      // тихим місцем усередині загалом тихого фрагмента (фонова музика/амбіент). Чисто
      // амплітудні терми вище цього не бачать — тихо-в-тихому і справжня пауза між реченнями
      // виглядають однаково тихими. YouTube вважає природною паузою саме провал між
      // гучнішими фрагментами, тому «тихо в тихому» тут карається (contrast → 0).
      const padB = Math.max(1, Math.round(4 / secPerBlock));
      const sB = Math.max(0, Math.floor((p.start_sec ?? (p.seconds - durationSec / 2)) / secPerBlock));
      const eB = Math.min(totalBlocks, Math.ceil((p.end_sec ?? (p.seconds + durationSec / 2)) / secPerBlock));
      const avgOf = (from, to) => {
        if (to <= from) return -1;
        let sum = 0;
        for (let i = from; i < to; i++) sum += smoothed[i];
        return sum / (to - from);
      };
      const beforeAvg = avgOf(Math.max(0, sB - padB), sB);
      const afterAvg = avgOf(eB, Math.min(totalBlocks, eB + padB));
      const surroundAvg = Math.max(beforeAvg, afterAvg);
      const contrast = surroundAvg > 0 ? clamp01(1 - bestAvg / surroundAvg) : 0;
      p.contrast = +contrast.toFixed(3);

      const baseScore = clamp01(coreQuiet * 0.45 + avgQuiet * 0.15 + peakClean * 0.15 + contrast * 0.20 + durationFit * 0.05);
      return applyContrastPenalty(baseScore, bestAvg, surroundAvg, contrast);
    };

    rawSilences.forEach(p => {
      const quality = getPauseQuality(p);
      p.quality_score = +quality.toFixed(3);
      p.quality_label = quality >= 0.78 ? 'люкс' : (quality >= ytAccept ? 'добра' : 'ок');
    });

    return { rawSilences, threshold: GLOBAL_THRESHOLD, localThrByBin, binSec: BIN_SEC };
  };

  // ── Зчитуємо мітки, що вже стоять на відео (до запуску планувальника).
  //    Аналіз НІЧОГО не змінює на відео.
  //    Ручні мітки — лише інформаційно (вони будуть знесені при вставці, або збережені при Smart Top-Up).
  //    Авто-мітки YT запам'ятовуємо як 100%-якорі: при вставці чекбокс знімається
  //    і вони зникають, тому включаємо їх у план заздалегідь. ──
  state.existingMarks = readExistingAdBreaks();
  state.ytAutoMarks = readYtAutoMarks();
  if (state.ytAutoMarks.length > 0) {
    log(`📌 YouTube вже має ${state.ytAutoMarks.length} авто-міток — беремо їх у план як 100% якорі`, 'info');
  }
  if (state.existingMarks.length > 0) {
    if (CONFIG.preserveManualMarks) {
      log(`📌 На відео вже стоїть ${state.existingMarks.length} ручних міток (режим дозаповнення — зберігаємо)`, 'info');
    } else {
      log(`📌 На відео вже стоїть ${state.existingMarks.length} ручних міток (інформаційно — при вставці будуть знесені)`, 'info');
    }
  }

  // Розстановка міток за ритмом gap по знайдених паузах
  const runSelection = (rawSilences, minS) => {
    // ── Якорі: якщо увімкнено збереження ручних міток (Smart Top-Up),
    //    беремо їх як якорі й не ставимо рекламу впритул до них ──
    const anchors = (CONFIG.preserveManualMarks && Array.isArray(state.existingMarks) && state.existingMarks.length > 0)
      ? state.existingMarks
      : [];
    const ytAutoList = state.ytAutoMarks || [];
    const autoMinSpace = Math.max(15, gap * 0.35);
    const nearAnchor = (sec) => anchors.some(m => Math.abs(m.seconds - sec) < (anchors.length ? autoMinSpace : 3));
    const nearYtAuto = (sec) => ytAutoList.some(m => Math.abs(m.seconds - sec) < autoMinSpace);
    const outroGuardStart = duration >= 1800 ? Math.max(startOffset, duration - Math.max(endOffset, 60)) : Infinity;

    const selectedCands = [];
    const usedPauses = new Set();
    const usedHints = new Set();
    const usedAuto = new Set();
    const sortedSilences = [...rawSilences].sort((a, b) => a.seconds - b.seconds);

    // ── Глобальний план (DP): найкращий набір міток по всьому відео ──
    const idealGapAt = (t) => {
      if (!CONFIG.focusStart) return gap;
      const g = gap * (0.5 + (t / duration) * 0.5);
      return CONFIG.autoGap ? g * 1.386 : g;
    };
    const maxIdealGap = CONFIG.focusStart && CONFIG.autoGap ? gap * 1.386 : gap;
    const minIdealGap = CONFIG.focusStart ? gap * 0.5 * (CONFIG.autoGap ? 1.386 : 1) : gap;

    let preferred = [];
    try {
      const dpCands = [];
      // Авто-мітки YT — найвищі кандидати (0.98), беремо їх у план як якорі
      for (const am of ytAutoList) {
        if (am.seconds >= startOffset && am.seconds <= duration - endOffset) {
          dpCands.push({
            seconds: am.seconds,
            timecode: am.timecode,
            quality_score: 0.98,
            duration_sec: 0,
            _ytAuto: true
          });
        }
      }
      // Підказки YT (0.95): якщо поруч немає авто-мітки YT
      for (const hs of ytHints) {
        if (hs >= startOffset && hs <= duration - endOffset) {
          if (!nearYtAuto(hs)) {
            dpCands.push({ seconds: hs, quality_score: 0.95, duration_sec: 0, _hint: true });
          }
        }
      }
      // Власні природні паузи: не ставимо ближче ніж autoMinSpace до авто-мітки YT
      for (const p of sortedSilences) {
        if (Number(p.quality_score ?? 0) < qualityFloor) continue;
        if (nearYtAuto(p.seconds)) continue;
        if (dpCands.some(c => c._hint && Math.abs(c.seconds - p.seconds) < 1.5)) continue;
        dpCands.push({
          seconds: p.seconds,
          quality_score: Number(p.quality_score ?? 0),
          duration_sec: Number(p.duration_sec) || 0,
          _src: p
        });
      }
      dpCands.sort((a, b) => a.seconds - b.seconds);

      if (!anchors.length) {
        const planIdx = dpPlanMarks(dpCands, {
          duration,
          gap,
          idealGapAt,
          maxIdealGap,
          minIdealGap,
          flex,
          flexWide,
          startOffset,
          endOffset,
          minS,
          targetCount: idealAds,
          segStart: 0,
          segEnd: duration
        });
        if (planIdx && planIdx.length) {
          preferred = planIdx.map(i => dpCands[i]);
          log(`🧠 Глобальний план (DP): ${preferred.length} позицій (підказок YT: ${preferred.filter(c => c._hint).length}, авто YT: ${preferred.filter(c => c._ytAuto).length})`, 'info');
        }
      } else {
        // Smart Top-Up: запускаємо DP окремо для кожного великого проміжку між якорями
        const sortedAnchorTimes = anchors.map(a => a.seconds).sort((a, b) => a - b);
        const boundaries = [0, ...sortedAnchorTimes, duration];
        const minSpace = Math.max(15, gap * 0.35);

        for (let bIdx = 0; bIdx < boundaries.length - 1; bIdx++) {
          const aLeft = boundaries[bIdx];
          const aRight = boundaries[bIdx + 1];
          const span = aRight - aLeft;
          if (span < gap * 1.6) continue;

          const segStart = aLeft;
          const segEnd = aRight;
          const segMinT = Math.max(startOffset, aLeft + minSpace);
          const segMaxT = Math.min(duration - endOffset, aRight - minSpace);
          if (segMaxT <= segMinT) continue;

          const segCands = dpCands.filter(c => c.seconds >= segMinT && c.seconds <= segMaxT);
          if (!segCands.length) continue;

          const rawTarget = Math.round(span / gap) - (aLeft > 0 && aRight < duration ? 1 : 0);
          const targetCount = Math.max(1, rawTarget);

          const planIdx = dpPlanMarks(segCands, {
            duration,
            gap,
            idealGapAt,
            maxIdealGap,
            minIdealGap,
            flex,
            flexWide,
            startOffset,
            endOffset,
            minS,
            targetCount,
            segStart,
            segEnd
          });
          if (planIdx && planIdx.length) {
            for (const i of planIdx) {
              preferred.push(segCands[i]);
            }
          }
        }
        if (preferred.length) {
          preferred.sort((a, b) => a.seconds - b.seconds);
          log(`🧠 Smart Top-Up DP: ${preferred.length} позицій у проміжках між ручними мітками`, 'info');
        }
      }
    } catch (e) {
      console.warn('[TSN ANALYZER] DP-планувальник впав, працює жадібний прохід:', e);
      preferred = [];
    }

    let playhead = 0;

    while (true) {
      let currentGap = gap;
      if (CONFIG.focusStart) {
        const pos = playhead / duration;
        currentGap = gap * (0.5 + pos * 0.5);
        if (CONFIG.autoGap) currentGap *= 1.386;
      }

      let target = playhead + currentGap;
      if (target > duration - endOffset) break;

      // Smart Top-Up: якщо в поточному слоті є збережена ручна мітка — стрибаємо на неї
      if (anchors.length > 0) {
        const matchingAnchors = anchors
          .filter(m => m.seconds > playhead + 3 && m.seconds <= target + currentGap * 0.25)
          .sort((a, b) => a.seconds - b.seconds);
        if (matchingAnchors.length > 0) {
          playhead = matchingAnchors[0].seconds;
          continue;
        }
      }

      // Вікно пошуку ±flex від gap — при 50% вікна стикуються без мертвих зон
      const windowStart = target - (currentGap * flex);
      const windowEnd = target + (currentGap * flex);

      let bestPause = null;
      let bestScore = -Infinity;

      // Пріоритет №0: позиція з глобального плану (DP) у поточному вікні —
      // план уже зважив усе відео цілком, локальний вибір його не переб'є
      if (preferred.length) {
        let bestPref = null, bestPrefDist = Infinity;
        for (const c of preferred) {
          if (c._used || c.seconds < windowStart || c.seconds > windowEnd) continue;
          if (nearAnchor(c.seconds)) continue;
          const d = Math.abs(c.seconds - target);
          if (d < bestPrefDist) { bestPrefDist = d; bestPref = c; }
        }
        // Якщо в [windowStart, windowEnd] немає — шукаємо в повному переході DP [playhead + minTrans, playhead + maxTrans]
        if (!bestPref) {
          const dpRangeStart = playhead + Math.max(3, currentGap * (1 - flex));
          const dpRangeEnd = playhead + currentGap * (1 + flexWide);
          for (const c of preferred) {
            if (c._used || c.seconds < dpRangeStart || c.seconds > dpRangeEnd) continue;
            if (nearAnchor(c.seconds)) continue;
            bestPref = c;
            break; // беремо першу найближчу в дозволеному DP інтервалі
          }
        }
        if (bestPref) {
          bestPref._used = true;
          if (bestPref._ytAuto) {
            usedAuto.add(bestPref.seconds);
            bestPause = {
              timecode: bestPref.timecode || toTimecode(bestPref.seconds),
              seconds: +bestPref.seconds.toFixed(2),
              duration_sec: null,
              ideal_duration_sec: null,
              amplitude: null,
              avg_amplitude: null,
              best_avg_amplitude: null,
              max_amplitude: null,
              quality_score: 1.0,
              quality_label: 'YT авто',
              fromYt: true,
              _ytAuto: true
            };
          } else if (bestPref._hint) {
            usedHints.add(bestPref.seconds);
            bestPause = {
              timecode: toTimecode(bestPref.seconds),
              seconds: +bestPref.seconds.toFixed(2),
              duration_sec: 0,
              ideal_duration_sec: 0,
              amplitude: 0,
              avg_amplitude: 0,
              best_avg_amplitude: 0,
              max_amplitude: 0,
              quality_score: 0.95,
              quality_label: 'підказка YT',
              ytHint: true
            };
          } else if (bestPref._src && !usedPauses.has(bestPref._src)) {
            usedPauses.add(bestPref._src);
            bestPause = bestPref._src;
          }
        }
      }
      // Запам'ятовуємо, чи мітка прийшла з DP-плану (тоді апгрейд не потрібен)
      const fromPlan = !!bestPause;

      // Пріоритет №0.5: авто-мітка YouTube у вікні (якщо не вибрана через DP)
      if (!bestPause && ytAutoList.length) {
        let bestAuto = null, bestAutoDist = Infinity;
        for (const am of ytAutoList) {
          if (am.seconds < windowStart || am.seconds > windowEnd || usedAuto.has(am.seconds)) continue;
          if (nearAnchor(am.seconds)) continue;
          const d = Math.abs(am.seconds - target);
          if (d < bestAutoDist) { bestAutoDist = d; bestAuto = am; }
        }
        if (bestAuto) {
          usedAuto.add(bestAuto.seconds);
          bestPause = {
            timecode: bestAuto.timecode || toTimecode(bestAuto.seconds),
            seconds: +bestAuto.seconds.toFixed(2),
            duration_sec: null,
            ideal_duration_sec: null,
            amplitude: null,
            avg_amplitude: null,
            best_avg_amplitude: null,
            max_amplitude: null,
            quality_score: 1.0,
            quality_label: 'YT авто',
            fromYt: true,
            _ytAuto: true
          };
        }
      }

      // Пріоритет №1: підказка YouTube у вікні — це місце YT гарантовано вважає
      // природним і не позначить червоним
      if (!bestPause && ytHints.length) {
        let bestHint = null, bestHintDist = Infinity;
        for (const hs of ytHints) {
          if (hs < windowStart || hs > windowEnd || usedHints.has(hs)) continue;
          if (nearAnchor(hs) || nearYtAuto(hs)) continue;
          const d = Math.abs(hs - target);
          if (d < bestHintDist) { bestHintDist = d; bestHint = hs; }
        }
        if (bestHint !== null) {
          usedHints.add(bestHint);
          bestPause = {
            timecode: toTimecode(bestHint),
            seconds: +bestHint.toFixed(2),
            duration_sec: 0,
            ideal_duration_sec: 0,
            amplitude: 0,
            avg_amplitude: 0,
            best_avg_amplitude: 0,
            max_amplitude: 0,
            quality_score: 0.95,
            quality_label: 'підказка YT',
            ytHint: true
          };
        }
      }

      // Скоринг власних пауз — лише якщо підказки YT у вікні немає
      for (const p of (bestPause ? [] : sortedSilences)) {
        if (usedPauses.has(p)) continue;

        // Якщо пауза потрапляє у "вікно"
        if (p.seconds >= windowStart && p.seconds <= windowEnd) {
          // Фільтр мінімальної якості (експертний режим)
          const qualityScore = Number(p.quality_score ?? 0);
          if (qualityScore < qualityFloor) continue;
          if (nearAnchor(p.seconds) || nearYtAuto(p.seconds)) continue;

          const distance = Math.abs(p.seconds - target);
          const distancePenalty = Math.pow(distance / (currentGap * flex), 2);

          // Оцінюємо якість: найтихіші паузи вище, але без сильного відхилення від потрібного інтервалу.
          const durationBonus = Math.min(Number(p.duration_sec) || 0, minS * 3) / minS;
          const score = qualityScore * 10 + durationBonus * 0.4 - distancePenalty * 2;

          if (score > bestScore) {
            bestScore = score;
            bestPause = p;
          }
        }
      }

      // "Тільки ідеальні": якщо найкраща пауза у вікні слабша за межу прийняття YouTube,
      // шукаємо трохи ширше паузу рівня «добра/люкс» — невелике зміщення ритму
      // краще за рекламу в сумнівній напівпаузі.
      // Якщо мітка вже вибрана DP-планом — апгрейд не потрібен, план вже зважив усе відео.
      const upgradeFloor = Math.max(ytAccept, qualityFloor);
      if (!fromPlan && bestPause && !bestPause._ytAuto && Number(bestPause.quality_score ?? 0) < upgradeFloor) {
        const wideStart = Math.max(playhead + currentGap * 0.4, startOffset);
        const wideEnd = Math.min(target + currentGap * flexWide, duration - endOffset);
        let upgrade = null;
        let upgradeScore = -Infinity;

        for (const p of sortedSilences) {
          if (usedPauses.has(p) || p.seconds < wideStart || p.seconds > wideEnd) continue;
          const q = Number(p.quality_score ?? 0);
          if (q < upgradeFloor) continue;
          if (nearAnchor(p.seconds) || nearYtAuto(p.seconds)) continue;

          const distance = Math.abs(p.seconds - target);
          const distancePenalty = Math.pow(distance / Math.max(currentGap * flexWide, 1), 2);
          const score = q * 10 - distancePenalty * 2;
          if (score > upgradeScore) {
            upgradeScore = score;
            upgrade = p;
          }
        }

        if (upgrade) {
          log(`✨ Апгрейд паузи: ${bestPause.timecode} (${Math.round((bestPause.quality_score ?? 0) * 100)}%) → ${upgrade.timecode} (${Math.round((upgrade.quality_score ?? 0) * 100)}%)`, 'info');
          bestPause = upgrade;
        }
      }

      // Fallback: ширше вікно вперед
      if (!bestPause) {
        const looseEnd = target + currentGap * flexWide;
        let fallbackScore = -Infinity;

        for (const p of sortedSilences) {
          if (usedPauses.has(p) || p.seconds < windowStart || p.seconds > looseEnd) continue;
          if (Number(p.quality_score ?? 0) < qualityFloor) continue;
          if (nearAnchor(p.seconds) || nearYtAuto(p.seconds)) continue;

          const distance = Math.abs(p.seconds - target);
          const distancePenalty = Math.pow(distance / Math.max(currentGap * flexWide, 1), 2);
          const score = Number(p.quality_score ?? 0) * 10 - distancePenalty;

          if (score > fallbackScore) {
            fallbackScore = score;
            bestPause = p;
          }
        }
      }

      // Режим "Без пропусків": пауз у вікні немає → запасна мітка в найтихішому місці вікна.
      // Ритм реклами (стандарт ~1/2хв) тримається навіть без чистої тиші.
      if (!bestPause && CONFIG.guaranteeStandard) {
        if (duration >= 1800 && windowStart >= outroGuardStart) {
          log(`🛡️ Outro Guard: пропуск запасної мітки у вікні аутро ${toTimecode(windowStart)}–${toTimecode(windowEnd)} (останні 60с)`, 'info');
        } else {
          const spot = findQuietestSpot(
            smoothed, secPerBlock,
            Math.max(windowStart, startOffset),
            Math.min(windowEnd, duration - endOffset),
            Math.max(0.8, Math.min(minS, 2))
          );
          if (duration >= 1800 && spot && spot.centerSec >= outroGuardStart) {
            log(`🛡️ Outro Guard: знайдена позиція запасної ${toTimecode(spot.centerSec)} потрапляє в останні 60с аутро — пропуск`, 'info');
          } else {
            const farEnough = spot &&
              !selectedCands.some(c => Math.abs(c.seconds - spot.centerSec) < 3) &&
              !nearAnchor(spot.centerSec) &&
              !nearYtAuto(spot.centerSec);
            if (farEnough) {
              // Якість запасної — ТІЄЮ Ж формулою, що й природні паузи (одна лінійка):
              // ядро тиші, середня (reuse coreQuiet — spot має лише одне avg), піки, контраст
              // з оточенням, тривалість. Інакше запасні виглядали б кращими за природні через
              // простішу формулу.
              const spotLen = Math.max(0.8, Math.min(minS, 2)); // та сама довжина, що передана у findQuietestSpot
              const qRef = getQualityRefAt(spot.centerSec);
              const coreQuiet = clamp01((qRef - spot.avgAmp) / qRef);
              const peakClean = clamp01((qRef - (spot.maxAmp ?? spot.avgAmp)) / qRef);
              const durationFit = clamp01(spotLen / Math.max((CONFIG.minSilenceSec ?? 1.5) * 2, 0.001));
              // avgQuiet: spot має лише одне avg, тому reuse coreQuiet для 0.15-терму середньої
              const contrast = spot.surroundAvg > 0 ? clamp01(1 - spot.avgAmp / spot.surroundAvg) : 0;
              const rawScore = clamp01(coreQuiet * 0.45 + coreQuiet * 0.15 + peakClean * 0.15 + contrast * 0.20 + durationFit * 0.05);
              const relQuiet = applyContrastPenalty(rawScore, spot.avgAmp, spot.surroundAvg, contrast);

              // «Без пропусків» тепер не означає «за будь-яку ціну»: якщо навіть найтихіше
              // місце вікна занадто гучне (тихо-в-тихому без реального провалу відносно
              // оточення), YouTube таку мітку позначає попередженням «реклама навряд чи
              // показуватиметься». Такий слот краще чесно пропустити (playhead коректно
              // просунеться далі нижче), ніж заздалегідь ставити «биту» мітку.
              const fallbackFloor = Math.max(0, Math.min(0.9, (CONFIG.fallbackMinQualityPct ?? 35) / 100));
              if (relQuiet < fallbackFloor) {
                log(`🛟 Найтихіше місце вікна ${toTimecode(windowStart)}–${toTimecode(windowEnd)} занадто гучне (${Math.round(relQuiet * 100)}% < поріг ${Math.round(fallbackFloor * 100)}%) — запасну не ставлю, слот пропускаю`, 'warn');
              } else {
                bestPause = {
                  timecode: toTimecode(spot.centerSec),
                  seconds: +spot.centerSec.toFixed(2),
                  duration_sec: 0,
                  ideal_duration_sec: 0,
                  amplitude: +spot.avgAmp.toFixed(4),
                  avg_amplitude: +spot.avgAmp.toFixed(4),
                  best_avg_amplitude: +spot.avgAmp.toFixed(4),
                  max_amplitude: +(spot.maxAmp ?? spot.avgAmp).toFixed(4),
                  contrast: +contrast.toFixed(3),
                  quality_score: +relQuiet.toFixed(3),
                  quality_label: 'запасна',
                  fallbackSpot: true
                };
                log(`🛟 Пауз немає у вікні ${toTimecode(windowStart)}–${toTimecode(windowEnd)} → запасна в найтихішому місці: ${bestPause.timecode} (${Math.round(relQuiet * 100)}%)`, 'warn');
              }
            }
          }
        }
      }

      // Якщо НІЧОГО не знайдено — просуваємо playhead рівно на currentGap
      // ⚠️ КРИТИЧНО: playhead = target (а не target + 0.5*gap!)
      // Це гарантує що наступне вікно ПОЧИНАЄТЬСЯ там де ЗАКІНЧИЛОСЬ поточне
      // і між вікнами НЕМАЄ мертвих зон куди можуть падати паузи!
      if (!bestPause) {
        playhead = target; // = playhead + currentGap → вікна стикуються ідеально
        if (playhead > duration - endOffset) break;
        log(`⚠️ Не знайдено паузи у вікні ${toTimecode(windowStart)}–${toTimecode(windowEnd)}, слот пропущено`, 'warn');
        continue;
      }

      // Додаємо відібрану паузу (тільки реальна тиша)
      if (bestPause.seconds < duration - endOffset) {
        selectedCands.push(bestPause);
        usedPauses.add(bestPause);
        playhead = bestPause.seconds;
      } else {
        break;
      }
    }

    return selectedCands;
  };


  // ── Авто-ескалація чутливості: якщо природних пауз мало для цілі —
  //    бот сам послаблює критерії (вищий поріг, коротша мін. пауза) ──
  const baseMinS = CONFIG.minSilenceSec ?? 1.5;
  const baseThr = CONFIG.silenceThresholdPct ?? 15;
  const rawLadder = CONFIG.autoGap
    ? [
      { minS: baseMinS, thr: baseThr },
      { minS: Math.min(baseMinS, 1.2), thr: Math.min(baseThr + 5, 45) },
      { minS: Math.min(baseMinS, 1.0), thr: Math.min(baseThr + 10, 45) },
      { minS: Math.min(baseMinS, 0.8), thr: Math.min(baseThr + 15, 45) },
    ]
    : [{ minS: baseMinS, thr: baseThr }];

  const ladder = [];
  const seenLadder = new Set();
  for (const step of rawLadder) {
    const key = `${step.minS}_${step.thr}`;
    if (!seenLadder.has(key)) {
      seenLadder.add(key);
      ladder.push(step);
    }
  }

  let lastSelectionKey = null;
  let lastCands = null;
  let best = null;
  for (let li = 0; li < ladder.length; li++) {
    const lv = ladder[li];
    const det = runDetection(lv.minS, lv.thr);
    const rawSig = det.rawSilences.map(p => `${p.seconds}:${p.duration_sec}:${p.quality_score}`).join(';');
    const selKey = `${rawSig}|${lv.minS}`;
    const cands = (selKey === lastSelectionKey && lastCands)
      ? lastCands
      : runSelection(det.rawSilences, lv.minS);
    lastSelectionKey = selKey;
    lastCands = cands;
    const realCount = cands.filter(c => !c.fallbackSpot).length;

    log(`🤖 Чутливість ${li + 1}/${ladder.length} (поріг ${lv.thr}%, пауза ≥${lv.minS}с): пауз ${det.rawSilences.length}, природних міток ${realCount}/${idealAds}`, 'info');

    if (!best || realCount > best.realCount) {
      best = { det, cands, realCount, level: li, minS: lv.minS, thr: lv.thr };
    }
    if (realCount >= Math.ceil(idealAds * 0.85)) {
      best = { det, cands, realCount, level: li, minS: lv.minS, thr: lv.thr };
      break;
    }
  }

  const rawSilences = best.det.rawSilences;

  // Консольний тімлайн фінального результату
  if (rawSilences.length > 0) {
    const stepViz = Math.max(1, Math.floor(totalBlocks / 80));
    let timeline = '';
    for (let i = 0; i < totalBlocks; i += stepViz) {
      const timeSec = i * secPerBlock;
      const isPause = rawSilences.some(p => Math.abs(p.seconds - timeSec) < 5);
      const bin = Math.min(best.det.localThrByBin.length - 1, Math.floor(timeSec / best.det.binSec));
      timeline += isPause ? '🔇' : (smoothed[i] < best.det.localThrByBin[bin] ? '░' : '█');
    }
    console.log('%c📍 Розташування пауз на тімлайні:', 'color:#06d6a0;font-weight:bold');
    console.log(`  ${timeline}`);
  }

  state.selected = best.cands;

  // ── Вливаємо авто-мітки YouTube як якорі (fromYt: true, quality: 1.0) ──
  // Вони знімаються при вставці разом з чекбоксом, тому включаємо їх у план заздалегідь.
  const ytAnchors = state.ytAutoMarks || [];
  for (const anchor of ytAnchors) {
    // Не дублюємо, якщо планувальник вже поставив щось поруч (<3с)
    if (!state.selected.some(s => Math.abs(s.seconds - anchor.seconds) < 3)) {
      state.selected.push({
        timecode: anchor.timecode,
        seconds: anchor.seconds,
        duration_sec: null,
        ideal_duration_sec: null,
        amplitude: null,
        avg_amplitude: null,
        best_avg_amplitude: null,
        max_amplitude: null,
        quality_score: 1.0,
        quality_label: 'YT авто',
        fromYt: true
      });
    }
  }

  // ── Smart Top-Up: збережені ручні мітки вливаємо у план (fromExisting: true, inserted: true) ──
  if (CONFIG.preserveManualMarks && state.existingMarks && state.existingMarks.length > 0) {
    for (const m of state.existingMarks) {
      if (!state.selected.some(s => Math.abs(s.seconds - m.seconds) < 3)) {
        state.selected.push({
          timecode: m.timecode,
          seconds: m.seconds,
          duration_sec: null,
          ideal_duration_sec: null,
          amplitude: null,
          avg_amplitude: null,
          best_avg_amplitude: null,
          max_amplitude: null,
          quality_score: 1.0,
          quality_label: 'ручна (збережена)',
          fromExisting: true,
          inserted: true
        });
      }
    }
  }

  state.selected.sort((a, b) => a.seconds - b.seconds);

  // Дедуплікація: видаляємо мітки ближче ніж 3 секунди одна від одної;
  // fromYt та fromExisting мають пріоритет — при конфлікті залишаємо якір
  state.selected = state.selected.filter((s, i, arr) => {
    if (i === 0) return true;
    if (s.seconds - arr[i - 1].seconds < 3) {
      // якщо поточна — якір (YT чи ручна), а попередня ні: якір лишається, власну мітку знімаємо
      if ((s.fromYt || s.fromExisting) && !(arr[i - 1].fromYt || arr[i - 1].fromExisting)) {
        arr[i - 1]._dedupRemove = true;
        return true;
      }
      return false;
    }
    return true;
  }).filter(s => !s._dedupRemove);

  // ── Стеля плану: бот тримає СВІЙ повний ритм (до idealAds власних міток),
  //    а мітки YouTube та збережені ручні ДОДАЮТЬСЯ зверху — повна картина, нічого не губиться.
  //    Тому обрізаємо лише надлишок ВЛАСНИХ міток понад ідеал; мітки YT та збережені ручні недоторканні.
  const protectedInPlanCount = state.selected.filter(s => s.fromYt || s.fromExisting).length;
  const planCap = idealAds + protectedInPlanCount;
  let removedCount = 0;
  while (state.selected.length > planCap) {
    let bestIdx = -1;
    let minCost = Infinity;

    for (let i = 0; i < state.selected.length; i++) {
      const s = state.selected[i];
      if (s.fromYt || s.fromExisting) continue;

      const prevT = i > 0 ? state.selected[i - 1].seconds : 0;
      const nextT = i < state.selected.length - 1 ? state.selected[i + 1].seconds : duration;
      const mergedGap = nextT - prevT;

      // Менший mergedGap кращий для видалення (не утворює дірок у сітці);
      // fallbackSpot та слабша якість дають пріоритет до видалення при близьких прольотах
      const quality = Number(s.quality_score ?? 0);
      const fallbackBonus = s.fallbackSpot ? 20 : 0;
      const qualityBonus = (1 - quality) * 10;
      const cost = mergedGap - fallbackBonus - qualityBonus;

      if (cost < minCost) {
        minCost = cost;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    state.selected.splice(bestIdx, 1);
    removedCount++;
  }
  if (removedCount > 0) {
    log(`✂️ Знято надлишок власних міток понад ідеал ${idealAds}: ${removedCount} шт. з найменшими прольотами сітки (мітки YT та ручні недоторканні)`, 'info');
  }

  const backupCount = state.selected.filter(s => s.fallbackSpot).length;
  const ytFromCount = state.selected.filter(s => s.fromYt).length;
  const existingCount = state.selected.filter(s => s.fromExisting).length;
  const realCnt = state.selected.length - backupCount - ytFromCount - existingCount;

  // Підрахунок «добрих» (пройшли межу прийняття YT, підказка YT, збережена ручна або якір YT) та «ризикованих» міток
  const goodCount = state.selected.filter(s =>
    s.fromYt === true || s.fromExisting === true || s.ytHint === true || Number(s.quality_score ?? 0) >= ytAccept
  ).length;
  const riskyCount = state.selected.length - goodCount;

  // Підсумок авто-пілота для діагнозу відео (рендериться під статистикою)
  state.analysisMeta = {
    idealAds,
    gap: Math.round(gap),
    escalated: best.level > 0,
    finalThr: best.thr,
    finalMinS: best.minS,
    pausesFound: rawSilences.length,
    realPauses: realCnt,
    backupCount,
    riskyCount,   // міток нижче межі прийняття YT (саме вони можуть не показатись)
    goodCount,    // міток на/вище межі, підказок YT або якорів YT
    existingCount: (state.existingMarks || []).length,
    ytAutoCount: ytAnchors.length
  };

  console.group('%c🎬 [MRA] Відібрані позиції', 'color:#06d6a0;font-weight:bold');
  state.selected.forEach((s, i) =>
    console.log(s.fromExisting
      ? `  ${i + 1}. ${s.timecode}  (ручна збережена — 100%)`
      : s.fromYt
        ? `  ${i + 1}. ${s.timecode}  (якір YT авто — 100%)`
        : s.fallbackSpot
          ? `  ${i + 1}. ${s.timecode}  (запасна — найтихіше місце, чистої паузи немає)`
          : `  ${i + 1}. ${s.timecode}  (пауза: ${s.duration_sec}с, якість: ${Math.round((s.quality_score ?? 0) * 100)}%, амп: ${s.amplitude})`)
  );
  if (state.selected.length === 0)
    console.log('  ⚠️ Не вдалось знайти підходящих пауз з таким інтервалом та параметрами!');
  console.groupEnd();

  const gapR = Math.round(gap);
  const ytAutoCountLog = ytAnchors.length > 0 ? `, якорів YT: ${ytAnchors.length}` : '';
  log(`Відібрано ${state.selected.length}/${idealAds} місць (природних: ${realCnt}, запасних: ${backupCount}${ytAutoCountLog}, ритм ~${gapR}с${best.level > 0 ? `, бот підняв чутливість до ${best.thr}%` : ''}, межа YT ${Math.round(ytAccept * 100)}%)`, state.selected.length > 0 ? 'success' : 'warn');
  updateStatus(
    state.selected.length > 0
      ? (backupCount > 0
        ? `✅ ${state.selected.length}/${idealAds} позицій (${backupCount} запасн.) · ритм ~${gapR}с`
        : `✅ ${state.selected.length}/${idealAds} позицій · ритм ~${gapR}с`)
      : `⚠️ 0 місць! Зменш "Мін. паузу" або збільш "Поріг"`,
    state.selected.length > 0 ? 'success' : 'warn'
  );

  maybeSendAnalysisReport();

  state.silences = rawSilences;

  // Зберігаємо дані для візуалізації
  state.waveformData = {
    envelope: amp,
    smoothed: smoothed,
    duration: duration,
    totalBlocks: totalBlocks,
    secPerBlock: secPerBlock,
    threshold: best.det.threshold
  };

  renderSelectedList();
  renderWaveform();
  return true;
}

// Авто-звіт у Telegram одразу після аналізу: спрацьовує коли вердикт гірший за «ДОБРЕ»
// (share природних пауз < 0.6 — той самий поріг, що на панелі). Дедуплікація по videoId на 12 годин.
async function maybeSendAnalysisReport() {
  if (!MRA_SEND_TG_REPORTS) return;
  try {
    const meta = state.analysisMeta;
    if (!meta || !meta.idealAds) return;
    // Пригнічуємо analysis_warn під час повного авто-циклу: його замінить звіт вставки
    if (state.fullAutoActive) { console.log('[TSN ANALYZER] 📨 Аналіз-звіт пропущено: йде повний автоцикл — все скаже звіт вставки'); return; }
    // Звітуємо ЛИШЕ коли ДОБРИХ міток — тих, що пройшли межу прийняття YT — менше 60% від цілі.
    // Це точніший критерій: раніше рахували лише природні паузи, але запасна з якістю ≥ межі
    // теж добра, а природна нижче межі — ризикована. Відлякувати даремно не треба.
    // Якорі YT вже включені в goodCount (quality 1.0 ≥ будь-якого порогу), тому
    // окремо existingCount не додаємо — вставка все одно зносить ручні мітки.
    const goodShare = (meta.goodCount ?? meta.realPauses ?? 0) / meta.idealAds;
    if (goodShare >= 0.6) return;

    const videoId = getCurrentVideoKey();

    // Дедуплікація: не частіше ніж раз на 12 год на відео (читаємо тут, позначаємо ЛИШЕ після успішної відправки)
    const { tgAnalysisReported } = await chrome.storage.local.get('tgAnalysisReported');
    const map = tgAnalysisReported || {};
    if (map[videoId] && Date.now() - map[videoId] < 12 * 3600 * 1000) {
      console.log('[TSN ANALYZER] 📨 Аналіз-звіт уже надсилався для', videoId, '— пропускаю (дедуплікація 12г)');
      return;
    }

    const videoTitle = getVideoTitle();
    console.log('[TSN ANALYZER] 📨 Надсилаю аналіз-звіт (складний монтаж/мало міток):', { videoTitle, goodShare, selected: state.selected.length, ideal: meta.idealAds });
    // Скільки міток ЗАРАЗ реально стоїть на відео (0 — якщо аналіз іде до вставки)
    let marksOnVideo = 0;
    try { marksOnVideo = getAdBreakDeleteButtons().length; } catch (e) {}
    // Середня якість природних пауз (запасні мають іншу шкалу — не змішуємо)
    const naturalScores = state.selected.filter(s => !s.fallbackSpot && typeof s.quality_score === 'number').map(s => s.quality_score);
    const qualityAvg = naturalScores.length ? Math.round(naturalScores.reduce((a, b) => a + b, 0) / naturalScores.length * 100) : null;
    // У звіті показуємо ризиковані мітки — ті, що нижче межі прийняття YT (і не підказка YT)
    const ytAcceptNow = getYtAcceptQuality();
    chrome.runtime.sendMessage({
      action: 'mra_tg_report',
      report: {
        kind: 'analysis_warn',
        ts: Date.now(),
        videoTitle,
        videoId: videoId,
        videoUrl: window.location.href,
        videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
        analysis: meta,
        selectedCount: state.selected.length,
        marksOnVideo,
        qualityAvg,
        // Всі відібрані мітки з прапорцем risky (нижче межі прийняття YT)
        marks: state.selected.slice(0, 25).map(s => {
          const isRisky = !s.ytHint && Number(s.quality_score ?? 0) < ytAcceptNow;
          return {
            tc: s.timecode,
            backup: !!s.fallbackSpot,
            risky: isRisky,
            quality: s.quality_label || '',
            score: typeof s.quality_score === 'number' ? Math.round(s.quality_score * 100) : null,
            pauseSec: (typeof s.duration_sec === 'number' && s.duration_sec > 0) ? s.duration_sec : null
          };
        }),
        totalPlanned: 0, ok: 0, fail: 0, events: []
      }
    }, async (res) => {
      if (chrome.runtime.lastError) { console.warn('[TSN ANALYZER] ⚠️ Аналіз-звіт: помилка каналу —', chrome.runtime.lastError.message); return; }
      if (!res || !res.ok) { console.warn('[TSN ANALYZER] ⚠️ Аналіз-звіт не доставлено (Telegram не налаштовано/помилка) — дедуп НЕ ставлю, спробую наступного разу'); return; }
      // Успіх — тепер фіксуємо дедуплікацію на 12 год
      const fresh = (await chrome.storage.local.get('tgAnalysisReported')).tgAnalysisReported || {};
      fresh[videoId] = Date.now();
      const keys = Object.keys(fresh);
      if (keys.length > 50) keys.sort((a, b) => fresh[a] - fresh[b]).slice(0, keys.length - 50).forEach(k => delete fresh[k]);
      await chrome.storage.local.set({ tgAnalysisReported: fresh });
    });
  } catch (e) {
    console.error('[TSN ANALYZER] ❌ Помилка аналіз-звіту:', e);
  }
}

// ─── АВТОВСТАВКА ─────────────────────────────────────────────────────────────
// СТРАТЕГІЯ: Вставляємо мітку → вводимо таймкод → видаляємо дублікат якщо YouTube створив зайвий

function getAdBreakDeleteButtons() {
  const btns = [];
  document.querySelectorAll(`path[d="${AD_BREAK_TRASH_PATH}"]`).forEach(path => {
    let el = path.closest('ytcp-icon-button') || path.closest('button') || path.closest('[role="button"]');
    if (el && el.offsetParent !== null && !el.disabled) {
      const inner = el.querySelector('button');
      btns.push(inner || el);
    }
  });
  return [...new Set(btns)];
}

// ─── ПЕРЕВІРКА МІТОК ЧЕРЕЗ ОЦІНКУ YOUTUBE ────────────────────────────────────
// YouTube сам позначає мітки поза "природними паузами" попередженням
// "У цьому місці реклама навряд чи показуватиметься". Зчитуємо його вердикт
// і пересуваємо червоні мітки в найближчу сильну паузу, поки YT не прийме.

// Базова межа прийняття YouTube (холодний старт). Далі бот самонавчається:
// після кожної вставки записує пари (якість → вердикт YT) і коригує межу.
// 0.60 — правильний старт на стабільній шкалі (QUALITY_REF = avgAbs*0.35):
// типові якісні паузи дають ~0.6–0.7, тому 0.70 (старе значення, скалібровано
// на legacy шкалі) відкидало занадто багато реальних пауз. Реальний гейткіпер —
// verifyAndFixFlaggedBreaks: червоні мітки не виживають, і кожен вердикт YT
// зміщує межу до справжнього порогу через самонавчання.
var YT_ACCEPT_QUALITY_DEFAULT = 0.60;
var _qualityCalib = null; // кеш калібрування з chrome.storage: { samples: [{q, ok, ts}] }

// Поточна межа прийняття: за вердиктами YouTube, у безпечних рамках [0.55..0.90].
function getYtAcceptQuality() {
  const samples = (_qualityCalib && Array.isArray(_qualityCalib.samples)) ? _qualityCalib.samples : [];
  const rejected = samples.filter(s => !s.ok).map(s => s.q).sort((a, b) => a - b);
  const accepted = samples.filter(s => s.ok).map(s => s.q).sort((a, b) => a - b);
  // Замало даних — тримаємо холодний старт
  if (samples.length < 8 || rejected.length < 3) return YT_ACCEPT_QUALITY_DEFAULT;
  // Межа: трохи вище 90-го перцентиля ВІДХИЛЕНИХ (стійко до викидів),
  // але зі СТЕЛЕЮ на рівні 25-го перцентиля ПРИЙНЯТИХ — щоб серія дивних відмов
  // YT на якісних паузах не задерла межу вище робочих пауз і не лишила бота без міток.
  const p = (arr, q) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : null;
  const fromRejected = p(rejected, 0.9) + 0.02;
  const acceptedCap = accepted.length >= 5 ? Math.max(0.65, p(accepted, 0.25)) : 0.90;
  const bound = Math.min(fromRejected, acceptedCap);
  return Math.min(0.90, Math.max(0.55, +bound.toFixed(3)));
}

// Завантаження калібрування (лінива ініціалізація на старті аналізу)
async function loadQualityCalib() {
  if (_qualityCalib) return;
  try {
    const data = await chrome.storage.local.get('mraQualityCalib');
    _qualityCalib = data.mraQualityCalib || { samples: [] };
  } catch (e) { _qualityCalib = { samples: [] }; }
}

// Запис нових вердиктів YT (натуральні паузи та запасні — одна шкала якості)
async function recordQualityVerdicts(points) {
  if (!points.length) return;
  try {
    await loadQualityCalib();
    const now = Date.now();
    _qualityCalib.samples.push(...points.map(pt => ({ q: +pt.q.toFixed(3), ok: !!pt.ok, ts: now })));
    // Тримаємо останні 300 зразків і не старші за 60 діб
    const cutoff = now - 60 * 24 * 3600 * 1000;
    _qualityCalib.samples = _qualityCalib.samples.filter(s => s.ts >= cutoff).slice(-300);
    await chrome.storage.local.set({ mraQualityCalib: _qualityCalib });
    log(`📚 Самонавчання: +${points.length} вердиктів YT, межа прийняття тепер ${Math.round(getYtAcceptQuality() * 100)}%`, 'info');
  } catch (e) { console.warn('[TSN ANALYZER] calib save failed', e); }
}

var YT_FLAG_TEXT_FRAGMENTS = [
  'перемістіть рекламне місце', 'навряд чи показуватиметься', 'природних паузах',
  'move the ad break', 'unlikely to be shown', 'natural pauses',
  'переместите рекламное место', 'вряд ли будет показываться'
];

function getAdBreakRows() {
  const rows = [];
  const AUTO_RE = /автоматичн|автоматическ|automatic/i;
  const MANUAL_RE = /вручну|вибране|manual/i;
  getAdBreakDeleteButtons().forEach(btn => {
    const row = btn.closest('ytve-ad-break-row')
      || btn.closest('div[role="row"]')
      || btn.closest('div.style-scope.ytve-ad-breaks-editor')
      || btn.parentElement;
    const input = row ? row.querySelector('input') : null;
    if (!row || !input || rows.some(r => r.row === row)) return;

    // Класифікація рядка: підіймаємось до контейнера з текстом лейбла,
    // але не вище за межі ОДНОГО рядка (контейнер з одним input)
    let labelEl = row;
    for (let i = 0; i < 5; i++) {
      const txt = labelEl.textContent || '';
      if (AUTO_RE.test(txt) || MANUAL_RE.test(txt)) break;
      const parent = labelEl.parentElement;
      if (!parent || parent.querySelectorAll('input').length > 1) break;
      labelEl = parent;
    }
    const isAuto = AUTO_RE.test(labelEl.textContent || '');
    rows.push({ row, input, btn, isAuto });
  });
  return rows;
}

// Зчитує мітки, які ВЖЕ стоять на відео — ЛИШЕ ручні («вибране вручну»).
// «Автоматичні рекламні місця» YouTube пропускаємо: вони зберігаються окремо
// у readYtAutoMarks() як 100%-якорі плану.
function readExistingAdBreaks() {
  const marks = [];
  try {
    for (const r of getAdBreakRows()) {
      if (r.isAuto) continue; // автоматичні — лише в readYtAutoMarks()
      const sec = fromTimecode(r.input.value);
      if (sec == null || !isFinite(sec)) continue;
      if (marks.some(m => Math.abs(m.seconds - sec) < 0.5)) continue;
      marks.push({ seconds: +sec.toFixed(2), timecode: r.input.value });
    }
  } catch (e) { /* редактор ще не домальований — вважаємо що міток нема */ }
  return marks.sort((a, b) => a.seconds - b.seconds);
}

// Зчитує авто-мітки YouTube («Рекламне місце (автоматичне)»).
// Це позиції, де YT 100% вважає паузу природною — запам'ятовуємо їх як якорі плану,
// бо при вставці бот знімає чекбокс «Автоматичні рекламні місця» і вони зникають,
// тому треба включити їх у state.selected ДО вставки.
function readYtAutoMarks() {
  const marks = [];
  try {
    for (const r of getAdBreakRows()) {
      if (!r.isAuto) continue;
      const sec = fromTimecode(r.input.value);
      if (sec == null || !isFinite(sec)) continue;
      if (marks.some(m => Math.abs(m.seconds - sec) < 0.5)) continue;
      marks.push({ seconds: +sec.toFixed(2), timecode: r.input.value });
    }
  } catch (e) { /* редактор ще не домальований */ }
  return marks.sort((a, b) => a.seconds - b.seconds);
}

function isAdBreakRowFlagged(row) {
  try {
    if (row.querySelector(
      'ytcp-icon[icon*="warning" i], iron-icon[icon*="warning" i], tp-yt-iron-icon[icon*="warning" i],' +
      '[icon*="WARNING"], [aria-label*="попередження" i], [aria-label*="warning" i], [class*="warning" i]'
    )) return true;

    const txt = (row.textContent || '').toLowerCase();
    if (YT_FLAG_TEXT_FRAGMENTS.some(f => txt.includes(f))) return true;
  } catch (e) { /* ignore */ }
  return false;
}

// Найкраща пауза для переносу червоної мітки: близько до старого місця і якісна
function pickReplacementPause(badSec, excludeSecs) {
  // Пріоритет №1: підказка YouTube поряд — гарантовано прийнятне місце
  const hints = (state.ytHintsSec || [])
    .filter(h => !excludeSecs.some(x => Math.abs(x - h) < 3))
    .map(h => ({ h, d: Math.abs(h - badSec) }))
    .filter(c => c.d > 0.5 && c.d <= 60)
    .sort((a, b) => a.d - b.d);
  if (hints.length) {
    return {
      seconds: +hints[0].h.toFixed(2),
      timecode: toTimecode(hints[0].h),
      duration_sec: 0,
      ideal_duration_sec: 0,
      quality_score: 0.95,
      quality_label: 'підказка YT',
      ytHint: true
    };
  }

  // Фільтруємо лише паузи вище межі прийняття YT — немає сенсу пересувати мітку
  // в іншу паузу, яку YouTube так само позначить червоним.
  const cands = (state.silences || [])
    .filter(p => Number(p.quality_score ?? 0) >= getYtAcceptQuality())
    .filter(p => !excludeSecs.some(x => Math.abs(x - p.seconds) < 3))
    .map(p => ({ p, d: Math.abs(p.seconds - badSec) }))
    .filter(c => c.d > 0.5 && c.d <= 45)
    .sort((a, b) => (a.d - (a.p.quality_score || 0) * 30) - (b.d - (b.p.quality_score || 0) * 30));
  return cands.length ? cands[0].p : null;
}

// Чекаємо, поки YouTube домалює вердикти: вони з'являються асинхронно і з запізненням.
// Вважаємо вердикти готовими, коли кількість попереджень не змінюється 3 перевірки
// поспіль і минуло щонайменше 4с. Стеля очікування — 12с (+запас на великі списки).
async function waitForYtVerdicts(maxMs = 12000) {
  const t0 = Date.now();
  let prev = -1;
  let stableTicks = 0;
  while (Date.now() - t0 < maxMs) {
    const rows = getAdBreakRows();
    const flaggedCnt = rows.filter(r => isAdBreakRowFlagged(r.row)).length;
    if (flaggedCnt === prev) stableTicks++; else stableTicks = 0;
    prev = flaggedCnt;
    if (stableTicks >= 3 && Date.now() - t0 >= 4000) break;
    await sleep(700);
  }
  return prev;
}

async function verifyAndFixFlaggedBreaks() {
  let rows = getAdBreakRows();
  if (!rows.length) {
    log('🩺 Перевірка YT: рядків міток у редакторі не знайдено', 'warn');
    return { checked: 0, flagged: 0, fixed: 0, removed: 0 };
  }
  // Великі списки YT оцінює довше — даємо пропорційний запас до стелі
  await waitForYtVerdicts(12000 + Math.min(6000, rows.length * 200));
  rows = getAdBreakRows();

  let flagged = rows.filter(r => isAdBreakRowFlagged(r.row));
  log(`🩺 Перевірка YT: міток ${rows.length}, з попередженням YouTube: ${flagged.length}`, flagged.length ? 'warn' : 'success');

  // ── Самонавчання: записуємо первинний вердикт YT для кожної нашої мітки ──
  // fromYt мітки виключаємо: їх quality 1.0 синтетична, запис спотворить калібрування.
  try {
    const points = [];
    for (const r of rows) {
      const sec = fromTimecode(r.input.value);
      if (sec == null) continue;
      const sel = state.selected.find(s => Math.abs(s.seconds - sec) < 2);
      if (!sel || sel.ytHint || sel.fromYt || sel.movedByYtCheck || typeof sel.quality_score !== 'number') continue;
      points.push({ q: sel.quality_score, ok: !isAdBreakRowFlagged(r.row) });
    }
    recordQualityVerdicts(points); // без await — не блокуємо основний потік
  } catch (e) { /* ignore */ }

  if (!flagged.length) {
    updateStatus('🩺 YouTube прийняв усі мітки (червоних попереджень немає)', 'success');
    return { checked: rows.length, flagged: 0, fixed: 0, removed: 0 };
  }

  updateStatus(`🩺 YouTube позначив ${flagged.length} міток. Пересуваємо у природні паузи...`, 'info');
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  // Зберігаємо початкову кількість позначених міток для звітності
  const flaggedInitialCount = flagged.length;
  let fixed = 0;

  for (let pass = 1; pass <= 2; pass++) {
    if (state.insertAbort) break;
    if (pass > 1) {
      // Після пересувань YT переоцінює рядки — чекаємо нові вердикти і добиваємо те, що лишилось
      await waitForYtVerdicts(8000);
      flagged = getAdBreakRows().filter(r => isAdBreakRowFlagged(r.row));
      if (!flagged.length) break;
      log(`🩺 Прохід ${pass}: YouTube ще позначає ${flagged.length} міток — повторне пересування`, 'warn');
    }

    for (const fr of flagged) {
      if (state.insertAbort) break;

      const badSec = fromTimecode(fr.input.value);
      if (badSec == null) continue;

      const tried = [badSec];
      let cleared = false;

      for (let attempt = 0; attempt < 3 && !cleared; attempt++) {
        const takenSecs = getAdBreakRows()
          .map(r => fromTimecode(r.input.value))
          .filter(v => v != null && Math.abs(v - badSec) > 0.5);

        const cand = pickReplacementPause(badSec, takenSecs.concat(tried));
        if (!cand) break;
        tried.push(cand.seconds);

        const tc = toTimecode(cand.seconds);
        nativeSetter.call(fr.input, tc);
        fr.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fr.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        fr.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
        // Буфер на переоцінку YT, далі чекаємо ФАКТ зникнення попередження (або таймаут)
        await sleep(700);
        await waitFor(() => {
          const fresh = getAdBreakRows().find(r => r.input.value === tc) || fr;
          return !isAdBreakRowFlagged(fresh.row);
        }, 1300);

        // Після зміни часу YT може пересортувати рядки → шукаємо рядок заново за значенням
        const freshRows = getAdBreakRows();
        const freshRow = freshRows.find(r => r.input.value === tc) || fr;

        if (!isAdBreakRowFlagged(freshRow.row)) {
          cleared = true;
          fixed++;
          // ── Telegram: мітку успішно пересунуто ──
          state.tgEvents.push({ type: 'yt_flag_moved', fromTc: toTimecode(badSec), toTc: tc });

          const sel = state.selected.find(s => Math.abs(s.seconds - badSec) < 2);
          if (sel) {
            sel.seconds = cand.seconds;
            sel.timecode = tc;
            sel.duration_sec = cand.duration_sec;
            sel.ideal_duration_sec = cand.ideal_duration_sec;
            sel.quality_score = cand.quality_score;
            sel.quality_label = cand.quality_label;
            sel.fallbackSpot = false;
            sel.movedByYtCheck = true;
          }
          log(`🩺 ${toTimecode(badSec)} → ${tc} (YouTube прийняв нове місце)`, 'success');
        }
      }

      // Звіт «застрягла» лише на фінальному проході — щоб не дублювати подію,
      // якщо мітка не пройшла пас 1, але пройде пас 2.
      if (!cleared && pass === 2) {
        log(`🩺 ${fr.input.value}: YT-попередження не зникло — поряд немає паузи, яку YouTube вважає природною`, 'warn');
        // ── Telegram: мітку не вдалось пересунути (вичерпано всі проходи) ──
        state.tgEvents.push({ type: 'yt_flag_stuck', atTc: fr.input.value });
      }
    }
  }

  // ФІНАЛЬНИЙ КРОК — РОЗУМНИЙ РЕЖИМ: мітки, які YouTube не прийняв (⚠️), видаляємо,
  // ЩОБ лишались тільки правильні. АЛЕ якщо без них загальна кількість впаде нижче
  // ~60% цілі — повертаємо найкращі із забракованих (обираємо найрівномірніше, щоб
  // заповнити найбільші діри), аби ритм реклами не провисав. Так на відео з паузами
  // лишаються майже самі чисті мітки, а на щільному монтажі — додаються запасні для
  // ритму. Бот уже намагався пересунути червоні мітки у природні паузи в пасах 1-2.
  const SMART_FLOOR_RATIO = 0.6;
  let removed = 0;
  let kept = 0;
  if (CONFIG.autoGap && !state.insertAbort) {
    await waitForYtVerdicts(6000); // даємо YT домалювати вердикти після пересувань
    const allRows = getAdBreakRows();
    const flaggedRows = allRows.filter(r => isAdBreakRowFlagged(r.row));
    const acceptedCount = allRows.length - flaggedRows.length;

    // Підлога: щонайменше ~60% цілі мусить лишитись на відео
    const ideal = (state.analysisMeta && state.analysisMeta.idealAds)
      || Math.max(1, Math.floor(((state.waveformData && state.waveformData.duration) || 0) / 120));
    const floorCount = Math.ceil(ideal * SMART_FLOOR_RATIO);

    // Скільки забракованих лишити, щоб дотягнути до підлоги
    const keepFlaggedTarget = Math.min(flaggedRows.length, Math.max(0, floorCount - acceptedCount));

    // Обираємо, які забраковані ЛИШИТИ: жадібно заповнюємо найбільші діри —
    // щоразу беремо мітку, найдальшу від уже-обраних точок (рівномірний ритм).
    const secOf = (r) => fromTimecode(r.input.value);
    const keepSet = new Set();
    if (keepFlaggedTarget > 0) {
      const chosenSec = allRows
        .filter(r => !flaggedRows.includes(r))
        .map(secOf).filter(v => v != null); // опори — уже прийняті (чисті) мітки
      const candidates = flaggedRows.map(r => ({ r, sec: secOf(r) })).filter(c => c.sec != null);
      for (let i = 0; i < keepFlaggedTarget; i++) {
        let best = null, bestDist = -1;
        for (const c of candidates) {
          if (keepSet.has(c.r)) continue;
          const nearest = chosenSec.length ? Math.min(...chosenSec.map(s => Math.abs(s - c.sec))) : Infinity;
          if (nearest > bestDist) { bestDist = nearest; best = c; }
        }
        if (!best) break;
        keepSet.add(best.r);
        chosenSec.push(best.sec);
      }
    }

    for (const fr of flaggedRows) {
      if (state.insertAbort) break;
      const tcLabel = fr.input.value;
      const sec = fromTimecode(tcLabel);

      if (keepSet.has(fr)) {
        // Лишаємо з попередженням — позначаємо, щоб метрики/калібрування були чесні
        kept++;
        if (sec != null) {
          const selMark = state.selected.find(s => Math.abs(s.seconds - sec) < 1);
          if (selMark) selMark.ytFlaggedKept = true;
        }
        if (!state.tgEvents.some(ev => ev.type === 'yt_flag_stuck' && ev.atTc === tcLabel)) {
          state.tgEvents.push({ type: 'yt_flag_stuck', atTc: tcLabel });
        }
        log(`⚠️ ${tcLabel}: YouTube попереджає — ЛИШАЮ (тримаю ритм, розумний режим)`, 'warn');
      } else {
        // Видаляємо — є чим тримати ритм без цієї мітки
        fr.btn.click();
        await waitFor(() => !document.contains(fr.row), 1500);
        removed++;
        if (sec != null) {
          const i = state.selected.findIndex(s => Math.abs(s.seconds - sec) < 1);
          if (i >= 0) state.selected.splice(i, 1);
        }
        // Прибираємо застарілу подію 'stuck' для цієї мітки (її видалено, не лишено)
        state.tgEvents = state.tgEvents.filter(ev => !(ev.type === 'yt_flag_stuck' && ev.atTc === tcLabel));
        log(`🗑️ ${tcLabel}: YouTube не прийняв це місце — видалено (є чим тримати ритм)`, 'warn');
        state.tgEvents.push({ type: 'yt_flag_removed', atTc: tcLabel });
      }
    }
    if (kept || removed) {
      log(`🧠 Розумний режим: ${acceptedCount} чистих + ${kept} лишених для ритму (підлога ${floorCount}), видалено ${removed}`, 'info');
    }
  }

  state.selected.sort((a, b) => a.seconds - b.seconds);
  renderSelectedList();
  renderWaveform();

  const parts = [];
  if (fixed) parts.push(`${fixed} переміщено`);
  if (removed) parts.push(`${removed} видалено`);
  if (kept) parts.push(`${kept} лишено для ритму`);
  updateStatus(
    `🩺 Вердикт YT (розумний режим): ${parts.join(', ') || 'усе чисто'}. Лишилось міток: ${getAdBreakRows().length}`,
    'success'
  );

  return { checked: rows.length, flagged: flaggedInitialCount, fixed, removed, kept };
}

// Ручний запуск з консолі для діагностики
globalThis.mraVerifyAdBreaks = verifyAndFixFlaggedBreaks;

// ─── ПОВНИЙ АВТОПІЛОТ: НУЛЬ КЛІКІВ ───────────────────────────────────────────
// Відкрив редактор відео без міток → бот сам: аналіз → вставка → перевірка YT → збереження.
// Запускається один раз на відео (ключ — URL вейвформи).
async function maybeFullAutoRun() {
  try {
    if (!CONFIG.fullAutoInsert) return;
    if (!document.getElementById('mra-panel')) return;
    if (!state.waveformUrl || state.analyzing || state.inserting) return;
    if (state.autoRunUrl === state.waveformUrl) return;

    state.autoRunUrl = state.waveformUrl;

    // Чекаємо ФАКТ готовності редактора (а не фіксовану паузу) — на повільному з'єднанні
    // 2.5с фіксованого sleep інколи не вистачало: редактор ще не домальований,
    // readExistingAdBreaks() повертав [] і бот вважав відео порожнім, знісши ручні мітки.
    const editorReady = await waitFor(() => document.querySelector('ytve-ad-breaks-editor') && findInsertAdBreakButton(), 20000, 300);
    if (!document.getElementById('mra-panel')) return; // панель могли закрити за час очікування

    if (!editorReady) {
      state.autoRunUrl = null; // дозволяємо повторну спробу при наступному тригері
      log('⚡ Авто-вставка: редактор не догрузився за 20с — вставку скасовано, спробую пізніше', 'warn');
      return;
    }

    // Кнопка вставки з'являється раніше за самі рядки наявних міток — даємо їм домалюватись.
    await sleep(1200);
    if (readExistingAdBreaks().length > 0) {
      log('⚡ Авто-вставка: на відео вже є ручні мітки — вставку пропускаю (їх видно на вейвформі після аналізу; щоб доставити відсутні — натисніть «Аналізувати» і «Вставити» вручну)', 'info');
      // Але аналіз все одно запускаємо: якщо монтаж складний — Telegram-звіт піде і без вставки
      // (maybeSendAnalysisReport усередині analyzeWaveform, з дедуплікацією 12 год по відео)
      if (!state.analysisMeta && !state.analyzing) {
        log('⚡ Запускаю аналіз лише для звіту (без вставки)...', 'info');
        try { await analyzeWaveform(); } catch (e) { log('⚡ Аналіз для звіту не вдався: ' + e.message, 'warn'); }
      }
      return;
    }

    log('⚡ Авто-вставка: запускаю повний цикл (аналіз → вставка → збереження)', 'success');
    showHud('⚡ Повний автопілот: аналізую відео...', 'info', 2500);

    state.fullAutoActive = true; // Пригнічуємо analysis_warn: звіт вставки замінить його
    try {
      const ok = await analyzeWaveform();
      if (!ok || !state.selected.length) {
        log('⚡ Авто-вставка: аналіз не дав позицій — зупиняюсь', 'warn');
        // ── Telegram: КРИТИЧНО — мітки поставити нікуди (монтаж встик) ──
        try {
          if (MRA_SEND_TG_REPORTS && ok) { // аналіз пройшов, але позицій нема — це «встик», а не технічний збій
            const videoTitle = getVideoTitle();
            const videoIdMatch = window.location.pathname.match(/\/video\/([^/]+)/);
            console.log('[TSN ANALYZER] 📨 Sending "no_spots" Telegram report for:', videoTitle);
            chrome.runtime.sendMessage({
              action: 'mra_tg_report',
              report: {
                kind: 'no_spots',
                ts: Date.now(),
                videoTitle,
                videoId: videoIdMatch ? videoIdMatch[1] : '',
                videoUrl: window.location.href,
                videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
                analysis: state.analysisMeta || null,
                totalPlanned: 0, ok: 0, fail: 0, events: []
              }
            });
          }
        } catch (e) {
          console.error('[TSN ANALYZER] ❌ Error sending "no_spots" report:', e);
        }
        return;
      }

      await sleep(600);
      await insertTimecodes(); // далі сам: перевірка вердикту YT + автозбереження
    } finally {
      state.fullAutoActive = false; // Завжди скидаємо, навіть при помилці або ранньому return
    }
  } catch (e) {
    log('⚡ Авто-вставка: помилка — ' + e.message, 'error');
  }
}
globalThis.maybeFullAutoRun = maybeFullAutoRun;

async function insertTimecodes() {
  if (state.inserting) {
    log('⚠️ Вставка вже виконується, зачекайте...', 'warn');
    return;
  }

  // Беремо тільки ті паузи, які ще НЕ були успішно вставлені
  const pendingSilences = state.selected.filter(s => !s.inserted);
  if (!pendingSilences.length) {
    updateStatus('✅ Всі мітки вже вставлено!', 'success');
    return;
  }

  state.inserting = true;
  state.insertAbort = false;

  // ── Скидаємо буфер Telegram-подій перед новою вставкою ──
  state.tgEvents = [];

  let ok = 0, fail = 0, skippedDup = 0;

  try {
    // YouTube вміє підмішувати власні «автоматичні рекламні місця» поруч із нашими —
    // вимикаємо чекбокс, щоб розстановкою керував лише бот (бойовий кейс: дубль за 6с).
    const autoAdsCb = findAutoAdsCheckbox();
    if (autoAdsCb && autoAdsCb.getAttribute('aria-checked') === 'true') {
      log('⚙️ Вимикаю «Автоматичні рекламні місця» YouTube — мітки ставить лише бот', 'info');
      autoAdsCb.click();
      await sleep(400);
    }

    // Зносимо ВСІ мітки, що лишились (якщо не увімкнено збереження ручних міток).
    // При CONFIG.preserveManualMarks ручні мітки залишаються і нові просто доставляються у прогалини.
    if (!CONFIG.preserveManualMarks || !state.existingMarks || state.existingMarks.length === 0) {
      let delBtns = getAdBreakDeleteButtons();
      if (delBtns.length > 0) {
        log(`🗑️ Прибираю ${delBtns.length} старих міток — план ставиться з нуля`, 'info');
        let deleted = 0; const totalToDelete = delBtns.length;
        while (true) {
          delBtns = getAdBreakDeleteButtons();
          if (delBtns.length === 0) break;
          const beforeCount = delBtns.length;
          delBtns[delBtns.length - 1].click();
          deleted++;
          await waitFor(() => getAdBreakDeleteButtons().length < beforeCount, 1200);
          if (deleted > totalToDelete + 10) break;
        }
      }
    } else {
      log(`🛡️ Зберігаємо ${state.existingMarks.length} існуючих ручних міток — старі мітки не видаляються`, 'info');
    }

    updateStatus(`⏳ Вставляємо ${pendingSilences.length} нових міток...`, 'info');
    updateProgress(0, pendingSilences.length);
    showStopButton(true);

    for (let idx = 0; idx < pendingSilences.length; idx++) {
      if (state.insertAbort) {
        log(`⛔ Вставку зупинено користувачем після ${ok} міток`, 'warn');
        break;
      }
      const s = pendingSilences[idx];

      // Захист від дублів: поруч уже стоїть РУЧНА мітка (поставлена раніше або вручну).
      // Авто-мітки YouTube тут не рахуються (readExistingAdBreaks їх фільтрує) —
      // сусідство з авто-міткою не повинно блокувати ботову, бо авто-шар динамічний.
      const dupMark = readExistingAdBreaks().find(m => Math.abs(m.seconds - s.seconds) < 3);
      if (dupMark) {
        s.inserted = true;
        skippedDup++;
        log(`⏭️ ${s.timecode}: за 3с уже стоїть мітка ${dupMark.timecode} — пропускаю (дубль)`, 'warn');
        renderSelectedList();
        updateProgress(ok, pendingSilences.length);
        continue;
      }

      log(`[${idx + 1}/${pendingSilences.length}] Вставка: ${s.timecode}`, 'info');

      try {
        // 1. Запам'ятовуємо стан міток ДО
        const deleteBtnsBefore = getAdBreakDeleteButtons();
        const beforeRowSet = new Set(getAdBreakRows().map(r => r.row));
        const beforeBtnSet = new Set(deleteBtnsBefore);

        // 2. ІМІТАЦІЯ ЛЮДИНИ: Вводимо час в ГОЛОВНИЙ інпут плеєра
        const timeInputs = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, ytcp-media-timestamp-input input'));
        // Беремо перший видимий, або останній у DOM (якщо вкладка прихована)
        let mainInput = timeInputs.find(inp => inp.offsetParent !== null) || timeInputs[timeInputs.length - 1];

        // Синхронізуємо відео
        const videoEl = document.querySelector('video');
        if (videoEl) {
          videoEl.currentTime = s.seconds;
          videoEl.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        }

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        if (mainInput) {
          nativeSetter.call(mainInput, s.timecode);
          mainInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          mainInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
          await waitFor(
            () => (!videoEl || Math.abs(videoEl.currentTime - s.seconds) < 1.2) &&
                  (!mainInput || Math.abs((fromTimecode(mainInput.value) ?? -999) - s.seconds) < 1.2),
            document.hidden ? 1500 : 800,
            120
          );
          await sleep(document.hidden ? 150 : 80);
        } else {
          await sleep(600);
        }

        // 3. Тиснемо кнопку "Вставити рекламне місце"
        const btn = findInsertAdBreakButton();
        if (!btn) throw new Error('Кнопка вставки не знайдена');
        btn.click();

        // Чекаємо ФАКТ: у списку з'явився новий рядок (або виліз діалог підтвердження)
        let appeared = await waitFor(
          () => getAdBreakDeleteButtons().length > deleteBtnsBefore.length || findConfirmButton(),
          3500
        );
        const confirmBtn = findConfirmButton();
        if (confirmBtn) {
          confirmBtn.click();
          appeared = await waitFor(() => getAdBreakDeleteButtons().length > deleteBtnsBefore.length, 2500);
        }
        if (!appeared) throw new Error('Рядок мітки не з\'явився у списку');
        await sleep(document.hidden ? 140 : 70); // мікро-осідання DOM після появи рядка

        // 4. Визначаємо додані рядки
        const afterRows = getAdBreakRows();
        const addedRows = afterRows.filter(r => !beforeRowSet.has(r.row));

        // ----------------------------------------------------------------------
        // ПЕРЕВІРКА ЧАСУ: звіряємо доданий рядок з нашим таймкодом.
        // Ловить і фоновий глюк 00:00, і недосинхронізований плейхед на швидкому темпі.
        // ----------------------------------------------------------------------
        const targetRow = (addedRows.length > 0 && addedRows[0]?.row)
          ? addedRows[0].row
          : (() => {
              const currentDeleteBtns = getAdBreakDeleteButtons();
              if (currentDeleteBtns.length === 0) return null;
              const lastBtn = currentDeleteBtns[currentDeleteBtns.length - 1];
              return lastBtn.closest('ytve-ad-break-row') || lastBtn.closest('div[role="row"]') || lastBtn.closest('div.style-scope.ytve-ad-breaks-editor');
            })();

        if (targetRow) {
            const rowInput = targetRow.querySelector('input');
            // Порівнюємо за секундами (формат може відрізнятись), допуск < 0.3с
            let rowSec = NaN;
            try { rowSec = fromTimecode(rowInput ? rowInput.value : ''); } catch (e) {}
            if (rowInput && !(Math.abs(rowSec - s.seconds) < 0.3)) {
                log(`Виправляємо хибний час ${rowInput.value} -> ${s.timecode}`, 'warn');

                nativeSetter.call(rowInput, s.timecode);
                rowInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                rowInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                rowInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));

                // Чекаємо ФАКТ: інпут рядка показує правильний час
                const timeFixed = await waitFor(() => {
                  try { return Math.abs(fromTimecode(rowInput.value) - s.seconds) < 0.3; } catch (e) { return false; }
                }, 1500);
                // ── Telegram: хибний час не вдалося виправити ──
                if (!timeFixed) {
                  state.tgEvents.push({ type: 'time_mismatch', plannedSec: s.seconds, plannedTc: s.timecode, actualTc: rowInput.value, quality: s.quality_label || '' });
                }
                await sleep(150);
            }
        }
        // ----------------------------------------------------------------------

        // 6. ВИДАЛЕННЯ ДУБЛІКАТІВ
        const deleteBtnsAfter = getAdBreakDeleteButtons();
        const created = deleteBtnsAfter.length - deleteBtnsBefore.length;

        if (created > 1) {
          log(`⚠️ YouTube створив ${created} записів замість 1, видаляємо ${created - 1} зайвих...`, 'warn');
          for (let d = 0; d < created - 1; d++) {
            const currentBtns = getAdBreakDeleteButtons();
            const newBtns = currentBtns.filter(b => !beforeBtnSet.has(b));
            // Залишаємо першу нову кнопку (індекс 0), видаляємо додаткові (від індексу 1 onward)
            const btnToDelete = (newBtns.length > 1) ? newBtns[1] : currentBtns[currentBtns.length - 1];
            if (btnToDelete) {
              const beforeCount = currentBtns.length;
              btnToDelete.click();
              // Чекаємо ФАКТ: рядок зник зі списку
              await waitFor(() => getAdBreakDeleteButtons().length < beforeCount, 1500);
            }
          }
          await sleep(150);
        }

        s.inserted = true;
        renderSelectedList();

        ok++;
        updateProgress(ok, pendingSilences.length);
        log(`✅ ${s.timecode} вставлено`, 'success');
        await sleep(document.hidden ? 450 : 150); // коротке осідання — факт вставки вже перевірено
      } catch (e) {
        fail++;
        log(`❌ ${s.timecode}: ${e.message}`, 'error');
        // ── Telegram: мітку не вставлено ──
        state.tgEvents.push({ type: 'insert_failed', plannedSec: s.seconds, plannedTc: s.timecode, error: String(e.message || e), quality: s.quality_label || '' });
        const closeBtn = document.querySelector('ytcp-dialog [aria-label*="close"], ytcp-dialog .close-button');
        if (closeBtn) { closeBtn.click(); await sleep(500); }
      }
    }
  } finally {
    showStopButton(false);
    state.inserting = false;

    const aborted = state.insertAbort;
    state.insertAbort = false;

    if (aborted) {
      updateStatus(`⛔ Зупинено! Вставлено ${ok} з ${pendingSilences.length}`, 'warn');
    } else if (ok === 0 && skippedDup > 0) {
      updateStatus(`✅ Всі ${skippedDup} міток уже стоять на відео — нічого вставляти`, 'success');
    } else {
      const dupSuffix = skippedDup > 0 ? ` (${skippedDup} пропущено як дублі)` : '';
      updateStatus(
        fail === 0 ? `🏁 Готово! ${ok} нових міток вставлено. Натисніть "Зберегти"!${dupSuffix}` : `⚠️ Вставлено: ${ok}, помилок: ${fail}${dupSuffix}`,
        fail === 0 ? 'success' : 'warn'
      );
    }
    updateProgress(ok, pendingSilences.length);

    // Перевірка вердикту YouTube ВИМКНЕНА у спрощеному режимі (прапорець MRA_VERIFY_AFTER_INSERT)
    if (MRA_VERIFY_AFTER_INSERT && !aborted && ok > 0) {
      try {
        await verifyAndFixFlaggedBreaks();
      } catch (e) {
        log('🩺 Перевірка YT не вдалася: ' + e.message, 'warn');
      }
    }

    // ── Telegram-звіт після вставки ──
    // Два сценарії:
    //   1) Технічні збої (fail/problems) → детальний 🚨-звіт kind:'insert' зі списком подій.
    //   2) Збоїв нема, але якість плану слабка (добрих міток < 60% від цілі) →
    //      простий звіт kind:'analysis_warn' — той самий людський формат, що після аналізу,
    //      але вже з ФАКТИЧНИМ станом міток після вставки та перевірки YT.
    try {
      const problems = state.tgEvents.filter(ev => ev.type !== 'yt_flag_moved');
      const meta = state.analysisMeta || {};
      const goodShare = (meta.idealAds || 0) > 0 ? ((meta.goodCount ?? meta.realPauses ?? 0) / meta.idealAds) : 1;
      const qualityWarn = goodShare < 0.6;

      // Дедуп-карта: якщо analysis_warn для цього відео вже йшов за останні 12 год — не дублюємо
      const videoId = getCurrentVideoKey();
      let qualityAlreadyReported = false;
      try {
        const { tgAnalysisReported } = await chrome.storage.local.get('tgAnalysisReported');
        qualityAlreadyReported = !!(tgAnalysisReported && videoId && tgAnalysisReported[videoId] && Date.now() - tgAnalysisReported[videoId] < 12 * 3600 * 1000);
      } catch (e) { /* не критично */ }

      // Позначка дедупу (спільна для обох сценаріїв — ставиться лише після успішної відправки)
      const markReported = async () => {
        try {
          const fresh = ((await chrome.storage.local.get('tgAnalysisReported')).tgAnalysisReported) || {};
          fresh[videoId] = Date.now();
          const keys = Object.keys(fresh);
          if (keys.length > 50) keys.sort((a, b) => fresh[a] - fresh[b]).slice(0, keys.length - 50).forEach(k => delete fresh[k]);
          await chrome.storage.local.set({ tgAnalysisReported: fresh });
        } catch (e) { /* не критично */ }
      };

      if (MRA_SEND_TG_REPORTS && (fail > 0 || problems.length > 0)) {
        // ── Сценарій 1: технічні збої — детальний звіт ──
        const videoTitle = getVideoTitle();
        console.log('[TSN ANALYZER] 📨 Sending "insert problems" Telegram report:', { videoTitle, fail, problems: problems.length });
        chrome.runtime.sendMessage({
          action: 'mra_tg_report',
          report: {
            kind: 'insert',
            ts: Date.now(),
            videoTitle,
            videoId: videoId,
            videoUrl: window.location.href,
            videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
            totalPlanned: ok + fail,
            ok, fail,
            events: state.tgEvents,
            analysis: state.analysisMeta || null
          }
        }, async (res) => {
          if (chrome.runtime.lastError) { console.warn('[TSN ANALYZER] ⚠️ Insert-звіт: помилка каналу —', chrome.runtime.lastError.message); return; }
          if (!res || !res.ok) return;
          if (qualityWarn) await markReported();
        });
      } else if (MRA_SEND_TG_REPORTS && qualityWarn && !qualityAlreadyReported && ok > 0) {
        // ── Сценарій 2: вставка чиста, але пауз мало — простий звіт «мало пауз» ──
        const videoTitle = getVideoTitle();
        const ytAcceptNow = getYtAcceptQuality();
        let marksOnVideo = 0;
        try { marksOnVideo = getAdBreakDeleteButtons().length; } catch (e) {}
        const naturalScores = state.selected.filter(s => !s.fallbackSpot && !s.fromYt && typeof s.quality_score === 'number').map(s => s.quality_score);
        const qualityAvg = naturalScores.length ? Math.round(naturalScores.reduce((a, b) => a + b, 0) / naturalScores.length * 100) : null;
        console.log('[TSN ANALYZER] 📨 Надсилаю пост-вставковий звіт «мало пауз»:', { videoTitle, goodShare, ok });
        chrome.runtime.sendMessage({
          action: 'mra_tg_report',
          report: {
            kind: 'analysis_warn',
            ts: Date.now(),
            videoTitle,
            videoId: videoId,
            videoUrl: window.location.href,
            videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
            analysis: meta,
            selectedCount: state.selected.length,
            marksOnVideo,
            qualityAvg,
            // Ризиковані мітки (фактичний стан після вставки): нижче межі прийняття YT,
            // не підказка YT і не якір YT
            marks: state.selected.filter(s => !s.ytHint && !s.fromYt && Number(s.quality_score ?? 0) < ytAcceptNow).slice(0, 25).map(s => ({
              tc: s.timecode,
              backup: !!s.fallbackSpot,
              risky: true,
              quality: s.quality_label || '',
              score: typeof s.quality_score === 'number' ? Math.round(s.quality_score * 100) : null,
              pauseSec: (typeof s.duration_sec === 'number' && s.duration_sec > 0) ? s.duration_sec : null
            })),
            totalPlanned: ok + fail, ok, fail, events: []
          }
        }, async (res) => {
          if (chrome.runtime.lastError) { console.warn('[TSN ANALYZER] ⚠️ Звіт «мало пауз»: помилка каналу —', chrome.runtime.lastError.message); return; }
          if (!res || !res.ok) return;
          await markReported();
        });
      }
    } catch (e) {
      console.error('[TSN ANALYZER] ❌ Error sending post-insert report:', e);
    }

    // Autosave: click Continue and Save
    if (!aborted && fail === 0 && ok > 0 && CONFIG.autoSaveAfterInsert) {
      try {
        log('Starting autosave (Continue + Save)...', 'info');
        await autoSaveFlow();
      } catch (e) {
        log('Autosave error: ' + e.message, 'warn');
      }
    } else if (!aborted && ok > 0 && !CONFIG.autoSaveAfterInsert) {
      updateStatus(`✅ Вставлено ${ok} міток. Натисніть «Продовжити» та «Зберегти» вручну! 💾`, 'warn');
    }
  }
}
