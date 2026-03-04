// ─── ШАБЛОНИ UI ──────────────────────────────────────────────────────────────
function row(label, ctrl, hint = '') {
  return `<div class="mr"><span class="ml">${label}</span><span class="mc">${ctrl}</span>${hint ? `<span class="mh">${hint}</span>` : ''}</div>`;
}

function stepper(id, val, min, max, step) {
  return `<div class="stp" data-id="${id}" data-val="${val}" data-min="${min}" data-max="${max}" data-step="${step}">
    <button class="mcb stp-m">−</button>
    <input type="text" class="stp-v" value="${val}" spellcheck="false" readonly title="Натисніть щоб ввести значення вручну">
    <button class="mcb stp-p">+</button>
  </div>`;
}

function getVal(id) {
  const el = document.querySelector(`.stp[data-id="${id}"] .stp-v`);
  return el ? parseFloat(el.value) : null;
}

function _setStepperVal(id, val) {
  const el = document.querySelector(`.stp[data-id="${id}"] .stp-v`);
  if (el && val !== undefined && val !== null) el.value = val;
}

function _restoreSettingsToUI() {
  _setStepperVal('mra-min-silence', CONFIG.minSilenceSec);
  _setStepperVal('mra-threshold', CONFIG.silenceThresholdPct);
  _setStepperVal('mra-min-gap', CONFIG.minGapSec);
  _setStepperVal('mra-cutoff', CONFIG.shortVideoCutoff / 60); // Зберігається в секундах, відображається в хвилинах
  _setStepperVal('mra-short-gap', CONFIG.shortVideoGapSec);
  _setStepperVal('mra-long-gap', CONFIG.longVideoGapSec);

  const focusCb = document.getElementById('mra-focus-start');
  if (focusCb) focusCb.checked = CONFIG.focusStart;

  const autoOpenCb = document.getElementById('mra-auto-open');
  if (autoOpenCb) autoOpenCb.checked = CONFIG.autoOpenPanel;

  const autoGapCb = document.getElementById('mra-auto-gap');
  if (autoGapCb) {
    autoGapCb.checked = CONFIG.autoGap;
    document.getElementById('mra-auto-sect').style.display = CONFIG.autoGap ? '' : 'none';
    document.getElementById('mra-manual-sect').style.display = CONFIG.autoGap ? 'none' : '';
  }
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
#mra-count,.stp-v{width:46px;text-align:center;color:#fff;font-size:13px;font-weight:900;background:#1a1a1a;border:1px solid #444;border-radius:4px;padding:2px 0;cursor:pointer;transition:0.2s;user-select:text;-webkit-user-select:text;}
.stp-v:focus{outline:none;border-color:#c91c1c;background:#222;box-shadow:0 0 4px rgba(201,28,28,0.5)}
#mra-count{color:#c91c1c;font-size:15px;width:auto;min-width:38px;padding:2px 6px;}
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
      <div class="mtw" style="margin-top:6px;">
        <label class="mt"><input type="checkbox" id="mra-auto-open" checked><span class="msl"></span></label>
        <span class="mtl">🔄 Автоматично відкривати панель</span>
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
      ${row('Gap короткого відео (с):', stepper('mra-short-gap', 60, 1, 600, 1))}
      ${row('Gap довгого відео (с):', stepper('mra-long-gap', 120, 1, 3600, 1))}
    </div>
    <div id="mra-manual-sect" style="display:none">
      ${row('Мін. відстань між рекламами (с):', stepper('mra-min-gap', 120, 1, 7200, 1))}
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

  <div id="mra-stats" style="display:none; padding:8px; margin-bottom:8px; background:#1a1a1a; border-radius:6px; border:1px solid #333; text-align:center; font-size:12px; font-weight:600;"></div>
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

  // ── Відновлюємо збережені налаштування в UI ──
  _restoreSettingsToUI();

  // ── ГЛОБАЛЬНЕ ЗАХОПЛЕННЯ КЛАВІАТУРИ (з трекінгом для cleanup) ──
  const keyBlocker = (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('stp-v')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
  };
  ['keydown', 'keyup', 'keypress'].forEach(evtType => {
    addTrackedEventListener(window, evtType, keyBlocker, { capture: true });
  });

  // ── Авто-перерахунок при зміні налаштувань ──
  let analyzeTimer = null;
  function triggerAutoAnalyze() {
    if (state.cachedAudioBuffer) {
      clearTimeout(analyzeTimer);
      analyzeTimer = setTimeout(() => {
        analyzeWaveform().catch(e => console.error(e));
      }, 250);
    }
  }

  // ── Прив'язуємо stepper-кнопки (−/+) до всіх контролів ──
  panel.querySelectorAll('.stp').forEach(stp => {
    const valEl = stp.querySelector('.stp-v');
    const minVal = parseFloat(stp.dataset.min);
    const maxVal = parseFloat(stp.dataset.max);
    const step = parseFloat(stp.dataset.step);

    const updateVal = (newValStr) => {
      let next = parseFloat(newValStr);
      if (isNaN(next)) next = parseFloat(stp.dataset.val);
      if (next < minVal) next = minVal;
      if (next > maxVal) next = maxVal;
      valEl.value = Math.round(next * 1000) / 1000;
      triggerAutoAnalyze();
    };

    // ── Швидке прокручування при утриманні кнопки ──
    let holdTimer = null;
    let intervalTimer = null;

    const stopHold = () => {
      clearTimeout(holdTimer);
      clearInterval(intervalTimer);
      holdTimer = null;
      intervalTimer = null;
    };

    const startHold = (isPlus) => {
      stopHold(); // Очищаємо попередні таймери перед зачаттям нового

      const dir = isPlus ? 1 : -1;
      let cur = parseFloat(valEl.value) || parseFloat(stp.dataset.val);
      updateVal(cur + (step * dir));

      holdTimer = setTimeout(() => {
        intervalTimer = setInterval(() => {
          let current = parseFloat(valEl.value) || parseFloat(stp.dataset.val);
          updateVal(current + (step * dir * 5));
        }, 100);
      }, 400);
    };

    const btnM = stp.querySelector('.stp-m');
    const btnP = stp.querySelector('.stp-p');

    const attachPointerEvents = (btn, isPlus) => {
      const onDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        startHold(isPlus);
      };
      const onUp = (e) => {
        btn.releasePointerCapture(e.pointerId);
        stopHold();
      };
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', stopHold);
      btn.addEventListener('mouseleave', stopHold);
      activeEventListeners.push(
        { element: btn, event: 'pointerdown', handler: onDown, options: false },
        { element: btn, event: 'pointerup', handler: onUp, options: false },
        { element: btn, event: 'pointercancel', handler: stopHold, options: false },
        { element: btn, event: 'mouseleave', handler: stopHold, options: false }
      );
    };

    attachPointerEvents(btnM, false);
    attachPointerEvents(btnP, true);

    // Глобальний fallback
    addTrackedEventListener(window, 'mouseup', stopHold);
    addTrackedEventListener(window, 'touchend', stopHold);

    // Введення через Prompt
    valEl.style.cursor = 'pointer';
    valEl.addEventListener('click', () => {
      const currentVal = valEl.value;
      const newValStr = prompt(`Введіть нове значення (мінімум: ${minVal}, максимум: ${maxVal}):`, currentVal);
      if (newValStr !== null && newValStr.trim() !== '') {
        updateVal(newValStr.replace(',', '.'));
      }
    });

    // ── Скрол коліщатком ──
    stp.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = parseFloat(valEl.value) || parseFloat(stp.dataset.val);
      if (e.deltaY < 0) updateVal(cur + step);
      else updateVal(cur - step);
    }, { passive: false });
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

  const autoOpenCbEvt = document.getElementById('mra-auto-open');
  if (autoOpenCbEvt) {
    autoOpenCbEvt.addEventListener('change', () => {
      CONFIG.autoOpenPanel = autoOpenCbEvt.checked;
      saveSettings();
    });
  }

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
        state.selected.splice(existingIdx, 1);
        log(`Видалено мітку на ${toTimecode(clickSec)}`, 'warn');
        renderSelectedList();
        renderWaveform();
        return;
      }

      // Магніт: примагнітити до найближчої паузи (якщо ближче 2.5с)
      let finalSec = clickSec;
      let closestRaw = null;
      let minDist = 2.5;
      state.silences.forEach(s => {
        const dist = Math.abs(s.seconds - clickSec);
        if (dist < minDist) { minDist = dist; closestRaw = s; }
      });

      if (closestRaw) {
        finalSec = closestRaw.seconds;
      }

      // Показуємо prompt з попередньо заповненим таймкодом
      const defaultTimecode = toTimecode(finalSec);
      const userInput = prompt('Введіть таймкод для мітки (ММ:СС:КК або ММ:СС):', defaultTimecode);

      if (userInput === null || userInput.trim() === '') return; // Скасовано

      // Парсимо введений таймкод
      const parsed = parseTimecodeInput(userInput.trim());
      if (parsed === null) {
        log(`Некоректний таймкод: "${userInput}"`, 'error');
        updateStatus('❌ Некоректний формат таймкоду', 'error');
        return;
      }

      // Перевіряємо чи мітка в межах відео
      if (parsed < 0 || parsed >= state.waveformData.duration) {
        log(`Таймкод за межами відео: ${userInput}`, 'error');
        updateStatus('❌ Таймкод за межами відео', 'error');
        return;
      }

      if (closestRaw && Math.abs(parsed - finalSec) < 0.1) {
        log('🧲 Примагнітився до реальної паузи!', 'info');
      }

      state.selected.push({
        timecode: toTimecode(parsed),
        seconds: +parsed.toFixed(2),
        duration_sec: closestRaw && Math.abs(parsed - closestRaw.seconds) < 3 ? closestRaw.duration_sec : 0,
        amplitude: closestRaw && Math.abs(parsed - closestRaw.seconds) < 3 ? closestRaw.amplitude : 0,
        manual: true
      });
      state.selected.sort((a, b) => a.seconds - b.seconds);
      log(`Додано вручну мітку на ${toTimecode(parsed)}`, 'success');

      renderSelectedList();
      renderWaveform();
    });
  }

  // ── Вставити ──
  document.getElementById('mra-insert').addEventListener('click', insertTimecodes);

  // ── Очистити всі мітки (з YouTube) ──
  document.getElementById('mra-clear').addEventListener('click', async () => {
    updateStatus('🗑️ Очищення міток...', 'info');

    // 1. Знімаємо галочку "Автоматичні рекламні місця", інакше YouTube не дасть видалити свої мітки
    const autoAdsCheckbox = document.querySelector('div[role="checkbox"][aria-label="Автоматичні рекламні місця"]');
    if (autoAdsCheckbox && autoAdsCheckbox.getAttribute('aria-checked') === 'true') {
      log('⚙️ Вимикаємо "Автоматичні рекламні місця" від YouTube...', 'info');
      autoAdsCheckbox.click();
      await sleep(400); // Даємо час React застосувати зміни
    }

    const deleteBtns = getAdBreakDeleteButtons();

    if (deleteBtns.length === 0) {
      log('Не знайдено міток для видалення', 'warn');
      updateStatus('Не знайдено міток', 'warn');
      return;
    }

    log(`Видаляємо ${deleteBtns.length} міток з відео...`, 'info');
    for (let i = deleteBtns.length - 1; i >= 0; i--) {
      deleteBtns[i].click();
      await sleep(150);
    }

    updateStatus(`✅ Успішно видалено ${deleteBtns.length} міток!`, 'success');
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
    panel.remove();
    createReopenButton();
  });

  // ── Перезавантаження ──
  document.getElementById('mra-reload').addEventListener('click', () => {
    log('♻️ Перезавантаження розширення та скидання налаштувань...', 'info');
    resetSettings();
    state.cachedAudioBuffer = null;
    state.cachedAudioUrl = null;
    state.waveformData = null;
    state.silences = [];
    state.selected = [];
    offscreenCanvas = null;
    lastRenderSignature = null;
    isPanelClosedByUser = false;
    panel.remove();
    // НЕ викликаємо init(), бо він додасть ще один observer
    // Існуючий observer сам побачить, що панелі нема і перемалює її
  });

  // ── Drag (з трекінгом для cleanup) ──
  let isDragging = false, sx, sy, sl, st;
  document.getElementById('mra-header').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true; sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect(); sl = r.left; st = r.top;
    panel.style.right = 'auto';
  });

  const onMouseMove = e => {
    if (!isDragging) return;
    panel.style.left = (sl + e.clientX - sx) + 'px';
    panel.style.top = (st + e.clientY - sy) + 'px';
  };
  const onMouseUp = () => { isDragging = false; };

  addTrackedEventListener(document, 'mousemove', onMouseMove);
  addTrackedEventListener(document, 'mouseup', onMouseUp);
}

function createReopenButton() {
  if (document.getElementById('mra-reopen-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'mra-reopen-btn';
  btn.innerHTML = '⚡ Відкрити ТСН АвтоРеклама';
  btn.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 10000;
    background: #e63946;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 12px 24px;
    font-size: 15px;
    font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    transition: 0.2s;
  `;
  btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; btn.style.background = '#ff4d5a'; };
  btn.onmouseout = () => { btn.style.transform = 'scale(1)'; btn.style.background = '#e63946'; };

  btn.addEventListener('click', () => {
    isPanelClosedByUser = false;
    btn.remove();
    // MutationObserver відразу помітить isPanelClosedByUser = false і створить нову панель
  });

  document.body.appendChild(btn);
}
