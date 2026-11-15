// ─── РЕНДЕР ──────────────────────────────────────────────────────────────────
var offscreenCanvas = null;
var lastRenderSignature = null;
var lastStatsAdCount = null;

function getWaveformView(duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const zoom = Math.max(1, Math.min(16, Number(state.waveformZoom) || 1));
  const viewDuration = safeDuration > 0 ? safeDuration / zoom : 0;
  const maxStart = Math.max(0, safeDuration - viewDuration);
  const start = Math.max(0, Math.min(Number(state.waveformOffsetSec) || 0, maxStart));

  state.waveformZoom = zoom;
  state.waveformOffsetSec = start;

  return {
    zoom,
    start,
    end: start + viewDuration,
    viewDuration,
    maxStart
  };
}

function showStopButton(show) {
  const insertBtn = document.getElementById('mra-insert');
  let stopBtn = document.getElementById('mra-stop');

  if (show) {
    if (insertBtn) insertBtn.style.display = 'none';
    if (!stopBtn && insertBtn && insertBtn.parentNode) {
      stopBtn = document.createElement('button');
      stopBtn.id = 'mra-stop';
      stopBtn.textContent = '⛔ ЗУПИНИТИ';
      stopBtn.addEventListener('click', () => { state.insertAbort = true; });
      insertBtn.parentNode.insertBefore(stopBtn, insertBtn.nextSibling);
    }
    if (stopBtn) stopBtn.style.display = '';
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
    stats.classList.add('mra-visible');

    const duration = state.waveformData.duration;

    // СТАНДАРТ ТСН: хронометраж ділимо на 2 (1 реклама кожні 2 хв / 120 сек)
    let idealAds = Math.floor(duration / 120);

    // Ютуб дозволяє мідроли тільки для відео від 8 хвилин (480 сек)
    if (duration < 480) {
      idealAds = 0;
    } else if (idealAds < 1) {
      idealAds = 1;
    }

    const totalAds = state.selected.length;
    const ytFromAds = state.selected.filter(s => s.fromYt).length;
    const existingAds = state.selected.filter(s => s.fromExisting).length;

    let ratioEmoji = '✅ Люкс';
    let ratioColor = '#00ff66';

    if (duration < 480) {
      ratioEmoji = '⏳ До 8 хв (Без реклами)';
      ratioColor = '#94a3b8';
    } else if (totalAds === 0) {
      ratioEmoji = '❌ Немає';
      ratioColor = '#ff0055';
    } else if (totalAds < idealAds) {
      // Суворе правило: якщо менше ділення на 2 — значить погано (мало)
      ratioEmoji = '⚠️ Малувато';
      ratioColor = '#ff9f43';
    } else if (totalAds > idealAds + 2) {
      // Якщо напхали на 3 реклами більше ідеалу
      ratioEmoji = '🔥 Густо';
      ratioColor = '#ff0055';
    }

    const min = Math.floor(duration / 60);
    const sec = Math.floor(duration % 60);
    const durStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    const notes = [];
    if (ytFromAds > 0) notes.push(`${ytFromAds} від YT`);
    if (existingAds > 0) notes.push(`${existingAds} збережених`);
    const notesStr = notes.length > 0
      ? ` <span style="font-size:10px;color:#666;">(${notes.join(', ')})</span>`
      : '';
    stats.innerHTML = `
      <span style="color:#888;" title="Хронометраж відео">⏱️ ${durStr}</span>
      &nbsp;|&nbsp;
      <span style="color:#ccc;">Міт.: <b style="color:#fff">${totalAds}</b>${notesStr} <span style="font-size:10px;color:#666;" title="Ідеальна кількість реклам для такого хронометражу">(ідеал ~${idealAds})</span></span>
      &nbsp;|&nbsp;
      <span style="color:${ratioColor};" title="Статус щільності реклами">${ratioEmoji}</span>
    `;

    // ── Постійне пульсування для проблемних статусів ──
    const isGusto = ratioEmoji.includes('Густо');
    const isMaluv = ratioEmoji.includes('Малувато');

    // Знімаємо всі попередні анімаційні класи
    stats.classList.remove('mra-pulse-red', 'mra-pulse-yellow');

    if (isGusto) {
      // 🔥 Густо — постійне червоне пульсування (не дратує, просто нагадує)
      stats.classList.add('mra-pulse-red');
    } else if (isMaluv) {
      // ⚠️ Малувато — постійне жовте пульсування
      stats.classList.add('mra-pulse-yellow');
    } else {
      // ✅ Люкс — одноразовий подвійний спалах через animate()
      if (lastStatsAdCount !== totalAds) {
        try {
          stats.animate([
            { boxShadow: '0 0 0px transparent', borderColor: '#333' },
            { boxShadow: `0 0 12px ${ratioColor}`, borderColor: ratioColor, offset: 0.25 },
            { boxShadow: '0 0 0px transparent', borderColor: '#333', offset: 0.5 },
            { boxShadow: `0 0 12px ${ratioColor}`, borderColor: ratioColor, offset: 0.75 },
            { boxShadow: '0 0 0px transparent', borderColor: '#333' }
          ], { duration: 1200, easing: 'ease-in-out' });
        } catch (e) { }
      }
    }

    lastStatsAdCount = totalAds;
  } else if (stats) {
    stats.classList.remove('mra-pulse-red', 'mra-pulse-yellow', 'mra-visible');
  }

  // ── Діагноз відео від авто-пілота ──
  const verdictEl = document.getElementById('mra-verdict');
  if (verdictEl) {
    if (state.waveformData && state.waveformData.duration >= 480) {
      const dur = state.waveformData.duration;
      const ideal = Math.max(1, Math.floor(dur / 120));
      const ytAcceptThreshold = typeof getYtAcceptQuality === 'function' ? getYtAcceptQuality() : 0.6;
      const realAds = state.selected.filter(s =>
        !s.fallbackSpot && (s.fromYt || s.fromExisting || s.ytHint || Number(s.quality_score ?? 0) >= ytAcceptThreshold)
      ).length;
      const backupAds = state.selected.length - realAds;
      // Частка природних (включає fromYt, fromExisting, ytHint та якість >= порогу)
      const share = realAds / ideal;

      let v;
      if (share >= 0.9) {
        v = { t: 'ЛЮКС', c: '#00ff66', d: 'відео з природними паузами — реклама стане непомітно' };
      } else if (share >= 0.6) {
        v = { t: 'ДОБРЕ', c: '#06d6a0', d: 'більшість міток у природних паузах' };
      } else if (share >= 0.3) {
        v = { t: 'СКЛАДНИЙ МОНТАЖ', c: '#ff9f43', d: 'природних пауз мало — частина міток запасні' };
      } else {
        v = { t: 'МОНТАЖ ВСТИК', c: '#ff0055', d: 'природних пауз майже немає — мітки в найтихіших місцях, YouTube може рідше показувати тут рекламу' };
      }

      const meta = state.analysisMeta;
      const escTxt = meta && meta.escalated
        ? ` Бот сам підняв чутливість до ${meta.finalThr}% (пауза ≥${meta.finalMinS}с).`
        : '';
      const ytFromAds2 = state.selected.filter(s => s.fromYt).length;
      const existAds2 = state.selected.filter(s => s.fromExisting).length;
      let notesTxt = '';
      if (ytFromAds2 > 0) notesTxt += ` Якорів YT: <b style="color:#7dd3fc">${ytFromAds2}</b>.`;
      if (existAds2 > 0) notesTxt += ` Збережених ручних: <b style="color:#38bdf8">${existAds2}</b>.`;

      verdictEl.style.display = 'block';
      verdictEl.style.borderLeftColor = v.c;
      verdictEl.innerHTML = `<b style="color:${v.c};letter-spacing:0.5px;">${v.t}</b> — ${v.d}.${notesTxt} Природних: <b style="color:#fff">${realAds}</b>, запасних: <b style="color:#ffd166">${backupAds}</b>, ціль: ${ideal}.${escTxt}`;
    } else {
      verdictEl.style.display = 'none';
    }
  }

  list.innerHTML = '';
  state.selected.forEach((s, i) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;font-family:\'Outfit\',sans-serif;font-size:11px;';

    const numSpan = document.createElement('span');
    numSpan.style.cssText = 'color:#ff0055;font-weight:800;font-family:\'Courier New\',monospace;font-size:12px;';

    if (s.inserted) {
      numSpan.textContent = '✅';
      numSpan.style.color = '#00ff66';
    } else {
      numSpan.textContent = `${String(i + 1).padStart(2, '0')}.`;
    }

    const timeSpan = document.createElement('span');
    timeSpan.style.color = s.inserted ? '#475569' : '#f8fafc';
    timeSpan.style.textDecoration = s.inserted ? 'line-through' : 'none';
    timeSpan.style.fontFamily = "'Courier New', Courier, monospace";
    timeSpan.style.fontWeight = "bold";
    timeSpan.style.fontSize = "12px";
    timeSpan.textContent = s.timecode;

    const durSpan = document.createElement('span');
    const durationSec = Number(s.duration_sec) || 0;
    const durationLabel = durationSec > 0 ? `${durationSec.toFixed(1).replace('.0', '')}с` : '';
    durSpan.style.cssText = 'color:#94a3b8;font-size:10px;';

    if (s.fromExisting) {
      durSpan.textContent = '(ручна • збережена)';
      durSpan.style.color = '#38bdf8';
      durSpan.title = 'Збережена ручна мітка — не перезаписується';
    } else if (s.fromYt) {
      durSpan.textContent = '(YT • 100%)';
      durSpan.style.color = '#7dd3fc';
      durSpan.title = 'Якір YouTube — 100%-прийнята позиція авто-мітки YT';
    } else if (durationSec > 0) {
      const quality = Number(s.quality_score);
      const qualityLabel = Number.isFinite(quality) ? ` · ${Math.round(quality * 100)}%` : '';
      durSpan.textContent = `(пауза ${durationLabel}${qualityLabel})`;
      durSpan.title = 'Якість паузи: глибина і рівність тиші + відсутність сплесків + довжина';
    } else if (s.fallbackSpot) {
      const quietness = Number(s.quality_score);
      durSpan.textContent = Number.isFinite(quietness) ? `(якість місця ${Math.round(quietness * 100)}%)` : '';
      durSpan.title = 'Чистої паузи тут немає — запасна мітка в найтихішому місці. Якість рахується тією ж шкалою, що й у природних пауз: глибина тиші + відсутність сплесків + довжина';
    } else {
      durSpan.textContent = '';
    }

    item.appendChild(numSpan);
    item.appendChild(timeSpan);
    item.appendChild(durSpan);

    if (s.manual) {
      const badge = document.createElement('span');
      badge.style.cssText = 'color:#00f5ff;font-size:10px;font-weight:bold;text-shadow:0 0 4px rgba(0,245,255,0.4);';
      badge.title = 'Вручну додано';
      badge.textContent = '✋';
      item.appendChild(badge);
    }

    if (s.fallbackSpot) {
      const fbBadge = document.createElement('span');
      fbBadge.style.cssText = 'color:#ffd166;font-size:9px;font-weight:800;background:rgba(255,209,102,0.12);border:1px solid rgba(255,209,102,0.35);padding:1px 5px;border-radius:4px;letter-spacing:0.3px;';
      fbBadge.title = 'Чистої паузи тут немає — обрано найтихіше місце відрізка, щоб витримати ритм реклами';
      fbBadge.textContent = 'запасна';
      item.appendChild(fbBadge);
    }

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'margin-left:auto;background:none;border:none;color:#ff0055;cursor:pointer;font-size:14px;padding:0 4px;font-family:\'Outfit\',sans-serif;font-weight:800;transition:all 0.2s;';
    delBtn.textContent = '✕';
    delBtn.onmouseover = () => { delBtn.style.transform = 'scale(1.2)'; delBtn.style.color = '#ff3b30'; };
    delBtn.onmouseout = () => { delBtn.style.transform = 'scale(1)'; delBtn.style.color = '#ff0055'; };
    delBtn.addEventListener('click', () => {
      state.selected.splice(i, 1);
      renderSelectedList();
      renderWaveform();
    });
    item.appendChild(delBtn);

    list.appendChild(item);
  });
  const insertBtn = document.getElementById('mra-insert');
  if (insertBtn) insertBtn.disabled = state.selected.length === 0 || !state.selected.some(s => !s.inserted);
}

// ─── ВІЗУАЛІЗАЦІЯ ВЕЙВФОРМИ ───────────────────────────────────────────────────

function renderWaveform() {
  const canvas = document.getElementById('mra-waveform');
  const section = document.getElementById('mra-waveform-section');

  if (!canvas || !state.waveformData) {
    if (section) section.classList.remove('mra-visible');
    return;
  }

  if (section) section.classList.add('mra-visible');

  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth;
  const displayH = canvas.clientHeight;
  if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    offscreenCanvas = null;
    lastRenderSignature = null;
  }

  const { envelope, smoothed, duration, totalBlocks, threshold } = state.waveformData;

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = displayW;
  const h = displayH;
  const view = getWaveformView(duration);
  const timeToX = (seconds) => ((seconds - view.start) / view.viewDuration) * w;
  const isTimeVisible = (seconds) => seconds >= view.start && seconds <= view.end;
  const drawWaveformSurface = (targetCtx) => {
    const bg = targetCtx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0c1019'); // deep studio backdrop (matches panel)
    bg.addColorStop(0.45, '#090c14');
    bg.addColorStop(1, '#06080e');
    targetCtx.fillStyle = bg;
    targetCtx.fillRect(0, 0, w, h);

    // Subtle vertical grid lines
    targetCtx.strokeStyle = 'rgba(148, 163, 184, 0.035)';
    targetCtx.lineWidth = 0.5;
    for (let gridX = 0; gridX < w; gridX += 20) {
      targetCtx.beginPath();
      targetCtx.moveTo(gridX, 0);
      targetCtx.lineTo(gridX, h);
      targetCtx.stroke();
    }

    // Neutral center baseline — sound data stays cool, semantic marks stay warm
    targetCtx.fillStyle = 'rgba(148, 163, 184, 0.12)';
    targetCtx.fillRect(0, Math.round(h * 0.5), w, 1);

    // ── Рендеринг зон пауз (silence zones) на задньому плані ──
    if (state.silences && state.silences.length > 0) {
      targetCtx.save();
      state.silences.forEach(s => {
        const halfDur = s.duration_sec / 2;
        const tStart = s.seconds - halfDur;
        const tEnd = s.seconds + halfDur;
        
        // Перевіряємо видимість хоча б частини паузи
        if (tEnd < view.start || tStart > view.end) return;
        
        const xStart = timeToX(Math.max(tStart, view.start));
        const xEnd = timeToX(Math.min(tEnd, view.end));
        const zoneW = xEnd - xStart;
        if (zoneW < 1) return;
        
        // М'яка напівпрозора підкладка для паузи в золотистому кольорі
        const pauseGrad = targetCtx.createLinearGradient(xStart, 0, xStart + zoneW, 0);
        pauseGrad.addColorStop(0, 'rgba(242, 169, 0, 0.005)');
        pauseGrad.addColorStop(0.5, 'rgba(242, 169, 0, 0.055)');
        pauseGrad.addColorStop(1, 'rgba(242, 169, 0, 0.005)');
        
        targetCtx.fillStyle = pauseGrad;
        targetCtx.fillRect(xStart, 4, zoneW, h - 22);
        
        // Тонка рамка з боків паузи
        targetCtx.strokeStyle = 'rgba(242, 169, 0, 0.14)';
        targetCtx.lineWidth = 0.75;
        targetCtx.beginPath();
        targetCtx.moveTo(xStart, 4);
        targetCtx.lineTo(xStart, h - 18);
        targetCtx.moveTo(xEnd, 4);
        targetCtx.lineTo(xEnd, h - 18);
        targetCtx.stroke();
      });
      targetCtx.restore();
    }
  };

  const silenceSignature = state.silences
    .map(s => `${s.seconds}:${s.duration_sec}`)
    .join('|');
  const signature = `${totalBlocks}_${threshold}_${view.zoom}_${view.start.toFixed(2)}_${silenceSignature}`;
  const needsRedraw = lastRenderSignature !== signature;

  // ── Відмальовка статичної частини (бари + дзеркало) ──
  if (needsRedraw) {
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = w * dpr;
      offscreenCanvas.height = h * dpr;
    }

    const offCtx = offscreenCanvas.getContext('2d');
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    offCtx.clearRect(0, 0, w, h);

    const visualEnvelope = envelope || smoothed;
    const peakSamples = [];
    const sampleStep = Math.max(1, Math.floor(visualEnvelope.length / 1800));
    for (let i = 0; i < visualEnvelope.length; i += sampleStep) {
      peakSamples.push(visualEnvelope[i]);
    }
    peakSamples.sort((a, b) => a - b);

    const maxAmp = arrayMax(visualEnvelope);
    const p95Amp = peakSamples.length ? peakSamples[Math.floor(peakSamples.length * 0.95)] : maxAmp;
    const visualMax = Math.max(p95Amp * 1.28, maxAmp * 0.38, 0.000001);
    if (maxAmp <= 0) return;

    const centerY = Math.round(h * 0.5);

    // SoundCloud style discrete bars: 2px wide bars with 1.5px spacing
    const barWidth = 2;
    const spacing = 1.5;
    const step = barWidth + spacing;
    const numBars = Math.floor(w / step);
    const maxBarH = h * 0.42;
    const mirrorRatio = 0.65;

    // Звук — нейтральний холодний (тло даних), щоб червоно-золоті маркери,
    // зони ритму та підказки пауз читались поверх без злиття
    const soundGrad = offCtx.createLinearGradient(0, centerY - maxBarH, 0, centerY);
    soundGrad.addColorStop(0, '#b9c8dd');                     // light steel crown
    soundGrad.addColorStop(0.55, '#6b7d99');                  // steel blue body
    soundGrad.addColorStop(1, 'rgba(107, 125, 153, 0.3)');    // fade

    const soundMirrorGrad = offCtx.createLinearGradient(0, centerY, 0, centerY + maxBarH * mirrorRatio);
    soundMirrorGrad.addColorStop(0, 'rgba(107, 125, 153, 0.3)');
    soundMirrorGrad.addColorStop(1, 'rgba(107, 125, 153, 0.02)');

    const silenceGrad = 'rgba(100, 113, 133, 0.3)'; // muted slate (quiet bars)
    const silenceMirrorGrad = 'rgba(100, 113, 133, 0.1)';

    offCtx.lineWidth = barWidth;
    offCtx.lineCap = 'round';

    for (let i = 0; i < numBars; i++) {
      const rangeStartSec = view.start + (i / numBars) * view.viewDuration;
      const rangeEndSec = view.start + ((i + 1) / numBars) * view.viewDuration;
      const blockStart = Math.max(0, Math.floor((rangeStartSec / duration) * totalBlocks));
      const blockEnd = Math.min(totalBlocks - 1, Math.max(blockStart, Math.ceil((rangeEndSec / duration) * totalBlocks)));

      let amp = 0;
      let avg = 0;
      let samples = 0;
      for (let b = blockStart; b <= blockEnd; b++) {
        if (visualEnvelope[b] > amp) amp = visualEnvelope[b];
        avg += visualEnvelope[b];
        samples++;
      }
      avg = samples > 0 ? avg / samples : amp;
      const shapedAmp = amp * 0.82 + avg * 0.18;
      
      const isSilence = shapedAmp <= (threshold || 0.015);

      let topH, bottomH;
      if (isSilence) {
        topH = 1.5;
        bottomH = 1.0;
      } else {
        const normalizedAmp = Math.pow(Math.min(1, shapedAmp / visualMax), 1.05);
        topH = Math.max(normalizedAmp * maxBarH, 2.5);
        bottomH = Math.max(topH * mirrorRatio, 1.5);
      }

      const x = Math.round(i * step + barWidth / 2);

      // Draw main bar
      offCtx.strokeStyle = isSilence ? silenceGrad : soundGrad;
      offCtx.beginPath();
      offCtx.moveTo(x, centerY - 1);
      offCtx.lineTo(x, centerY - topH);
      offCtx.stroke();

      // Draw mirror bar
      offCtx.strokeStyle = isSilence ? silenceMirrorGrad : soundMirrorGrad;
      offCtx.beginPath();
      offCtx.moveTo(x, centerY + 1);
      offCtx.lineTo(x, centerY + bottomH);
      offCtx.stroke();
    }

    // Draw central midline separator
    offCtx.fillStyle = 'rgba(148, 163, 184, 0.15)';
    offCtx.fillRect(0, centerY, w, 1);

    lastRenderSignature = signature;
  }

  // ── Копіюємо на екран ──
  drawWaveformSurface(ctx);

  if (offscreenCanvas) {
    ctx.drawImage(offscreenCanvas, 0, 0, w, h);
  }

  if (state.selected.length > 0) {
    const idealGap = CONFIG.autoGap
      ? state.waveformData.duration / Math.max(1, Math.floor(state.waveformData.duration / 120))
      : CONFIG.minGapSec;
    const zoneBoundaries = [0, ...state.selected.map(s => s.seconds), duration];

    for (let z = 0; z < zoneBoundaries.length - 1; z++) {
      const gapSec = zoneBoundaries[z + 1] - zoneBoundaries[z];
      const visibleStart = Math.max(zoneBoundaries[z], view.start);
      const visibleEnd = Math.min(zoneBoundaries[z + 1], view.end);
      if (visibleEnd <= visibleStart) continue;

      const x1 = timeToX(visibleStart);
      const x2 = timeToX(visibleEnd);
      const zoneW = x2 - x1;
      const ratio = gapSec / idealGap;
      const solidColor = ratio < 0.5 ? '#e30613' : ratio < 0.8 ? '#ff9f43' : ratio <= 1.3 ? '#00ff66' : '#ff9f43';

      ctx.fillStyle = solidColor;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(x1 + 1, h - 3, Math.max(zoneW - 2, 0), 3);
      ctx.globalAlpha = 1.0;

      if (zoneW > 42) {
        const gapMin = Math.floor(gapSec / 60);
        const gapRemSec = Math.floor(gapSec % 60);
        const gapLabel = gapMin > 0
          ? `${gapMin}:${String(gapRemSec).padStart(2, '0')}`
          : `${Math.floor(gapSec)}с`;

        ctx.font = "700 9.5px 'Outfit', sans-serif";
        const tw = ctx.measureText(gapLabel).width;
        const labelY = Math.round(h * 0.58);
        const labelX = Math.max(x1 + 4, Math.min(x1 + zoneW / 2 - tw / 2, x2 - tw - 4));

        ctx.save();
        // Soft pill behind the gap duration for readability
        const padX = 4, padY = 2.5, pillH = 13;
        const pillX = labelX - padX;
        const pillY = labelY - pillH + padY;
        const pillW = tw + padX * 2;
        ctx.fillStyle = 'rgba(8, 10, 16, 0.62)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 6);
        else ctx.rect(pillX, pillY, pillW, pillH);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = solidColor;
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillText(gapLabel, labelX, labelY);
        ctx.restore();
      }
    }
  }

  // ── Жовті вертикалі: паузи, куди ще можна поставити вручну ──
  if (state.waveformManualHints !== false && Array.isArray(state.silences)) {
    const hasNearSecond = (sortedArr, sec, tol) => {
      let low = 0;
      let high = sortedArr.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const diff = sortedArr[mid] - sec;
        if (Math.abs(diff) < tol) return true;
        if (diff < 0) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return false;
    };

    const occupiedSecs = [
      ...(Array.isArray(state.selected) ? state.selected : []),
      ...(Array.isArray(state.existingMarks) ? state.existingMarks : []),
      ...(Array.isArray(state.ytAutoMarks) ? state.ytAutoMarks : [])
    ]
      .filter(m => m && m.seconds != null && Number.isFinite(Number(m.seconds)))
      .map(m => Number(m.seconds))
      .sort((a, b) => a - b);

    state.silences.forEach(s => {
      if (!isTimeVisible(s.seconds)) return;
      if (hasNearSecond(occupiedSecs, s.seconds, 1)) return;

      const sx = timeToX(s.seconds);
      const quality = Math.max(0, Math.min(1, Number(s.quality_score) || 0.45));
      const lineAlpha = 0.22 + quality * 0.36;
      const glowAlpha = 0.1 + quality * 0.28;
      const lineWidth = 0.75 + quality * 0.45;
      const dashOn = quality >= 0.78 ? 5 : 3;
      const dashOff = quality >= 0.55 ? 4 : 5;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 159, 67, ${lineAlpha.toFixed(2)})`;
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = `rgba(255, 159, 67, ${glowAlpha.toFixed(2)})`;
      ctx.shadowBlur = 2 + quality * 3;
      ctx.setLineDash([dashOn, dashOff]);
      ctx.beginPath();
      ctx.moveTo(sx, 6);
      ctx.lineTo(sx, h - 11);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = `rgba(255, 159, 67, ${Math.min(0.68, lineAlpha + 0.12).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, 7, 1.3 + quality * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = Math.min(0.55, 0.2 + quality * 0.28);
      ctx.fillRect(sx - 3, h - 9, 6, 2);
      ctx.restore();
    });
  }

  // ── Наявні мітки (вже стоять на відео — блакитні вертикалі) ──
  // Відображаємо об'єднання ручних і авто-міток YT (інформаційно: «що зараз стоїть на відео»)
  const allCurrentMarks = [
    ...(Array.isArray(state.existingMarks) ? state.existingMarks : []),
    ...(Array.isArray(state.ytAutoMarks) ? state.ytAutoMarks : [])
  ];
  if (allCurrentMarks.length > 0) {
    allCurrentMarks.forEach(m => {
      if (!isTimeVisible(m.seconds)) return;
      // Якщо поруч є вибрана мітка (в межах 1с) — вибрана візуально перемагає
      if (state.selected.some(sel => Math.abs(sel.seconds - m.seconds) < 1)) return;
      const ex = timeToX(m.seconds);
      ctx.save();
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ex, 1);
      ctx.lineTo(ex, h - 5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
  }

  // ── Маркери ──
  const markerBadgeLevels = [];
  const visibleMarkers = state.selected
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isTimeVisible(s.seconds));
  const denseMarkers = visibleMarkers.length > 14;
  visibleMarkers.forEach(({ s, i }) => {

    const x = timeToX(s.seconds);
    const isManual = s.manual;
    const isBackup = s.fallbackSpot;
    const color = isBackup ? '#ffd166' : isManual ? '#ff9f43' : '#e30613';
    const strokeColor = isBackup ? 'rgba(255, 209, 102, 0.9)' : isManual ? 'rgba(255, 159, 67, 0.9)' : 'rgba(227, 6, 19, 0.8)';

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isManual || isBackup ? 1.15 : 0.95;
    ctx.shadowColor = color;
    ctx.shadowBlur = denseMarkers ? 2 : (isManual || isBackup ? 4 : 3);
    if (isBackup) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 1);
    ctx.lineTo(x, h - 5);
    ctx.stroke();
    if (isBackup) ctx.setLineDash([]);

    const label = isManual ? `✋${i + 1}` : isBackup ? `≈${i + 1}` : `${i + 1}`;
    ctx.shadowBlur = 0;
    ctx.font = `${denseMarkers ? '800 9px' : '850 10px'} 'Outfit', sans-serif`;
    const tw = ctx.measureText(label).width;
    const badgeW = Math.max(denseMarkers ? 12 : 14, tw + (denseMarkers ? 5 : 7));
    const badgeH = denseMarkers ? 12 : 14;
    let level = 0;
    while (markerBadgeLevels[level] !== undefined && Math.abs(markerBadgeLevels[level] - x) < badgeW + 3) {
      level++;
    }
    markerBadgeLevels[level] = x;

    const badgeX = Math.max(2, Math.min(x - badgeW / 2, w - badgeW - 2));
    const badgeY = 3 + Math.min(level, denseMarkers ? 2 : 3) * (denseMarkers ? 10 : 12);
    const badgeFill = denseMarkers ? 'rgba(7, 8, 11, 0.48)' : 'rgba(7, 8, 11, 0.58)';
    const badgeBorder = isBackup ? 'rgba(255, 209, 102, 0.65)' : isManual ? 'rgba(255, 159, 67, 0.65)' : 'rgba(227, 6, 19, 0.65)';

    ctx.fillStyle = badgeFill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    else ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.fill();
    ctx.strokeStyle = badgeBorder;
    ctx.lineWidth = 0.9;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      ctx.stroke();
    }

    ctx.fillStyle = isBackup ? '#ffd166' : isManual ? '#ff9f43' : '#e30613';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + (denseMarkers ? 2.5 : 3.5), badgeY + badgeH / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  });

  // ── Часові мітки ──
  ctx.fillStyle = '#7a8699';
  ctx.font = '600 8px "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.shadowBlur = 0;
  const timeMarks = 6;
  for (let i = 0; i <= timeMarks; i++) {
    const x = (i / timeMarks) * w;
    const timeSec = view.start + (i / timeMarks) * view.viewDuration;
    const m = Math.floor(timeSec / 60);
    const s = Math.floor(timeSec % 60);
    const timeStr = s > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${m}m`;

    let textX = x + 2;
    if (i === timeMarks) textX = x - ctx.measureText(timeStr).width - 2;
    else if (i !== 0) textX = x - ctx.measureText(timeStr).width / 2;

    ctx.fillText(timeStr, textX, h - 7);
  }

  if (typeof updateWaveformZoomUI === 'function') updateWaveformZoomUI();
  if (needsRedraw) log('Вейвформа: повний рендер', 'info');
}
