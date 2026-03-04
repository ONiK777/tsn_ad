// ─── РЕНДЕР ──────────────────────────────────────────────────────────────────

function showStopButton(show) {
  const insertBtn = document.getElementById('mra-insert');
  let stopBtn = document.getElementById('mra-stop');

  if (show) {
    if (insertBtn) insertBtn.style.display = 'none';
    if (!stopBtn) {
      stopBtn = document.createElement('button');
      stopBtn.id = 'mra-stop';
      stopBtn.textContent = '⛔ ЗУПИНИТИ';
      stopBtn.style.cssText = 'width:100%;padding:10px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;transition:all .2s;margin-bottom:6px;background:#ff6b6b;color:#fff;';
      stopBtn.addEventListener('click', () => { state.insertAbort = true; });
      if (insertBtn) insertBtn.parentNode.insertBefore(stopBtn, insertBtn.nextSibling);
    }
    stopBtn.style.display = '';
  } else {
    if (stopBtn) stopBtn.style.display = 'none';
    if (insertBtn) insertBtn.style.display = '';
  }
}

function renderSelectedList() {
  const list = document.getElementById('mra-list');
  const stats = document.getElementById('mra-stats');
  if (!list) return;

  if (stats && state.waveformData && state.waveformData.duration > 0) {
    stats.style.display = 'block';

    const duration = state.waveformData.duration;

    // СТАНДАРТ ТСН: хронометраж ділимо на 2 (1 реклама кожні 2 хв / 120 сек)
    let idealAds = Math.floor(duration / 120);

    // Ютуб дозволяє мідроли тільки для відео від 8 хвилин (480 сек)
    if (duration < 480) {
      idealAds = 0;
    } else if (idealAds < 1) {
      idealAds = 1;
    }

    const actualAds = state.selected.length;

    let ratioEmoji = '✅ Люкс';
    let ratioColor = '#06d6a0';

    if (duration < 480) {
      ratioEmoji = '⏳ До 8 хв (Без реклами)';
      ratioColor = '#888888';
    } else if (actualAds === 0) {
      ratioEmoji = '❌ Немає';
      ratioColor = '#ff6b6b';
    } else if (actualAds < idealAds) {
      // Суворе правило: якщо менше ділення на 2 — значить погано (мало)
      ratioEmoji = '⚠️ Малувато';
      ratioColor = '#ffd166';
    } else if (actualAds > idealAds + 2) {
      // Якщо напхали на 3 реклами більше ідеалу
      ratioEmoji = '🔥 Густо';
      ratioColor = '#ff6b6b';
    }

    const min = Math.floor(duration / 60);
    const sec = Math.floor(duration % 60);
    const durStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    stats.innerHTML = `
      <span style="color:#888;" title="Хронометраж відео">⏱️ ${durStr}</span>
      &nbsp;|&nbsp;
      <span style="color:#ccc;">Міт.: <b style="color:#fff">${actualAds}</b> <span style="font-size:10px;color:#666;" title="Ідеальна кількість реклам для такого хронометражу">(ідеал ~${idealAds})</span></span> 
      &nbsp;|&nbsp;
      <span style="color:${ratioColor};" title="Статус щільності реклами">${ratioEmoji}</span>
    `;

    // Анімація: блимає 2 рази — тільки коли кількість міток змінилась
    if (lastStatsAdCount !== actualAds) {
      lastStatsAdCount = actualAds;
      try {
        stats.animate([
          { boxShadow: '0 0 0px transparent', borderColor: '#333' },
          { boxShadow: `0 0 12px ${ratioColor}`, borderColor: ratioColor, offset: 0.25 },
          { boxShadow: '0 0 0px transparent', borderColor: '#333', offset: 0.5 },
          { boxShadow: `0 0 12px ${ratioColor}`, borderColor: ratioColor, offset: 0.75 },
          { boxShadow: '0 0 0px transparent', borderColor: '#333' }
        ], {
          duration: 1200,
          easing: 'ease-in-out'
        });
      } catch (e) { }
    }
  } else if (stats) {
    stats.style.display = 'none';
  }

  list.innerHTML = '';
  state.selected.forEach((s, i) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;';

    const numSpan = document.createElement('span');
    numSpan.style.cssText = 'color:#c91c1c;font-weight:bold;';
    numSpan.textContent = `${i + 1}.`;

    const timeSpan = document.createElement('span');
    timeSpan.style.color = '#e0e0e0';
    timeSpan.textContent = s.timecode;

    const durSpan = document.createElement('span');
    durSpan.style.cssText = 'color:#888;font-size:11px;';
    durSpan.textContent = `(${s.duration_sec}с)`;

    item.appendChild(numSpan);
    item.appendChild(timeSpan);
    item.appendChild(durSpan);

    if (s.manual) {
      const badge = document.createElement('span');
      badge.style.cssText = 'color:#ffffff;font-size:10px;';
      badge.title = 'Вручну додано';
      badge.textContent = '✋';
      item.appendChild(badge);
    }

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'margin-left:auto;background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:14px;padding:0 4px;';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      state.selected.splice(i, 1);
      renderSelectedList();
      renderWaveform();
    });
    item.appendChild(delBtn);

    list.appendChild(item);
  });
  const insertBtn = document.getElementById('mra-insert');
  if (insertBtn) insertBtn.disabled = state.selected.length === 0;
}

// ─── ВІЗУАЛІЗАЦІЯ ВЕЙВФОРМИ ───────────────────────────────────────────────────
var offscreenCanvas = null;
var lastRenderSignature = null;
var lastStatsAdCount = null;

function renderWaveform() {
  const canvas = document.getElementById('mra-waveform');
  const section = document.getElementById('mra-waveform-section');

  if (!canvas || !state.waveformData) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = '';

  // DPR-aware canvas для чіткості на Retina/HiDPI
  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth;
  const displayH = canvas.clientHeight;
  if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    // Скидаємо офскрін при зміні розміру
    offscreenCanvas = null;
    lastRenderSignature = null;
  }

  const { smoothed, duration, totalBlocks, threshold } = state.waveformData;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = displayW;
  const h = displayH;

  // Сигнатура лише для статичного фону (вейвформа + поріг + паузи)
  // Маркери малюються поверх offscreen — їх зміна НЕ потребує перемальовування фону
  const signature = `${totalBlocks}_${threshold}_${state.silences.length}`;

  const needsRedraw = lastRenderSignature !== signature;

  if (needsRedraw) {
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = w * dpr;
      offscreenCanvas.height = h * dpr;
    }

    const offCtx = offscreenCanvas.getContext('2d', { alpha: false });
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    offCtx.fillStyle = '#111111';
    offCtx.fillRect(0, 0, w, h);

    // Безпечний пошук максимуму (без spread)
    const maxAmp = arrayMax(smoothed);
    if (maxAmp <= 0) return;

    for (let x = 0; x < w; x++) {
      // Коректний маппінг пікселів → блоків
      const blockIdx = Math.floor((x / w) * totalBlocks);
      if (blockIdx >= totalBlocks) break;

      const amp = smoothed[blockIdx];
      const normalizedAmp = amp / maxAmp;
      const barHeight = normalizedAmp * h * 0.8;

      const isQuiet = amp < threshold;
      offCtx.fillStyle = isQuiet ? '#222222' : '#888888';

      const barY = (h - barHeight) / 2;
      offCtx.fillRect(x, barY, 1, barHeight);
    }

    // Лінія порогу тиші (відповідає центрованим барам вейвформи)
    const normalizedThreshold = threshold / maxAmp;
    const thresholdBarH = normalizedThreshold * h * 0.8;
    const thresholdY = (h - thresholdBarH) / 2;
    offCtx.strokeStyle = '#555555';
    offCtx.setLineDash([2, 5]);
    offCtx.beginPath();
    offCtx.moveTo(0, thresholdY);
    offCtx.lineTo(w, thresholdY);
    offCtx.stroke();
    offCtx.setLineDash([]);

    // Всі знайдені паузи (тонкі)
    offCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    state.silences.forEach(s => {
      const x = (s.seconds / duration) * w;
      offCtx.fillRect(x - 1, 0, 2, h);
    });

    lastRenderSignature = signature;
  }

  // Копіюємо офскрін на видимий canvas (вказуємо логічний розмір, щоб HiDPI не масштабував двічі)
  if (offscreenCanvas) {
    ctx.drawImage(offscreenCanvas, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);
  }

  // ── Кольорові зони між маркерами ──
  if (state.selected.length > 0) {
    const zoneColors = [
      'rgba(255, 100, 100, 0.10)',  // червонуватий
      'rgba(255, 200,  60, 0.10)',  // жовтуватий
      'rgba(100, 220, 130, 0.10)',  // зеленуватий
      'rgba( 80, 180, 255, 0.10)',  // блакитний
      'rgba(200, 110, 255, 0.10)',  // фіолетовий
      'rgba(255, 150,  50, 0.10)',  // помаранчевий
    ];

    // Точки зон: початок відео → кожен маркер → кінець відео
    const zoneBoundaries = [0, ...state.selected.map(s => s.seconds), duration];

    for (let z = 0; z < zoneBoundaries.length - 1; z++) {
      const x1 = (zoneBoundaries[z] / duration) * w;
      const x2 = (zoneBoundaries[z + 1] / duration) * w;
      ctx.fillStyle = zoneColors[z % zoneColors.length];
      ctx.fillRect(x1, 0, x2 - x1, h);
    }
  }

  // Відібрані паузи (яскраві маркери) — завжди поверх
  state.selected.forEach((s, i) => {
    const x = (s.seconds / duration) * w;
    const isManual = s.manual;

    ctx.strokeStyle = isManual ? 'rgba(255, 255, 255, 0.9)' : 'rgba(201, 28, 28, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    ctx.fillStyle = isManual ? '#ffffff' : 'rgba(201, 28, 28, 1)';
    ctx.font = 'bold 11px Arial';
    const label = isManual ? `✋${i + 1} ` : (i + 1).toString();
    ctx.fillText(label, x + 4, 12);
  });

  // Часові мітки внизу
  ctx.fillStyle = '#666';
  ctx.font = '9px Arial';
  const timeMarks = 6;
  for (let i = 0; i <= timeMarks; i++) {
    const x = (i / timeMarks) * w;
    const timeSec = (i / timeMarks) * duration;
    const timeStr = Math.floor(timeSec / 60) + 'm';
    ctx.fillText(timeStr, x, h - 2);
  }

  if (needsRedraw) log('Вейвформа: повний рендер', 'info');
}
