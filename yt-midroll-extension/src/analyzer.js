// ─── АНАЛІЗ АУДІО ────────────────────────────────────────────────────────────

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

  return {
    centerSec: (bestStart + spanB / 2) * secPerBlock,
    avgAmp: bestAvg
  };
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
  // Авто-пілот: емпірична межа YouTube — паузи слабші ~55% він позначає червоним
  // ("навряд чи показуватиметься"), тому такі навіть не ставимо.
  const qualityFloor = CONFIG.autoGap
    ? 0.55
    : Math.min(0.9, Math.max(0, (CONFIG.minQualityPct ?? 0) / 100));

  // Підказки YouTube (перехоплені сніфером): позиції, які YT сам вважає природними.
  // Одиниці невідомі заздалегідь (мс чи с) — нормуємо за тривалістю відео.
  const ytHints = (() => {
    const raw = state.ytAdHintsRaw?.times;
    if (!Array.isArray(raw) || raw.length < 3) return [];
    const maxT = Math.max(...raw);
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

    let currentSilenceStart = null;
    const rawSilences = [];

  for (let b = 0; b < totalBlocks; b++) {
    const isQuiet = smoothed[b] < GLOBAL_THRESHOLD;

    if (isQuiet && currentSilenceStart === null) {
      currentSilenceStart = b;
    } else if (!isQuiet && currentSilenceStart !== null) {
      const silenceBlocks = b - currentSilenceStart;
      const silenceSecs = silenceBlocks * secPerBlock;

      if (silenceSecs >= minS) {
        let minAmpVal = Infinity;
        let maxAmpVal = 0;
        let sumAmpVal = 0;
        for (let j = currentSilenceStart; j < b; j++) {
          if (smoothed[j] < minAmpVal) { minAmpVal = smoothed[j]; }
          if (smoothed[j] > maxAmpVal) { maxAmpVal = smoothed[j]; }
          sumAmpVal += smoothed[j];
        }
        const avgAmpVal = sumAmpVal / silenceBlocks;

        const idealBlocks = Math.max(1, Math.round(minS / secPerBlock));
        let bestStart = currentSilenceStart;
        let bestAvg = Infinity;

        if (silenceBlocks > idealBlocks) {
          let rollingSum = 0;
          for (let j = currentSilenceStart; j < currentSilenceStart + idealBlocks; j++) rollingSum += smoothed[j];
          bestAvg = rollingSum / idealBlocks;

          for (let start = currentSilenceStart + 1; start <= b - idealBlocks; start++) {
            rollingSum += smoothed[start + idealBlocks - 1] - smoothed[start - 1];
            const avg = rollingSum / idealBlocks;
            if (avg < bestAvg) {
              bestAvg = avg;
              bestStart = start;
            }
          }
        } else {
          bestAvg = avgAmpVal;
        }

        const bestCenterBlock = bestStart + Math.min(silenceBlocks, idealBlocks) / 2;
        const pauseCenter = bestCenterBlock * secPerBlock;

        // Ігноруємо захисну зону на початку
        if (pauseCenter >= startOffset) {
          rawSilences.push({
            timecode: toTimecode(pauseCenter),
            seconds: +pauseCenter.toFixed(2),
            duration_sec: +silenceSecs.toFixed(1),
            ideal_duration_sec: +Math.min(silenceSecs, minS).toFixed(1),
            amplitude: +minAmpVal.toFixed(4),
            avg_amplitude: +avgAmpVal.toFixed(4),
            best_avg_amplitude: +bestAvg.toFixed(4),
            max_amplitude: +maxAmpVal.toFixed(4)
          });
        }
      }
      currentSilenceStart = null;
    }
  }

  // Якщо відео закінчилось паузою
  if (currentSilenceStart !== null) {
    const silenceBlocks = totalBlocks - currentSilenceStart;
    const silenceSecs = silenceBlocks * secPerBlock;
    if (silenceSecs >= minS) {
      const pauseCenter = (currentSilenceStart + (totalBlocks - currentSilenceStart) / 2) * secPerBlock;
      if (pauseCenter >= startOffset) {
        let minAmpVal = Infinity;
        let maxAmpVal = 0;
        let sumAmpVal = 0;
        for (let j = currentSilenceStart; j < totalBlocks; j++) {
          if (smoothed[j] < minAmpVal) { minAmpVal = smoothed[j]; }
          if (smoothed[j] > maxAmpVal) { maxAmpVal = smoothed[j]; }
          sumAmpVal += smoothed[j];
        }
        const avgAmpVal = sumAmpVal / silenceBlocks;

        const idealBlocks = Math.max(1, Math.round(minS / secPerBlock));
        let bestStart = currentSilenceStart;
        let bestAvg = Infinity;

        if (silenceBlocks > idealBlocks) {
          let rollingSum = 0;
          for (let j = currentSilenceStart; j < currentSilenceStart + idealBlocks; j++) rollingSum += smoothed[j];
          bestAvg = rollingSum / idealBlocks;

          for (let start = currentSilenceStart + 1; start <= totalBlocks - idealBlocks; start++) {
            rollingSum += smoothed[start + idealBlocks - 1] - smoothed[start - 1];
            const avg = rollingSum / idealBlocks;
            if (avg < bestAvg) {
              bestAvg = avg;
              bestStart = start;
            }
          }
        } else {
          bestAvg = avgAmpVal;
        }

        const bestCenterBlock = bestStart + Math.min(silenceBlocks, idealBlocks) / 2;
        const bestCenter = bestCenterBlock * secPerBlock;

        rawSilences.push({
          timecode: toTimecode(bestCenter),
          seconds: +bestCenter.toFixed(2),
          duration_sec: +silenceSecs.toFixed(1),
          ideal_duration_sec: +Math.min(silenceSecs, minS).toFixed(1),
          amplitude: +minAmpVal.toFixed(4),
          avg_amplitude: +avgAmpVal.toFixed(4),
          best_avg_amplitude: +bestAvg.toFixed(4),
          max_amplitude: +maxAmpVal.toFixed(4)
        });
      }
    }
  }

    const getPauseQuality = (p) => {
      const thresholdSafe = Math.max(GLOBAL_THRESHOLD, 0.000001);
      const bestAvg = Number(p.best_avg_amplitude ?? p.avg_amplitude ?? p.amplitude ?? GLOBAL_THRESHOLD);
      const avgAmpVal = Number(p.avg_amplitude ?? bestAvg);
      const peakAmp = Number(p.max_amplitude ?? bestAvg);
      const durationSec = Number(p.duration_sec) || 0;

      const coreQuiet = clamp01((GLOBAL_THRESHOLD - bestAvg) / thresholdSafe);
      const avgQuiet = clamp01((GLOBAL_THRESHOLD - avgAmpVal) / thresholdSafe);
      const peakClean = clamp01((GLOBAL_THRESHOLD - peakAmp) / thresholdSafe);
      const durationFit = clamp01(durationSec / Math.max(minS * 2, minS + 0.001));

      return clamp01(coreQuiet * 0.55 + avgQuiet * 0.2 + peakClean * 0.2 + durationFit * 0.05);
    };

    rawSilences.forEach(p => {
      const quality = getPauseQuality(p);
      p.quality_score = +quality.toFixed(3);
      p.quality_label = quality >= 0.78 ? 'люкс' : (quality >= 0.55 ? 'добра' : 'ок');
    });

    return { rawSilences, threshold: GLOBAL_THRESHOLD };
  };

  // Розстановка міток за ритмом gap по знайдених паузах
  const runSelection = (rawSilences, minS) => {
    const selectedCands = [];
    const usedPauses = new Set();
    const usedHints = new Set();
    const sortedSilences = [...rawSilences].sort((a, b) => a.seconds - b.seconds);
    let playhead = 0;

  while (true) {
    let currentGap = gap;
    if (CONFIG.focusStart) {
      const pos = playhead / duration;
      // Буст x2 на початку: від gap*0.5 (початок) до gap*1.0 (кінець)
      // pos=0 → target вдвічі ближче, тому паузи ставляться частіше
      // pos=1 → звичайна відстань
      currentGap = gap * (0.5 + pos * 0.5);
      // Авто-пілот: буст лише ПЕРЕРОЗПОДІЛЯЄ щільність (частіше на початку,
      // рідше в кінці), а сумарна кількість тримається ≈ цілі idealAds.
      // 2·ln2 ≈ 1.386 — нормування середньої щільності буста до 1/gap.
      if (CONFIG.autoGap) currentGap *= 1.386;
    }

    let target = playhead + currentGap;

    // Не ставимо рекламу в захисну зону наприкінці відео
    if (target > duration - endOffset) break;

    // Вікно пошуку ±flex від gap — при 50% вікна стикуються без мертвих зон
    const windowStart = target - (currentGap * flex);
    const windowEnd = target + (currentGap * flex);

    let bestPause = null;
    let bestScore = -Infinity;

    // Пріоритет №1: підказка YouTube у вікні — це місце YT гарантовано вважає
    // природним і не позначить червоним
    if (ytHints.length) {
      let bestHint = null, bestHintDist = Infinity;
      for (const hs of ytHints) {
        if (hs < windowStart || hs > windowEnd || usedHints.has(hs)) continue;
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
          amplitude: 0, avg_amplitude: 0, best_avg_amplitude: 0, max_amplitude: 0,
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

    // "Тільки ідеальні": якщо найкраща пауза у вікні слабка («ок» < 55%),
    // шукаємо трохи ширше паузу рівня «добра/люкс» — невелике зміщення ритму
    // краще за рекламу в сумнівній напівпаузі.
    if (bestPause && Number(bestPause.quality_score ?? 0) < 0.55) {
      const wideStart = Math.max(playhead + currentGap * 0.4, startOffset);
      const wideEnd = Math.min(target + currentGap * flexWide, duration - endOffset);
      const upgradeFloor = Math.max(0.55, qualityFloor);
      let upgrade = null;
      let upgradeScore = -Infinity;

      for (const p of sortedSilences) {
        if (usedPauses.has(p) || p.seconds < wideStart || p.seconds > wideEnd) continue;
        const q = Number(p.quality_score ?? 0);
        if (q < upgradeFloor) continue;

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
      const spot = findQuietestSpot(
        smoothed, secPerBlock,
        Math.max(windowStart, startOffset),
        Math.min(windowEnd, duration - endOffset),
        Math.max(0.8, Math.min(minS, 2))
      );
      const farEnough = spot && !selectedCands.some(c => Math.abs(c.seconds - spot.centerSec) < 3);
      if (farEnough) {
        const relQuiet = clamp01(1 - spot.avgAmp / Math.max(avgAbs, 0.000001));
        bestPause = {
          timecode: toTimecode(spot.centerSec),
          seconds: +spot.centerSec.toFixed(2),
          duration_sec: 0,
          ideal_duration_sec: 0,
          amplitude: +spot.avgAmp.toFixed(4),
          avg_amplitude: +spot.avgAmp.toFixed(4),
          best_avg_amplitude: +spot.avgAmp.toFixed(4),
          max_amplitude: +spot.avgAmp.toFixed(4),
          quality_score: +relQuiet.toFixed(3),
          quality_label: 'запасна',
          fallbackSpot: true
        };
        log(`🛟 Пауз немає у вікні ${toTimecode(windowStart)}–${toTimecode(windowEnd)} → запасна мітка в найтихішому місці: ${bestPause.timecode}`, 'warn');
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
  const ladder = CONFIG.autoGap
    ? [
      { minS: baseMinS, thr: baseThr },
      { minS: Math.min(baseMinS, 1.2), thr: Math.min(baseThr + 5, 45) },
      { minS: Math.min(baseMinS, 1.0), thr: Math.min(baseThr + 10, 45) },
      { minS: Math.min(baseMinS, 0.8), thr: Math.min(baseThr + 15, 45) },
    ]
    : [{ minS: baseMinS, thr: baseThr }];

  let best = null;
  for (let li = 0; li < ladder.length; li++) {
    const lv = ladder[li];
    const det = runDetection(lv.minS, lv.thr);
    const cands = runSelection(det.rawSilences, lv.minS);
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
      timeline += isPause ? '🔇' : (smoothed[i] < best.det.threshold ? '░' : '█');
    }
    console.log('%c📍 Розташування пауз на тімлайні:', 'color:#06d6a0;font-weight:bold');
    console.log(`  ${timeline}`);
  }

  state.selected = best.cands;
  state.selected.sort((a, b) => a.seconds - b.seconds);

  // Дедуплікація: видаляємо мітки ближче ніж 3 секунди одна від одної
  state.selected = state.selected.filter((s, i, arr) =>
    i === 0 || s.seconds - arr[i - 1].seconds >= 3
  );

  const backupCount = state.selected.filter(s => s.fallbackSpot).length;
  const realCnt = state.selected.length - backupCount;

  // Підсумок авто-пілота для діагнозу відео (рендериться під статистикою)
  state.analysisMeta = {
    idealAds,
    gap: Math.round(gap),
    escalated: best.level > 0,
    finalThr: best.thr,
    finalMinS: best.minS,
    pausesFound: rawSilences.length,
    realPauses: realCnt,
    backupCount
  };

  console.group('%c🎬 [MRA] Відібрані позиції', 'color:#06d6a0;font-weight:bold');
  state.selected.forEach((s, i) =>
    console.log(s.fallbackSpot
      ? `  ${i + 1}. ${s.timecode}  (запасна — найтихіше місце, чистої паузи немає)`
      : `  ${i + 1}. ${s.timecode}  (пауза: ${s.duration_sec}с, якість: ${Math.round((s.quality_score ?? 0) * 100)}%, амп: ${s.amplitude})`)
  );
  if (state.selected.length === 0)
    console.log('  ⚠️ Не вдалось знайти підходящих пауз з таким інтервалом та параметрами!');
  console.groupEnd();

  const gapR = Math.round(gap);
  log(`Відібрано ${state.selected.length}/${idealAds} місць (природних: ${realCnt}, запасних: ${backupCount}, ритм ~${gapR}с${best.level > 0 ? `, бот підняв чутливість до ${best.thr}%` : ''})`, state.selected.length > 0 ? 'success' : 'warn');
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
  try {
    const meta = state.analysisMeta;
    if (!meta || !meta.idealAds) return;
    const share = (meta.realPauses || 0) / meta.idealAds;
    // Звітуємо ЛИШЕ коли вердикт гірший за «ДОБРЕ» — той самий поріг, що й на панелі (render.js).
    // share вже враховує і запасні мітки, і нестачу (природних ≤ поставлених), тому окремої
    // перевірки нестачі не треба — інакше 7/8 суцільно природних міток лякало б даремно.
    if (share >= 0.6) return;

    const videoIdMatch = window.location.pathname.match(/\/video\/([^/]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : (state.waveformUrl || 'unknown').slice(-40);

    // Дедуплікація: не частіше ніж раз на 12 год на відео (читаємо тут, позначаємо ЛИШЕ після успішної відправки)
    const { tgAnalysisReported } = await chrome.storage.local.get('tgAnalysisReported');
    const map = tgAnalysisReported || {};
    if (map[videoId] && Date.now() - map[videoId] < 12 * 3600 * 1000) {
      console.log('[TSN ANALYZER] 📨 Аналіз-звіт уже надсилався для', videoId, '— пропускаю (дедуплікація 12г)');
      return;
    }

    const videoTitle = getVideoTitle();
    console.log('[TSN ANALYZER] 📨 Надсилаю аналіз-звіт (складний монтаж/мало міток):', { videoTitle, share, selected: state.selected.length, ideal: meta.idealAds });
    chrome.runtime.sendMessage({
      action: 'mra_tg_report',
      report: {
        kind: 'analysis_warn',
        ts: Date.now(),
        videoTitle,
        videoId: videoIdMatch ? videoIdMatch[1] : '',
        videoUrl: window.location.href,
        videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
        analysis: meta,
        selectedCount: state.selected.length,
        marks: state.selected.slice(0, 10).map(s => ({ tc: s.timecode, backup: !!s.fallbackSpot, quality: s.quality_label || '' })),
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

var YT_FLAG_TEXT_FRAGMENTS = [
  'перемістіть рекламне місце', 'навряд чи показуватиметься', 'природних паузах',
  'move the ad break', 'unlikely to be shown', 'natural pauses',
  'переместите рекламное место', 'вряд ли будет показываться'
];

function getAdBreakRows() {
  const rows = [];
  getAdBreakDeleteButtons().forEach(btn => {
    const row = btn.closest('ytve-ad-break-row')
      || btn.closest('div[role="row"]')
      || btn.closest('div.style-scope.ytve-ad-breaks-editor')
      || btn.parentElement;
    const input = row ? row.querySelector('input') : null;
    if (row && input && !rows.some(r => r.row === row)) rows.push({ row, input, btn });
  });
  return rows;
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

  const cands = (state.silences || [])
    .filter(p => !excludeSecs.some(x => Math.abs(x - p.seconds) < 3))
    .map(p => ({ p, d: Math.abs(p.seconds - badSec) }))
    .filter(c => c.d > 0.5 && c.d <= 45)
    .sort((a, b) => (a.d - (a.p.quality_score || 0) * 30) - (b.d - (b.p.quality_score || 0) * 30));
  return cands.length ? cands[0].p : null;
}

async function verifyAndFixFlaggedBreaks() {
  await sleep(1500);

  let rows = getAdBreakRows();
  if (!rows.length) {
    log('🩺 Перевірка YT: рядків міток у редакторі не знайдено', 'warn');
    return { checked: 0, flagged: 0, fixed: 0, removed: 0 };
  }

  // YT оцінює рядки асинхронно — на великій кількості міток вердикти
  // з'являються із запізненням, даємо пропорційний запас
  if (rows.length > 8) {
    await sleep(Math.min(3000, rows.length * 70));
    rows = getAdBreakRows();
  }

  let flagged = rows.filter(r => isAdBreakRowFlagged(r.row));
  log(`🩺 Перевірка YT: міток ${rows.length}, з попередженням YouTube: ${flagged.length}`, flagged.length ? 'warn' : 'success');

  if (!flagged.length) {
    updateStatus('🩺 YouTube прийняв усі мітки (червоних попереджень немає)', 'success');
    return { checked: rows.length, flagged: 0, fixed: 0, removed: 0 };
  }

  updateStatus(`🩺 YouTube позначив ${flagged.length} міток. Пересуваємо у природні паузи...`, 'info');
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  let fixed = 0;

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

    if (!cleared) {
      log(`🩺 ${fr.input.value}: YT-попередження не зникло — поряд немає паузи, яку YouTube вважає природною`, 'warn');
      // ── Telegram: мітку не вдалось пересунути (3 спроби) ──
      state.tgEvents.push({ type: 'yt_flag_stuck', atTc: fr.input.value });
    }
  }

  // ФІНАЛЬНА ЗАЧИСТКА (авто-пілот): мітки, які YouTube так і не прийняв, видаляємо.
  // Червона мітка все одно не покаже рекламу — краще менше міток, але всі робочі.
  let removed = 0;
  if (CONFIG.autoGap && !state.insertAbort) {
    await sleep(800); // даємо YT домалювати вердикти після пересувань
    const stillFlagged = getAdBreakRows().filter(r => isAdBreakRowFlagged(r.row));

    for (const fr of stillFlagged) {
      if (state.insertAbort) break;
      const tcLabel = fr.input.value;
      const sec = fromTimecode(tcLabel);

      fr.btn.click();
      await waitFor(() => !document.contains(fr.row), 1500);
      removed++;

      if (sec != null) {
        const i = state.selected.findIndex(s => Math.abs(s.seconds - sec) < 1);
        if (i >= 0) state.selected.splice(i, 1);
      }
      log(`🗑️ ${tcLabel}: YouTube не прийняв це місце — мітку видалено`, 'warn');
      // ── Telegram: мітку видалено бо YouTube не прийняв ──
      state.tgEvents.push({ type: 'yt_flag_removed', atTc: tcLabel });
    }
  }

  state.selected.sort((a, b) => a.seconds - b.seconds);
  renderSelectedList();
  renderWaveform();

  const remaining = flagged.length - fixed - removed;
  const parts = [];
  if (fixed) parts.push(`${fixed} переміщено`);
  if (removed) parts.push(`${removed} видалено`);
  updateStatus(
    remaining <= 0
      ? `🩺 Вердикт YT: ${parts.join(', ') || 'все чисто'}. Лишилось міток: ${getAdBreakRows().length} — всі робочі`
      : `🩺 Вердикт YT: ${parts.join(', ')}. Червоних лишилось: ${remaining}`,
    remaining <= 0 ? 'success' : 'warn'
  );

  return { checked: rows.length, flagged: flagged.length, fixed, removed };
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

    // Даємо редактору дозавантажитись, потім перевіряємо, що відео ще без міток
    await sleep(2500);
    if (!document.getElementById('mra-panel')) return;
    if (getAdBreakDeleteButtons().length > 0) {
      log('⚡ Авто-вставка: на відео вже є мітки — вставку пропускаю (нічого не чіпаю)', 'info');
      // Але аналіз все одно запускаємо: якщо монтаж складний — Telegram-звіт піде і без вставки
      // (maybeSendAnalysisReport усередині analyzeWaveform, з дедуплікацією 12 год по відео)
      if (!state.analysisMeta && !state.analyzing) {
        log('⚡ Запускаю аналіз лише для звіту (без вставки)...', 'info');
        try { await analyzeWaveform(); } catch (e) { log('⚡ Аналіз для звіту не вдався: ' + e.message, 'warn'); }
      }
      return;
    }

    log('⚡ Авто-вставка: запускаю повний цикл (аналіз → вставка → перевірка YT → збереження)', 'success');
    showHud('⚡ Повний автопілот: аналізую відео...', 'info', 2500);

    const ok = await analyzeWaveform();
    if (!ok || !state.selected.length) {
      log('⚡ Авто-вставка: аналіз не дав позицій — зупиняюсь', 'warn');
      // ── Telegram: КРИТИЧНО — мітки поставити нікуди (монтаж встик) ──
      try {
        if (ok) { // аналіз пройшов, але позицій нема — це «встик», а не технічний збій
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

  let ok = 0, fail = 0;

  try {
    updateStatus(`⏳ Вставляємо ${pendingSilences.length} нових міток...`, 'info');
    updateProgress(0, pendingSilences.length);
    showStopButton(true);

    for (let idx = 0; idx < pendingSilences.length; idx++) {
      if (state.insertAbort) {
        log(`⛔ Вставку зупинено користувачем після ${ok} міток`, 'warn');
        break;
      }
      const s = pendingSilences[idx];
      log(`[${idx + 1}/${pendingSilences.length}] Вставка: ${s.timecode}`, 'info');

      try {
        // 1. Запам'ятовуємо кількість міток ДО
        const deleteBtnsBefore = getAdBreakDeleteButtons();

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
          // Studio синхронізує плейхед асинхронно; хибний час нижче все одно виправляється
          await sleep(document.hidden ? 900 : 400);
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
        await sleep(document.hidden ? 250 : 120); // мікро-осідання DOM після появи рядка

        // ----------------------------------------------------------------------
        // ПЕРЕВІРКА ЧАСУ: звіряємо останній доданий рядок з нашим таймкодом.
        // Ловить і фоновий глюк 00:00, і недосинхронізований плейхед на швидкому темпі.
        // ----------------------------------------------------------------------
        const currentDeleteBtns = getAdBreakDeleteButtons();
        if (currentDeleteBtns.length > 0) {
            const lastDeleteBtn = currentDeleteBtns[currentDeleteBtns.length - 1];
            const row = lastDeleteBtn.closest('ytve-ad-break-row') || lastDeleteBtn.closest('div[role="row"]') || lastDeleteBtn.closest('div.style-scope.ytve-ad-breaks-editor');

            if (row) {
                const rowInput = row.querySelector('input');
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
        }
        // ----------------------------------------------------------------------

        // 6. ВИДАЛЕННЯ ДУБЛІКАТІВ
        const deleteBtnsAfter = getAdBreakDeleteButtons();
        const created = deleteBtnsAfter.length - deleteBtnsBefore.length;

        if (created > 1) {
          log(`⚠️ YouTube створив ${created} записів замість 1, видаляємо ${created - 1} зайвих...`, 'warn');
          for (let d = 0; d < created - 1; d++) {
            const beforeDel = getAdBreakDeleteButtons();
            if (beforeDel.length > 0) {
              beforeDel[beforeDel.length - 1].click();
              // Чекаємо ФАКТ: рядок зник зі списку
              await waitFor(() => getAdBreakDeleteButtons().length < beforeDel.length, 1500);
            }
          }
          await sleep(150);
        }

        s.inserted = true;
        renderSelectedList();

        ok++;
        updateProgress(ok, pendingSilences.length);
        log(`✅ ${s.timecode} вставлено`, 'success');
        await sleep(document.hidden ? 700 : 250); // коротке осідання — факт вставки вже перевірено
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
    } else {
      updateStatus(
        fail === 0 ? `🏁 Готово! ${ok} нових міток вставлено. Натисніть "Зберегти"!` : `⚠️ Вставлено: ${ok}, помилок: ${fail}`,
        fail === 0 ? 'success' : 'warn'
      );
    }
    updateProgress(ok, pendingSilences.length);

    // Перевірка вердикту YouTube: пересуваємо мітки з попередженням у природні паузи
    if (!aborted && ok > 0) {
      try {
        await verifyAndFixFlaggedBreaks();
      } catch (e) {
        log('🩺 Перевірка YT не вдалася: ' + e.message, 'warn');
      }
    }

    // ── Telegram-звіт про проблемні мітки ──
    try {
      const problems = state.tgEvents.filter(ev => ev.type !== 'yt_flag_moved');
      const meta = state.analysisMeta || {};
      const tightCut = (meta.idealAds || 0) > 0 && ((meta.realPauses || 0) / meta.idealAds) < 0.3;
      if (fail > 0 || problems.length > 0 || tightCut) {
        const videoTitle = getVideoTitle();
        const videoIdMatch = window.location.pathname.match(/\/video\/([^/]+)/);
        console.log('[TSN ANALYZER] 📨 Sending "insert problems" Telegram report:', { videoTitle, fail, problems: problems.length, tightCut });
        chrome.runtime.sendMessage({
          action: 'mra_tg_report',
          report: {
            kind: 'insert',
            ts: Date.now(),
            videoTitle,
            videoId: videoIdMatch ? videoIdMatch[1] : '',
            videoUrl: window.location.href,
            videoDurationSec: (state.waveformData && state.waveformData.duration) || 0,
            totalPlanned: ok + fail,
            ok, fail,
            events: state.tgEvents,
            analysis: state.analysisMeta || null
          }
        });
      }
    } catch (e) {
      console.error('[TSN ANALYZER] ❌ Error sending "insert problems" report:', e);
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
