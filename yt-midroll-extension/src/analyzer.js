// ─── АНАЛІЗ АУДІО ────────────────────────────────────────────────────────────

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
  if (!video) {
    updateStatus('❌ Відео не знайдено на сторінці', 'error');
    return false;
  }

  const duration = video.duration;

  if (!isValidNumber(duration)) {
    updateStatus('❌ Некоректна тривалість відео (NaN/Infinity/0)', 'error');
    log(`Некоректна тривалість: ${duration}. Можливо, відео ще завантажується.`, 'error');
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

  // ── Глобальний пошук справжніх пауз ──────────────────────────────────────────
  const gap = CONFIG.autoGap
    ? (duration < CONFIG.shortVideoCutoff ? CONFIG.shortVideoGapSec : CONFIG.longVideoGapSec)
    : CONFIG.minGapSec;

  const maxAmp = arrayMax(smoothed);

  // Пороговий рівень тиші на основі середньої амплітуди
  // silenceThresholdPct % від середнього рівня гучності мови
  // Якщо диктор говорить рівно, порог = X% від середніх показників → надійніше за перцентиль
  const thresholdFromMean = avgAbs * (CONFIG.silenceThresholdPct / 100);
  // Також беремо перцентиль як нижню границю (щоб не пропустити дуже тихі місця)
  const thresholdFromPercentile = getPercentile(smoothed, Math.max(0.01, Math.min(0.99, CONFIG.silenceThresholdPct / 100)));
  // Беремо ВИЩЕ з двох — щоб більше пауз знаходилось
  const GLOBAL_THRESHOLD = Math.max(thresholdFromMean, thresholdFromPercentile);

  console.group('%c🔍 АНАЛІЗ ПОРОГІВ', 'color:#ffd166;font-weight:bold');
  console.log(`  Max амплітуда:       ${maxAmp.toFixed(4)}`);
  console.log(`  Середня (avgAbs):    ${avgAbs.toFixed(4)}`);
  console.log(`  Поріг (mean-based):  ${thresholdFromMean.toFixed(4)}`);
  console.log(`  Поріг (перцентиль):  ${thresholdFromPercentile.toFixed(4)}`);
  console.log(`  АКТИВНИЙ поріг:      ${GLOBAL_THRESHOLD.toFixed(4)} (вищий з двох)`);
  console.groupEnd();

  // Знаходимо ВІДРІЗКИ ТИШІ
  let currentSilenceStart = null;
  const rawSilences = [];
  const minS = CONFIG.minSilenceSec ?? 3.0;

  for (let b = 0; b < totalBlocks; b++) {
    const isQuiet = smoothed[b] < GLOBAL_THRESHOLD;

    if (isQuiet && currentSilenceStart === null) {
      currentSilenceStart = b;
    } else if (!isQuiet && currentSilenceStart !== null) {
      const silenceBlocks = b - currentSilenceStart;
      const silenceSecs = silenceBlocks * secPerBlock;

      if (silenceSecs >= minS) {
        let minAmpVal = Infinity;
        for (let j = currentSilenceStart; j < b; j++) {
          if (smoothed[j] < minAmpVal) { minAmpVal = smoothed[j]; }
        }

        const pauseCenter = (currentSilenceStart + (b - currentSilenceStart) / 2) * secPerBlock;

        // Ігноруємо перші 10 секунд
        if (pauseCenter >= 10) {
          rawSilences.push({
            timecode: toTimecode(pauseCenter),
            seconds: +pauseCenter.toFixed(2),
            duration_sec: +silenceSecs.toFixed(1),
            amplitude: +minAmpVal.toFixed(4)
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
      if (pauseCenter >= 10) {
        rawSilences.push({
          timecode: toTimecode(pauseCenter),
          seconds: +pauseCenter.toFixed(2),
          duration_sec: +silenceSecs.toFixed(1),
          amplitude: 0
        });
      }
    }
  }

  log(`Знайдено ${rawSilences.length} пауз ≥${minS}с (пор. ${CONFIG.silenceThresholdPct}%, з них буде відібрано найкращі)`, rawSilences.length > 0 ? 'success' : 'warn');
  updateStatus(`🔍 Знайдено ${rawSilences.length} пауз. Відбираємо оптимальні...`, 'info');

  // Візуалізація знайдених пауз на тімлайні (консоль)
  if (rawSilences.length > 0) {
    const stepViz = Math.max(1, Math.floor(totalBlocks / 80));
    let timeline = '';
    for (let i = 0; i < totalBlocks; i += stepViz) {
      const timeSec = i * secPerBlock;
      const isPause = rawSilences.some(p => Math.abs(p.seconds - timeSec) < 5);
      timeline += isPause ? '🔇' : (smoothed[i] < GLOBAL_THRESHOLD ? '░' : '█');
    }
    console.log('%c📍 Розташування пауз на тімлайні:', 'color:#06d6a0;font-weight:bold');
    console.log(`  ${timeline}`);
    console.log(`  🔇 = знайдена пауза | ░ = тихо | █ = гучно\n`);
  }

  // ── Рівномірний відбір пауз по всьому відео (Гарантована реклама в кінці) ──
  const selectedCands = [];
  const usedPauses = new Set();

  // Сортуємо сирі паузи за часом для послідовного пошуку
  const sortedSilences = [...rawSilences].sort((a, b) => a.seconds - b.seconds);

  let playhead = 0; // Позиція останньої доданої реклами (або 0)

  while (true) {
    let currentGap = gap;
    if (CONFIG.focusStart) {
      const pos = playhead / duration;
      // Буст x2 на початку: від gap*0.5 (початок) до gap*1.0 (кінець)
      // pos=0 → target вдвічі ближче, тому паузи ставляться частіше
      // pos=1 → звичайна відстань
      currentGap = gap * (0.5 + pos * 0.5);
    }

    let target = playhead + currentGap;

    // Не ставимо рекламу в самі останні 15 секунд відео
    if (target > duration - 15) break;

    // Вікно пошуку ±50% від gap — гарантує ПОВНЕ покриття без мертвих зон
    // При ±40% між вікнами під час пропусків залишалась 70% мертва зона!
    const windowStart = target - (currentGap * 0.5);
    const windowEnd = target + (currentGap * 0.5);

    let bestPause = null;
    let bestScore = -Infinity;

    for (const p of sortedSilences) {
      if (usedPauses.has(p)) continue;

      // Якщо пауза потрапляє у "вікно"
      if (p.seconds >= windowStart && p.seconds <= windowEnd) {
        const distance = Math.abs(p.seconds - target);
        const distancePenalty = Math.pow(distance / (currentGap * 0.5), 2);

        // Оцінюємо якість (довша = краще, гучніша = гірше, дальша від центру = гірше)
        const score = p.duration_sec * 2 - (p.amplitude * 20) - distancePenalty;

        if (score > bestScore) {
          bestScore = score;
          bestPause = p;
        }
      }
    }

    // Fallback: ширше вікно — до +80% gap вперед
    if (!bestPause) {
      const looseEnd = target + currentGap * 0.8;
      const fallback = sortedSilences.find(p => !usedPauses.has(p) && p.seconds >= windowStart && p.seconds <= looseEnd);
      if (fallback) bestPause = fallback;
    }

    // Якщо НІЧОГО не знайдено — просуваємо playhead рівно на currentGap
    // ⚠️ КРИТИЧНО: playhead = target (а не target + 0.5*gap!)
    // Це гарантує що наступне вікно ПОЧИНАЄТЬСЯ там де ЗАКІНЧИЛОСЬ поточне
    // і між вікнами НЕМАЄ мертвих зон куди можуть падати паузи!
    if (!bestPause) {
      playhead = target; // = playhead + currentGap → вікна стикуються ідеально
      if (playhead > duration - 15) break;
      log(`⚠️ Не знайдено паузи у вікні ${toTimecode(windowStart)}–${toTimecode(windowEnd)}, слот пропущено`, 'warn');
      continue;
    }

    // Додаємо відібрану паузу (тільки реальна тиша)
    if (bestPause.seconds < duration - 15) {
      selectedCands.push(bestPause);
      usedPauses.add(bestPause);
      playhead = bestPause.seconds;
    } else {
      break;
    }
  }

  log(`Автоматично відібрано ${selectedCands.length} позицій (playhead gap ~${gap}с)`, 'info');

  state.selected = selectedCands;
  state.selected.sort((a, b) => a.seconds - b.seconds);

  // Дедуплікація: видаляємо мітки ближче ніж 3 секунди одна від одної
  state.selected = state.selected.filter((s, i, arr) =>
    i === 0 || s.seconds - arr[i - 1].seconds >= 3
  );

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

  state.silences = rawSilences;

  // Зберігаємо дані для візуалізації
  state.waveformData = {
    smoothed: smoothed,
    duration: duration,
    totalBlocks: totalBlocks,
    secPerBlock: secPerBlock,
    threshold: GLOBAL_THRESHOLD
  };

  renderSelectedList();
  renderWaveform();
  return true;
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
  updateStatus(`⏳ Вставляємо ${pendingSilences.length} нових міток...`, 'info');
  updateProgress(0, pendingSilences.length);
  showStopButton(true);

  let ok = 0, fail = 0;

  for (let idx = 0; idx < pendingSilences.length; idx++) {
    if (state.insertAbort) {
      log(`⛔ Вставку зупинено користувачем після ${ok} міток`, 'warn');
      break;
    }
    const s = pendingSilences[idx];
    log(`[${idx + 1}/${pendingSilences.length}] Вставка: ${s.timecode}`, 'info');

    try {
      // Запам'ятовуємо кнопки видалення ДО вставки (для виявлення дублів)
      const deleteBtnsBefore = getAdBreakDeleteButtons();
      const inputsBefore = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));

      // 0. Відмотуємо сам плеєр до потрібного часу ПЕРЕД тим як тиснути "+"
      const videoEl = document.querySelector('video');
      if (videoEl) {
        videoEl.currentTime = s.seconds;
        videoEl.dispatchEvent(new Event('timeupdate', { bubbles: true }));
        videoEl.dispatchEvent(new Event('seeked', { bubbles: true }));
        await sleep(400); // Чекаємо щоб YouTube Studio оновив свій внутрішній стан повзунка
      }

      // 1. Клікаємо "Insert ad break"
      const btn = findInsertAdBreakButton();
      if (!btn) throw new Error('Кнопка вставки не знайдена');
      btn.click();
      await sleep(CONFIG.actionDelay);

      // 2. Знаходимо новий input для таймкоду
      let input = null;
      const maxAttempts = 20;
      const baseDelay = 150;

      for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT' &&
          (activeEl.classList.contains('ytcp-media-timestamp-input') || activeEl.placeholder?.includes('00:00'))) {
          input = activeEl;
          break;
        }

        const inputsAfter = Array.from(document.querySelectorAll('input.ytcp-media-timestamp-input, input[type="text"]'));
        const newInputs = inputsAfter.filter(el =>
          !inputsBefore.includes(el) &&
          (el.classList.contains('ytcp-media-timestamp-input') || el.placeholder?.includes('00:00'))
        );
        if (newInputs.length > 0) { input = newInputs[0]; break; }

        if (attempts > 5) {
          const allTimeInputs = inputsAfter.filter(inp =>
            inp.offsetParent !== null &&
            (inp.classList.contains('ytcp-media-timestamp-input') || inp.placeholder?.includes('00:00'))
          );
          if (allTimeInputs.length > 0) { input = allTimeInputs[allTimeInputs.length - 1]; break; }
        }

        await sleep(baseDelay + (attempts * 20));
      }

      if (!input) {
        const allTimeInputs = document.querySelectorAll('input.ytcp-media-timestamp-input, input[placeholder*="00:00"]');
        if (allTimeInputs.length > 0) input = allTimeInputs[allTimeInputs.length - 1];
      }

      if (!input) throw new Error('Поле вводу часу не з\'явилося!');

      if (idx === 0) await sleep(1200);
      else await sleep(200);

      // 3. Агресивний ввід таймкоду (обхід React)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const expectedVal = s.timecode.replace(/[^0-9]/g, '');

      const refreshInput = () => {
        // React часто перемальовує DOM-вузол — шукаємо найсвіжіший інпут
        const allTimeInputs = document.querySelectorAll('input.ytcp-media-timestamp-input, input[placeholder*="00:00"]');
        if (allTimeInputs.length > 0) {
          input = allTimeInputs[allTimeInputs.length - 1];
        }
        return input && document.body.contains(input);
      };

      const checkValue = () => {
        return (input.value || '').replace(/[^0-9]/g, '') === expectedVal;
      };

      const typeTimecode = async (method) => {
        if (!refreshInput()) return false;

        input.focus();
        await sleep(100);
        input.select();
        await sleep(50);

        if (method === 'execCommand') {
          // Спосіб 1: execCommand — найприродніший для React (імітує справжній набір тексту)
          try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, s.timecode);
          } catch (err) { return false; }
        } else {
          // Спосіб 2: Native Setter + ручні події — fallback
          nativeSetter.call(input, s.timecode);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await sleep(300);
        return checkValue();
      };

      // Пробуємо execCommand (найкращий для React)
      let success = await typeTimecode('execCommand');

      // Fallback 1: Native Setter
      if (!success) {
        log('⚠️ execCommand не спрацював, fallback на nativeSetter...', 'warn');
        success = await typeTimecode('nativeSetter');
      }

      // Fallback 2: blur + повторна спроба
      if (!success) {
        log('⚠️ React заблокував ввід, жорсткий retry...', 'warn');
        input.blur();
        await sleep(300);
        success = await typeTimecode('execCommand');
        if (!success) await typeTimecode('nativeSetter');
      }

      await sleep(200);

      // 4. Enter для підтвердження
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(300);

      // 5. Підтвердження діалогу (якщо є)
      const confirmBtn = findConfirmButton();
      if (confirmBtn) { confirmBtn.click(); await sleep(300); }

      await sleep(500);

      // 6. ВИДАЛЕННЯ ДУБЛІКАТІВ: порівнюємо кількість trash-кнопок до і після
      const deleteBtnsAfter = getAdBreakDeleteButtons();
      const newDeleteBtns = deleteBtnsAfter.filter(b => !deleteBtnsBefore.includes(b));
      const created = newDeleteBtns.length;

      if (created > 1) {
        log(`⚠️ YouTube створив ${created} записів замість 1, видаляємо ${created - 1} зайвих...`, 'warn');
        // Видаляємо зайві (залишаємо перший новий, решту — видаляємо)
        for (let d = 1; d < newDeleteBtns.length; d++) {
          newDeleteBtns[d].click();
          await sleep(300);
        }
        await sleep(300);
      }

      s.inserted = true; // Позначаємо мітку як УСПІШНО вставлену
      renderSelectedList(); // Оновлюємо список щоб одразу показати що мітка вставлена

      ok++;
      updateProgress(ok, pendingSilences.length);
      log(`✅ ${s.timecode} вставлено`, 'success');
      await sleep(800);
    } catch (e) {
      fail++;
      log(`❌ ${s.timecode}: ${e.message}`, 'error');
      const closeBtn = document.querySelector('ytcp-dialog [aria-label*="close"], ytcp-dialog .close-button');
      if (closeBtn) { closeBtn.click(); await sleep(500); }
    }
  }

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
}
