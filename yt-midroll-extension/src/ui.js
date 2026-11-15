// ─── ШАБЛОНИ UI ──────────────────────────────────────────────────────────────
function row(label, ctrl, hint = '') {
  const tipHtml = hint
    ? `<span style="cursor:help;margin-left:3px;opacity:0.5;font-size:10px;flex-shrink:0;" title="${hint.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}">ℹ️</span>`
    : '';
  return `<div class="mr"><span class="ml">${label}${tipHtml}</span><span class="mc">${ctrl}</span></div>`;
}


function stepper(id, val, min, max, step) {
  return `<div class="stp" data-id="${id}" data-val="${val}" data-min="${min}" data-max="${max}" data-step="${step}">
    <button class="mcb stp-m" aria-label="Зменшити">−</button>
    <input type="text" class="stp-v" value="${val}" spellcheck="false" readonly title="Натисніть щоб ввести значення вручну" aria-label="Значення">
    <button class="mcb stp-p" aria-label="Збільшити">+</button>
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
  _setStepperVal('mra-flex', CONFIG.rhythmFlexPct);
  _setStepperVal('mra-min-quality', CONFIG.minQualityPct);
  _setStepperVal('mra-start-skip', CONFIG.startOffsetSec);
  _setStepperVal('mra-end-skip', CONFIG.endOffsetSec);
  _setStepperVal('mra-cutoff', CONFIG.shortVideoCutoff / 60); // Зберігається в секундах, відображається в хвилинах
  _setStepperVal('mra-short-gap', CONFIG.shortVideoGapSec);
  _setStepperVal('mra-long-gap', CONFIG.longVideoGapSec);

  const focusCb = document.getElementById('mra-focus-start');
  if (focusCb) focusCb.checked = CONFIG.focusStart;

  const autoOpenCb = document.getElementById('mra-auto-open');
  if (autoOpenCb) autoOpenCb.checked = CONFIG.autoOpenPanel;

  const autosaveCb = document.getElementById('mra-autosave');
  if (autosaveCb) autosaveCb.checked = CONFIG.autoSaveAfterInsert;

  const fullAutoCb = document.getElementById('mra-full-auto');
  if (fullAutoCb) fullAutoCb.checked = CONFIG.fullAutoInsert === true;

  const preserveManualCb = document.getElementById('mra-preserve-manual');
  if (preserveManualCb) preserveManualCb.checked = CONFIG.preserveManualMarks === true;

  const autoGapCb = document.getElementById('mra-auto-gap');
  if (autoGapCb) {
    autoGapCb.checked = CONFIG.autoGap;
    document.getElementById('mra-auto-sect').style.display = CONFIG.autoGap ? '' : 'none';
    document.getElementById('mra-manual-sect').style.display = CONFIG.autoGap ? 'none' : '';
    const tuningSect = document.getElementById('mra-tuning-sect');
    if (tuningSect) tuningSect.style.display = CONFIG.autoGap ? 'none' : '';
  }

  const guaranteeCb = document.getElementById('mra-guarantee');
  if (guaranteeCb) guaranteeCb.checked = CONFIG.guaranteeStandard !== false;
}

// ─── UI ПАНЕЛЬ ────────────────────────────────────────────────────────────────
function createStylesInHead() {
  let styleEl = document.getElementById('mra-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'mra-styles';
    styleEl.innerHTML = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap');

#mra-reopen-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10000;
  background: #e30613;
  background-image: linear-gradient(135deg, #e30613 0%, #90000a 100%);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 15px;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 10px rgba(227,6,19,0.25);
  transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation: mra-reopen-pulse 2s infinite ease-in-out;
}
#mra-reopen-btn:hover {
  transform: translateY(-3px) scale(1.04);
  box-shadow: 0 8px 20px rgba(227, 6, 19, 0.55), 0 0 15px rgba(227,6,19,0.3);
}
#mra-reopen-btn:active {
  transform: translateY(1px) scale(0.97);
}
@keyframes mra-reopen-pulse {
  0%, 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 10px rgba(227,6,19,0.25); }
  50% { box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 20px rgba(227,6,19,0.55); }
}

#mra-panel {
  --mra-primary: #e30613;
  --mra-primary-grad: linear-gradient(135deg, #e30613 0%, #90000a 100%);
  --mra-primary-glow: rgba(227, 6, 19, 0.28);
  --mra-cyan: #ff3344;
  --mra-cyan-glow: rgba(255, 51, 68, 0.25);
  --mra-success: #00ff66;
  --mra-success-glow: rgba(0, 255, 102, 0.25);
  --mra-bg-panel: rgba(10, 14, 24, 0.84);
  --mra-border: rgba(227, 6, 19, 0.15);
  --mra-border-hover: rgba(255, 51, 68, 0.4);

  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 99999;
  background: var(--mra-bg-panel);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  color: #e0e0e0;
  border-radius: 12px;
  border: 1px solid var(--mra-border);
  box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px var(--mra-cyan-glow);
  font-family: 'Outfit', 'Roboto', sans-serif;
  font-size: 11px;
  width: 500px;
  overflow: auto;
  user-select: none;
  display: flex;
  flex-direction: column;
  /* Гумово: росте під контент і вільно збільшується, але ніколи не більше за екран */
  max-height: calc(100vh - 80px);
  max-width: calc(100vw - 24px);
  transition: box-shadow 0.3s, border-color 0.3s;
  resize: both;
  min-width: 300px;
  min-height: 200px;
}
#mra-panel.mra-minimized {
  min-height: 34px !important;
  height: 34px !important;
  max-height: 34px !important;
  resize: none !important;
}
#mra-panel.mra-minimized #mra-header {
  border-bottom-color: transparent;
}

#mra-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; width: 6px; height: 6px;
  border-top: 2px solid var(--mra-cyan);
  border-left: 2px solid var(--mra-cyan);
  pointer-events: none;
  z-index: 10;
  transition: all 0.3s;
}
#mra-panel.mra-minimized::before, #mra-panel.mra-minimized::after {
  opacity: 0;
}

#mra-panel::after {
  content: '';
  position: absolute;
  bottom: 0; right: 0; width: 6px; height: 6px;
  border-bottom: 2px solid var(--mra-cyan);
  border-right: 2px solid var(--mra-cyan);
  pointer-events: none;
  z-index: 10;
  transition: all 0.3s;
}

#mra-live-bar{height:3px;flex-shrink:0;position:relative;z-index:11;background:linear-gradient(90deg,#9c0009,#ff2d3f,#ffb627,#ff2d3f,#9c0009);background-size:200% 100%;animation:mra-scan 4s linear infinite;box-shadow:0 0 10px rgba(255,45,63,0.5);}
@keyframes mra-scan{0%{background-position:200% 0}100%{background-position:-200% 0}}
#mra-panel.mra-minimized #mra-live-bar{display:none;}
@media (prefers-reduced-motion: reduce){#mra-live-bar{animation:none;}}
#mra-header{background:rgba(0,0,0,0.45);padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:move;border-bottom:1px solid rgba(227,6,19,0.25);flex-shrink:0;height:34px;}
#mra-title{font-weight:900;font-size:13px;color:#ffffff;text-transform:uppercase;letter-spacing:0.8px;display:flex;align-items:center;text-shadow:0 0 8px rgba(227,6,19,0.35);}
#mra-minimize, #mra-close, #mra-reload{background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0;line-height:1;margin-left:6px;transition:all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);outline:none;}
#mra-size{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:99px;font-size:9px;font-weight:700;letter-spacing:0.3px;padding:2px 8px;line-height:1.4;cursor:pointer;margin-left:6px;font-family:inherit;transition:background .2s,border-color .2s,color .2s;outline:none;}
#mra-size:hover{background:rgba(227,6,19,0.18);border-color:rgba(227,6,19,0.45);color:#fff;}
#mra-size:focus-visible{outline:2px solid var(--mra-primary);outline-offset:1px;}
/* Вузький режим панелі: інша точка кадрування cover — обличчя лишається по центру */
#mra-panel.mra-size-small #mra-bg-figure{object-position:80% 10%;}
#mra-minimize:hover{color:#fff;text-shadow:0 0 8px rgba(255,255,255,0.5);transform:scale(1.15);}
#mra-minimize:active{transform:scale(0.9);}
#mra-minimize:focus-visible{outline:2px solid #ffffff;border-radius:4px;}
#mra-close:hover{color:#ff4d4d;text-shadow:0 0 8px rgba(255,77,77,0.5);transform:scale(1.15);}
#mra-close:active{transform:scale(0.9);}
#mra-close:focus-visible{outline:2px solid #ff4d4d;border-radius:4px;}
#mra-reload:hover{color:#00ff66;text-shadow:0 0 8px rgba(0,255,102,0.5);transform:rotate(180deg) scale(1.1);}
#mra-reload:active{transform:scale(0.9);}
#mra-reload:focus-visible{outline:2px solid #00ff66;border-radius:4px;}
#mra-body{padding:10px 12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0;}

.ms{margin-bottom:12px;padding:12px;background:rgba(13, 18, 30, 0.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:10px;border:1px solid rgba(227,6,19,0.12);box-shadow:inset 0 1px 0 rgba(255,255,255,0.03);transition:all 0.4s cubic-bezier(0.16, 1, 0.3, 1);}
.ms:hover{border-color:var(--mra-border-hover);box-shadow:0 8px 24px rgba(227, 6, 19, 0.15);transform:translateY(-2px);}
.mst{font-size:10px;font-weight:900;color:var(--mra-cyan);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);}

.mr{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;padding:4px 6px;border-radius:6px;transition:all 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);}
.mr:hover{background:rgba(255,255,255,0.03);transform:translateX(4px);}
.ml{color:#aaa;font-size:11px;flex:1;min-width:110px;transition:color 0.2s;}
.mr:hover .ml{color:#fff;}
.mc{display:flex;align-items:center;gap:4px;}
.mh{color:#666;font-size:10px;width:100%;padding-left:4px;}
.mcnt,.stp{display:flex;align-items:center;gap:4px;}
.mcb{width:22px;height:22px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e0e0e0;border-radius:4px;cursor:pointer;font-size:14px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);}
.mcb:hover{background:var(--mra-primary-grad);color:#fff;border-color:var(--mra-primary);box-shadow:0 0 8px var(--mra-primary-glow);transform:scale(1.12);}
.mcb:active{transform:scale(0.9);}
.mcb:focus-visible{outline:2px solid #fff;border-radius:4px;}
#mra-count,.stp-v{width:46px;text-align:center;color:#fff;font-size:12px;font-weight:900;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 0;cursor:pointer;transition:all 0.25s;user-select:text;-webkit-user-select:text;}
.stp-v:focus{outline:none;border-color:var(--mra-primary);background:rgba(0,0,0,0.5);box-shadow:0 0 6px var(--mra-primary-glow);transform:scale(1.04);}
#mra-count{color:var(--mra-primary);font-size:14px;width:auto;min-width:38px;padding:2px 6px;}

.mtw{display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:4px 6px;border-radius:6px;transition:all 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);}
.mtw:hover{background:rgba(255,255,255,0.03);transform:translateX(4px);}
.mt{position:relative;width:32px;height:17px;display:inline-block;}
.mt input{opacity:0;width:0;height:0;}
.msl{position:absolute;inset:0;background:rgba(255,255,255,0.1);border-radius:17px;cursor:pointer;transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);}
.msl:before{content:'';position:absolute;height:11px;width:11px;left:3px;bottom:3px;background:#aaa;border-radius:50%;transition:transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.25s, width 0.2s;}

.mt input:active + .msl:before {
  width: 14px;
}
input:checked+.msl{background:linear-gradient(135deg, #e30613 0%, #8c0008 100%);box-shadow: 0 0 10px rgba(227,6,19,0.35);}
input:checked+.msl:before{transform:translateX(15px);background:#fff;}
input:focus-visible+.msl{outline:2px solid #ffffff;outline-offset:1px;}
.mtl{color:#ccc;font-size:11px;cursor:pointer;transition:color 0.2s;}
.mtw:hover .mtl{color:#fff;}

#mra-analyze,#mra-insert,#mra-clear,#mra-stop{
  width:100%;
  padding:10px;
  border:none;
  border-radius:6px;
  cursor:pointer;
  font-size:12px;
  font-weight:900;
  text-transform:uppercase;
  letter-spacing:0.8px;
  transition:all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  margin-bottom:6px;
  outline:none;
  position:relative;
  overflow:hidden;
}

#mra-analyze::after, #mra-insert::after, #mra-clear::after, #mra-stop::after {
  content: '';
  position: absolute;
  top: 0; left: -100%; width: 50%; height: 100%;
  background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0) 100%);
  transform: skewX(-20deg);
  transition: all 0.6s ease;
}
#mra-analyze:hover::after, #mra-insert:hover::after, #mra-clear:hover::after, #mra-stop:hover::after {
  left: 150%;
}

#mra-analyze{background:var(--mra-primary-grad);color:#ffffff;box-shadow:0 4px 12px var(--mra-primary-glow);}
#mra-analyze:hover{box-shadow:0 6px 18px var(--mra-primary-glow);filter:brightness(1.1);transform:translateY(-2px) scale(1.01);}
#mra-analyze:active{transform:translateY(0.5px) scale(0.98);box-shadow:0 2px 6px var(--mra-primary-glow);}
#mra-analyze:focus-visible{outline:2px solid #ffffff;outline-offset:1px;}

#mra-insert{background:rgba(255,255,255,0.03);color:#ffffff;border:1px solid var(--mra-primary);box-shadow:0 0 8px var(--mra-primary-glow);}
#mra-insert:hover:not(:disabled){background:var(--mra-primary-grad);box-shadow:0 6px 18px var(--mra-primary-glow);transform:translateY(-2px) scale(1.01);}
#mra-insert:active:not(:disabled){transform:translateY(0.5px) scale(0.98);}
#mra-insert:disabled{opacity:.35;cursor:not-allowed;border-color:rgba(255,255,255,0.1);color:#777;box-shadow:none;}
#mra-insert:focus-visible:not(:disabled){outline:2px solid #ffffff;outline-offset:1px;}

#mra-clear{background:rgba(0,0,0,0.2);color:#bbb;border:1px solid rgba(255,255,255,0.1);margin-bottom:8px;}
#mra-clear:hover{background:rgba(255,255,255,0.05);color:#fff;transform:translateY(-2px) scale(1.01);border-color:rgba(255,255,255,0.2);}
#mra-clear:active{transform:translateY(0.5px) scale(0.98);}
#mra-clear:focus-visible{outline:2px solid #ffffff;outline-offset:1px;}

#mra-stop{background:#e30613;color:#fff;box-shadow:0 4px 12px rgba(227,6,19,0.3);}
#mra-stop:hover{background:#ff2233;box-shadow:0 6px 18px rgba(227,6,19,0.5);transform:translateY(-2px) scale(1.01);}
#mra-stop:active{transform:translateY(0.5px) scale(0.98);}
#mra-stop:focus-visible{outline:2px solid #ffffff;outline-offset:1px;}

#mra-list{margin:6px 0;max-height:clamp(120px,28vh,420px);overflow-y:auto;padding-right:2px;}
#mra-list::-webkit-scrollbar{width:4px}
#mra-list::-webkit-scrollbar-track{background:rgba(0,0,0,0.1)}
#mra-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}
#mra-list button:focus-visible{outline:1.5px solid #ffffff;outline-offset:1px;}
#mra-divider{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:8px 0}
#mra-progress-wrap{height:6px;background:rgba(0,0,0,0.4);border-radius:3px;margin:6px 0;overflow:hidden;border:1px solid rgba(255,255,255,0.03);}
#mra-progress-bar{height:100%;background:var(--mra-primary-grad);width:0%;transition:width .4s cubic-bezier(0.25, 0.8, 0.25, 1);border-radius:3px;box-shadow:0 0 8px var(--mra-primary-glow);}
#mra-progress-label{color:#888;font-size:10px;text-align:right;margin-bottom:3px}

#mra-status{
  font-size:11px;
  color:#ccc;
  min-height:16px;
  word-break:break-word;
  line-height:1.4;
  text-align:center;
  padding:6px;
  background:rgba(15, 23, 42, 0.5);
  border-radius:6px;
  border:1px solid rgba(227, 6, 19, 0.15);
  transition: all 0.3s;
}
#mra-status.success {
  border-color: var(--mra-success);
  box-shadow: inset 0 0 8px var(--mra-success-glow);
  color: var(--mra-success);
}
#mra-status.error {
  border-color: var(--mra-primary);
  box-shadow: inset 0 0 8px var(--mra-primary-glow);
  color: var(--mra-primary);
}

.mra-wave-card{
  position:relative;
  overflow:hidden;
  padding:10px;
  background:linear-gradient(180deg,rgba(16,12,14,.98),rgba(8,6,7,.99));
  border:1px solid rgba(227,6,19,0.12);
  border-radius:10px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 18px 45px rgba(0,0,0,.45);
  
  max-height: 0;
  opacity: 0;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  border-width: 0 !important;
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.mra-wave-card.mra-visible {
  max-height: 560px;
  opacity: 1;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
  margin-top: 8px !important;
  margin-bottom: 12px !important;
  border-width: 1px !important;
}

.mra-wave-card:hover{border-color:rgba(227,6,19,0.28);box-shadow:0 18px 45px rgba(227,6,19,0.08);}
.mra-wave-card::before{content:'';position:absolute;left:10px;right:10px;top:0;height:1px;background:linear-gradient(90deg,var(--mra-primary),#ff9f43,var(--mra-primary));opacity:.8;}
.mra-wave-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.mra-wave-title{display:flex;flex-direction:column;}
.mra-wave-kicker{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#fff;display:flex;align-items:center;}
.mra-wave-dot{width:5px;height:5px;border-radius:50%;background:#e30613;display:inline-block;margin-right:6px;box-shadow:0 0 6px #e30613;}
.mra-wave-sub{font-size:9px;color:#888;}
.mra-wave-live{font-size:8px;font-weight:900;text-transform:uppercase;color:#e30613;background:rgba(227,6,19,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(227,6,19,0.2);letter-spacing:0.5px;}

#mra-waveform{width:100%;height:clamp(120px,20vh,260px);border:1px solid rgba(255,255,255,0.06);border-radius:6px;cursor:crosshair;background:#060506;display:block;}

.mra-wave-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;}
.mra-wave-zoom-group{display:flex;gap:2px;}
.mra-wave-btn{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:#e0e0e0;padding:2px 8px;font-size:10px;font-weight:800;border-radius:4px;cursor:pointer;transition:all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);outline:none;}
.mra-wave-btn:hover{background:rgba(255,255,255,0.1);color:#fff;transform:scale(1.08);}
.mra-wave-btn:active{transform:scale(0.93);}
.mra-wave-btn:focus-visible{outline:2px solid #ffffff;}
#mra-wave-zoom-reset{min-width:42px;text-align:center;}
#mra-wave-pan{flex:1;height:4px;-webkit-appearance:none;background:rgba(255,255,255,0.08);border-radius:99px;outline:none;cursor:pointer;}
#mra-wave-pan::-webkit-slider-runnable-track{height:4px;border-radius:99px;}
#mra-wave-pan::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:50%;background:#e30613;box-shadow:0 0 8px rgba(227,6,19,0.6);transition:transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);}
#mra-wave-pan::-webkit-slider-thumb:hover{transform:scale(1.25);}
#mra-wave-pan:focus-visible{outline:2px solid #ffffff;outline-offset:2px;}

.mra-wave-hints-toggle{display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);color:#aaa;font-size:10px;cursor:pointer;transition:all 0.2s;}
.mra-wave-hints-toggle:hover{background:rgba(255,255,255,0.05);color:#fff;}
.mra-wave-hints-toggle input{position:absolute;opacity:0;pointer-events:none;}
.mra-wave-switch{position:relative;width:28px;height:15px;flex-shrink:0;border-radius:99px;background:rgba(255,255,255,0.1);transition:background .25s;}
.mra-wave-switch:before{content:'';position:absolute;width:11px;height:11px;left:2px;top:2px;border-radius:50%;background:#aaa;transition:transform .3s cubic-bezier(0.34, 1.56, 0.64, 1), background .3s;}
.mra-wave-hints-toggle input:checked+.mra-wave-switch{background:#ff9f43;box-shadow:0 0 8px rgba(255,159,67,0.45);}
.mra-wave-hints-toggle input:checked+.mra-wave-switch:before{transform:translateX(13px);background:#fff;}
.mra-wave-hints-toggle:focus-visible{outline:2px solid #ffffff;}
.mra-wave-hints-copy{flex:1;}
.mra-wave-state{font-size:9px;font-weight:900;text-transform:uppercase;color:#ff9f43;background:rgba(255,159,67,0.15);padding:1px 4px;border-radius:4px;}
.mra-wave-hints-toggle.is-off .mra-wave-state{color:#777;background:rgba(255,255,255,0.05);}

.mra-wave-legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;color:#778294;font-size:8.8px;}
.mra-wave-chip{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}
.mra-wave-swatch{width:13px;height:2px;border-radius:999px;display:inline-block;background:#e30613;box-shadow:0 0 8px rgba(227,6,19,.42);}
.mra-wave-swatch.manual{background:#ff9f43;box-shadow:0 0 8px rgba(255,159,67,.35);}
.mra-wave-swatch.backup{background:#ffd166;box-shadow:0 0 8px rgba(255,209,102,.4);}
.mra-wave-swatch.sound{width:5px;height:11px;border-radius:2px;background:linear-gradient(180deg,#b9c8dd 0%,#6b7d99 100%);box-shadow:none;}
.mra-wave-swatch.hint{width:2px;height:11px;background:#ff9f43;box-shadow:0 0 8px rgba(255,159,67,.28);}
.mra-wave-swatch.existing{background:#7dd3fc;box-shadow:0 0 8px rgba(125,211,252,.4);}

#mra-stats {
  display: block !important;
  padding: 0px; 
  margin-bottom: 0px; 
  background:rgba(15, 23, 42, 0.65); 
  border-radius:8px; 
  border:0px solid rgba(227, 6, 19, 0.2); 
  text-align:center; 
  font-size:12px; 
  font-weight:600;
  
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
#mra-stats.mra-visible {
  max-height: 40px;
  opacity: 1;
  padding: 8px !important;
  margin-bottom: 8px !important;
  border: 1px solid rgba(227, 6, 19, 0.2) !important;
}

#mra-verdict {
  display: none;
  font-size: 10px;
  line-height: 1.5;
  color: #aab4c4;
  padding: 7px 9px;
  margin-bottom: 8px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-left: 2.5px solid #ff9f43;
  border-radius: 6px;
}

#mra-list > div {
  animation: mra-fade-in 0.2s ease-out forwards;
}
@keyframes mra-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes mra-pulse-red{0%,100%{box-shadow:0 0 5px rgba(227,6,19,0.2);border-color:rgba(227,6,19,0.3)}50%{box-shadow:0 0 15px rgba(227,6,19,0.78);border-color:rgba(227,6,19,0.78)}}
@keyframes mra-pulse-yellow{0%,100%{box-shadow:0 0 5px rgba(255,159,67,0.2);border-color:rgba(255,159,67,0.3)}50%{box-shadow:0 0 15px rgba(255,159,67,0.78);border-color:rgba(255,159,67,0.78)}}
.mra-pulse-red{animation:mra-pulse-red 2s ease-in-out infinite}
.mra-pulse-yellow{animation:mra-pulse-yellow 2.5s ease-in-out infinite}

/* ═══ FAQ авто-пілота ═══ */
.mra-faq-wrapper{margin-top:10px;border-top:1px solid rgba(255,255,255,0.08);padding-top:4px;}
.mra-faq-wrapper > summary{cursor:pointer;font-size:9px;font-weight:800;color:#ff9f43;letter-spacing:1px;text-transform:uppercase;padding:4px 6px;display:flex;justify-content:space-between;align-items:center;}
.mra-faq-wrapper > summary::-webkit-details-marker{display:none;}
.mra-faq-wrapper > summary::after{content:'▼';font-size:8px;color:#ff9f43;transition:transform 0.15s ease-in-out;}
.mra-faq-wrapper[open] > summary::after{transform:rotate(180deg);}

#mra-faq{margin-top:4px;}
#mra-faq details{border-top:1px solid rgba(255,255,255,0.05);}
#mra-faq details:first-child{border-top:none;}
#mra-faq summary{cursor:pointer;font-size:10px;font-weight:700;color:#cfd6e4;padding:5px 4px;list-style:none;display:flex;justify-content:space-between;align-items:center;transition:color .15s;}
#mra-faq summary::-webkit-details-marker{display:none;}
#mra-faq summary::after{content:'+';font-size:12px;font-weight:700;color:#ff9f43;flex-shrink:0;margin-left:5px;line-height:1;}
#mra-faq details[open] summary::after{content:'−';}
#mra-faq summary:hover{color:#fff;}
#mra-faq .mra-faq-a{font-size:9.5px;color:#bcc8dc;line-height:1.55;padding:0 4px 7px;user-select:text;-webkit-user-select:text;text-shadow:0 1px 3px rgba(0,0,0,0.6);}

/* ── Фонова 3D-фігура (скраб мишею, дзеркало popup_bg.js) ── */
#mra-bg-stage{position:absolute;inset:0;z-index:0;overflow:hidden;border-radius:inherit;pointer-events:none;}
#mra-bg-figure{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:88% 10%;opacity:0;transition:opacity .7s ease;}
#mra-bg-figure.ready{opacity:0.85;}
#mra-bg-points{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .6s ease;}
#mra-bg-points.ready{opacity:1;}
#mra-bg-stage.webgl-active #mra-bg-figure{opacity:0 !important;}
.mra-bg-glow{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% -10%, rgba(255,45,63,0.10) 0%, transparent 55%),radial-gradient(80% 50% at 100% 110%, rgba(255,182,39,0.05) 0%, transparent 60%);}
/* Легкий неон по зоні фігури (screen — лише додає світла);
   відтінок --mra-neon-h міняється рандомно на натискання клавіш */
@property --mra-neon-h { syntax:'<number>'; inherits:false; initial-value:352; }
.mra-fig-neon{position:absolute;inset:0;mix-blend-mode:screen;background:radial-gradient(42% 55% at 48% 28%, hsl(var(--mra-neon-h) 100% 56% / 0.26) 0%, hsl(var(--mra-neon-h) 100% 56% / 0.09) 45%, transparent 72%);transition:--mra-neon-h 0.6s ease;}
#mra-header{position:relative;z-index:1;}
#mra-body{position:relative;z-index:1;}
#mra-panel.mra-minimized #mra-bg-stage{display:none;}
    `;
    document.head.appendChild(styleEl);
  }
}

// Валера: фонова 3D-фігура з інтерактивним WebGL 3D Point Cloud рушієм
function _initFigureScrub(panel) {
  const stage = panel.querySelector('#mra-bg-stage');
  const video = panel.querySelector('#mra-bg-figure');
  const canvas = panel.querySelector('#mra-bg-points');
  const neon = panel.querySelector('.mra-fig-neon');
  const scroller = panel.querySelector('#mra-body');
  if (!video || !chrome.runtime?.id) return;

  if (window.initValeraPointCloud) {
    window.initValeraPointCloud({
      stage,
      video,
      canvas,
      neon,
      scroller,
      boundsEl: panel,
      actionRoot: panel,
      atlasUrl: chrome.runtime.getURL('media/figure_atlas.webp'),
      atlasCols: 12,
      atlasRows: 20,
      atlasFrames: 238,
      videoUrl: chrome.runtime.getURL('media/figure_dark.mp4'),
      fetchAsBlob: true,
      cols: 175,
      rows: 160,
      scale: 0.80,
      yShift: -0.04,
      pointSize: 2.45,
      threshold: 0.065,
      opY: 10,
      getBaseOP: () => panel.classList.contains('mra-size-small') ? 80 : 88,
      getEndOP: () => panel.classList.contains('mra-size-small') ? 67 : 64,
      isPaused: () => panel.classList.contains('mra-minimized'),
      trackListener: addTrackedEventListener
    });
  }
}

function createPanel() {
  if (document.getElementById('mra-panel')) return;

  createStylesInHead();

  const panel = document.createElement('div');
  panel.id = 'mra-panel';
  panel.innerHTML = `
<div id="mra-bg-stage" aria-hidden="true"><video id="mra-bg-figure" muted playsinline preload="none" tabindex="-1" title="Валера" disablepictureinpicture disableremoteplayback></video><canvas id="mra-bg-points"></canvas><div class="mra-bg-glow"></div><div class="mra-fig-neon"></div></div>
<div id="mra-live-bar" aria-hidden="true"></div>
<div id="mra-header">
  <div id="mra-title"><span style="background:var(--mra-primary);background-image:var(--mra-primary-grad);color:#fff;padding:2px 6px;border-radius:4px;margin-right:8px;box-shadow:0 0 10px rgba(255,46,85,0.5);">ТСН</span> АВТОРЕКЛАМА</div>
  <div style="display:flex;align-items:center;gap:6px">
    <button id="mra-size" title="Перемкнути розмір панелі" aria-label="Перемкнути розмір панелі">Менше</button>
    <button id="mra-reload" title="Перезапустити розширення (Очистити дані)" aria-label="Перезапустити розширення">↻</button>
    <button id="mra-minimize" title="Згорнути" aria-label="Згорнути панель">−</button>
    <button id="mra-close" title="Закрити панель" aria-label="Закрити панель">✕</button>
  </div>
</div>

<div id="mra-body">

  <div class="ms" style="border-color:rgba(227,6,19,0.3);">
    <div class="mst">🤖 Авто-пілот</div>
    <div class="mtw">
      <label class="mt"><input type="checkbox" id="mra-auto-gap" checked><span class="msl"></span></label>
      <label class="mtl" for="mra-auto-gap" style="font-weight:700;color:#fff;">Бот вирішує сам</label>
    </div>
    <div id="mra-auto-sect" style="color:#9aa7bd;font-size:10px;line-height:1.5;padding:2px 6px 0;">
      Сам рахує ціль за хронометражем (стандарт ТСН — 1 реклама / ~2 хв), пріоритетно знаходить природні
      паузи, заповнює великі прогалини в найтихіших місцях та може зберігати вже розставлені ручні мітки.
      Після аналізу нижче з'явиться діагноз відео.
      <details class="mra-faq-wrapper">
        <summary>FAQ — як бот вирішує</summary>
        <div id="mra-faq">
          <details>
            <summary>Що саме бот робить сам?</summary>
            <div class="mra-faq-a">Рахує ціль за хронометражем (стандарт ТСН — приблизно 1 реклама на 2 хвилини), аналізує вейвформу, пріоритетно ставить мітки у природні паузи мови та заповнює прогалини в найтихіших доступних місцях. За бажанням зберігає вже існуючі ручні мітки як непорушні якорі.</div>
          </details>

          <details>
            <summary>Що буде, якщо природних пауз мало?</summary>
            <div class="mra-faq-a">Бот адаптивно коригує чутливість до тиші. Якщо пауз усе одно бракує, він заповнює великі прогалини запасними мітками (жовті на вейвформі) у найтихіших точках відрізка — щоб реклама не «провисала».</div>
          </details>

          <details>
            <summary>Чим запасні мітки відрізняються від природних?</summary>
            <div class="mra-faq-a">Природні паузи — це чиста тиша між фразами. Запасні мітки ставляться в найтихіших доступних місцях, якщо повноцінної паузи в інтервалі немає, щоб уникнути довгих інтервалів без реклами.</div>
          </details>

          <details>
            <summary>Чи можу я втрутитися вручну?</summary>
            <div class="mra-faq-a">Так. Клік по вейвформі додає або прибирає мітку (вона примагнітиться до найближчої паузи), Ctrl+клік — прослухати місце. А якщо вимкнути «Бот вирішує сам», відкриються ручні налаштування ритму та чутливості.</div>
          </details>

          <details>
            <summary>Що таке «Авто-вставка (нуль кліків)»?</summary>
            <div class="mra-faq-a">Повний автопілот: відкрили редактор відео без міток — бот сам аналізує, виставляє оптимальні мітки та зберігає. Нуль зайвих рухів. Відео з уже наявними мітками не чіпає.</div>
          </details>

          <details>
            <summary>Як працює збереження ручних міток?</summary>
            <div class="mra-faq-a">Якщо увімкнено «Зберігати ручні мітки», бот зчитує вже наявні мітки автора як фіксовані якорі і лише доставляє рекламу у великі прогалини (> 2.5 хв), не видаляючи вашу розмітку.</div>
          </details>

          <details>
            <summary>Як бот враховує авто-мітки YouTube?</summary>
            <div class="mra-faq-a">Під час аналізу бот запам'ятовує позиції «Рекламних місць (автоматичних)» YouTube як 100%-якорі — це місця, які YT сам вважає природними. При вставці бот знімає чекбокс «Автоматичні рекламні місця» (вони зникають), видаляє всі решту непотрібних міток і ставить повний узгоджений план заново: якорі YT + природні паузи. Жодне вдале місце не губиться.</div>
          </details>
        </div>
      </details>
    </div>
    <div id="mra-manual-sect" style="display:none">
      ${row('Реклама кожні (с):', stepper('mra-min-gap', 120, 1, 7200, 1), 'Ручний ритм: мітка приблизно кожні N секунд у найближчій паузі')}
      ${row('Гнучкість ритму (±%):', stepper('mra-flex', 50, 10, 90, 5), 'Наскільки далеко від ритму можна зміститись заради паузи.\\n±50% від інтервалу = стандарт.\\nМенше = суворий ритм, більше = пріоритет паузам')}
      ${row('Мін. якість паузи (%):', stepper('mra-min-quality', 0, 0, 90, 5), '0 = будь-яка тиша\\n70+ = лише «добрі» паузи (межа прийняття YouTube)\\n78+ = лише «люкс»\\nПаузи нижче фільтра ігноруються — замість них спрацюють запасні (якщо увімкнені)')}
      ${row('Пропустити початок (с):', stepper('mra-start-skip', 10, 0, 600, 5), 'Не ставити рекламу в перші N секунд відео')}
      ${row('Пропустити кінець (с):', stepper('mra-end-skip', 15, 0, 600, 5), 'Не ставити рекламу в останні N секунд відео')}
    </div>
  </div>

  <div class="ms">
    <div class="mst">📊 Основне</div>
    <div>
      <div class="mtw">
        <label class="mt"><input type="checkbox" id="mra-full-auto"><span class="msl"></span></label>
        <label class="mtl" for="mra-full-auto" style="font-weight:600;color:#ffd166;" title="Відкрив редактор відео БЕЗ міток → бот сам: аналіз → вставка → збереження. Нуль кліків. Відео з мітками не чіпає.">⚡ Авто-вставка (нуль кліків)</label>
      </div>
      <div class="mtw" style="margin-top:6px;">
        <label class="mt"><input type="checkbox" id="mra-preserve-manual"><span class="msl"></span></label>
        <label class="mtl" for="mra-preserve-manual" title="Не видаляє існуючі ручні мітки на відео — залишає їх як якорі й доставляє рекламу лише у великі прогалини (> 2.5 хв).">📌 Зберігати ручні мітки (доповнити прогалини)</label>
      </div>
      <div class="mtw" style="margin-top:6px;">
        <label class="mt"><input type="checkbox" id="mra-focus-start" checked><span class="msl"></span></label>
        <label class="mtl" for="mra-focus-start" style="color:#ffffff;opacity:0.85;font-weight:500;">🎯 Більше реклами на початку (x2 буст)</label>
      </div>
      <div class="mtw" style="margin-top:6px;">
        <label class="mt"><input type="checkbox" id="mra-auto-open" checked><span class="msl"></span></label>
        <label class="mtl" for="mra-auto-open">🔄 Автоматично відкривати панель</label>
      </div>
      <div class="mtw" style="margin-top:6px;">
        <label class="mt"><input type="checkbox" id="mra-autosave" checked><span class="msl"></span></label>
        <label class="mtl" for="mra-autosave">💾 Автозбереження (Продовжити + Зберегти)</label>
      </div>
    </div>
  </div>

  <div class="ms" id="mra-tuning-sect">
    <div class="mst">🔇 Де ставити рекламу</div>
    ${row('Мін. пауза для реклами (с):', stepper('mra-min-silence', 1.5, 0.1, 30, 0.1), 'БОТ СТАВИТЬ РЕКЛАМУ ЛИШЕ ТАМ, ДЕ Є ПАУЗА ДОВША ЗА N СЕКУНД!\\nМісця з коротшою тишею — ПРОПУСКАЮТЬСЯ. Рекомендовано: 1.5-3 сек')}
    ${row('Чутливість до тиші (%):', stepper('mra-threshold', 15, 1, 50, 1), '↑ більше % = бот бачить менше пауз (тільки дуже тихі місця)\\n↓ менше % = бот бачить більше пауз (навіть напівтиші)')}
    <div class="mtw" style="margin-top:6px;">
      <label class="mt"><input type="checkbox" id="mra-guarantee" checked><span class="msl"></span></label>
      <label class="mtl" for="mra-guarantee" title="Якщо у потрібному місці немає справжньої паузи — бот ставить запасну мітку в найтихішій точці цього відрізка. Ритм реклами (~1 на 2 хв) ніколи не провисає.">🛟 Без пропусків (запасні мітки)</label>
    </div>
  </div>

  <button id="mra-analyze">🔴 Аналізувати паузи</button>

  <div class="ms mra-wave-card" id="mra-waveform-section">
    <div class="mra-wave-head">
      <div class="mra-wave-title">
        <div class="mra-wave-kicker"><span class="mra-wave-dot"></span>Вейвформа</div>
        <div class="mra-wave-sub">Клік — мітка · Ctrl+клік — прослухати місце</div>
      </div>
      <div class="mra-wave-live">аналіз</div>
    </div>
    <canvas id="mra-waveform" width="282" height="104" title="Клік по жовтій вертикалі = додати/видалити мітку&#10;Ctrl+клік = прослухати це місце у плеєрі"></canvas>
    <div class="mra-wave-toolbar" id="mra-wave-zoom">
      <div class="mra-wave-zoom-group">
        <button class="mra-wave-btn" id="mra-wave-zoom-out" title="Віддалити" aria-label="Віддалити вейвформу">−</button>
        <button class="mra-wave-btn" id="mra-wave-zoom-reset" title="Скинути масштаб" aria-label="Скинути масштаб вейвформи">100%</button>
        <button class="mra-wave-btn" id="mra-wave-zoom-in" title="Наблизити" aria-label="Наблизити вейвформу">+</button>
      </div>
      <input id="mra-wave-pan" type="range" min="0" max="100" step="0.01" value="0" title="Позиція у збільшеній вейвформі" aria-label="Прокрутка вейвформи">
    </div>
    <label class="mra-wave-hints-toggle" id="mra-wave-hints-wrap" title="Показувати жовті вертикалі, де ще можна вручну поставити рекламу">
      <input id="mra-wave-hints" type="checkbox" checked>
      <span class="mra-wave-switch"></span>
      <span class="mra-wave-hints-copy">Підказувати, куди можна поставити</span>
      <span class="mra-wave-state" id="mra-wave-hints-label">так</span>
    </label>
    <div class="mra-wave-legend">
      <span class="mra-wave-chip"><span class="mra-wave-swatch"></span>авто</span>
      <span class="mra-wave-chip"><span class="mra-wave-swatch manual"></span>вручну</span>
      <span class="mra-wave-chip"><span class="mra-wave-swatch backup"></span>запасна</span>
      <span class="mra-wave-chip"><span class="mra-wave-swatch existing"></span>вже на відео</span>
      <span class="mra-wave-chip"><span class="mra-wave-swatch sound"></span>звук</span>
      <span class="mra-wave-chip"><span class="mra-wave-swatch hint"></span>можна вручну</span>
    </div>
  </div>

  <div id="mra-stats"></div>
  <div id="mra-verdict"></div>
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

  _initFigureScrub(panel);

  _restoreSettingsToUI();

  const keyBlocker = (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('stp-v')) {
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
  };
  ['keydown', 'keyup', 'keypress'].forEach(evtType => {
    addPanelEventListener(window, evtType, keyBlocker, { capture: true });
  });

  let analyzeTimer = null;
  function triggerAutoAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => {
      readSettings();
      saveSettings();
      if (state.cachedAudioBuffer) {
        analyzeWaveform().catch(e => console.error(e));
      }
    }, 250);
  }

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

    let holdTimer = null;
    let intervalTimer = null;

    const stopHold = () => {
      clearTimeout(holdTimer);
      clearInterval(intervalTimer);
      holdTimer = null;
      intervalTimer = null;
    };

    const startHold = (isPlus) => {
      stopHold();

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

    addPanelEventListener(window, 'mouseup', stopHold);
    addPanelEventListener(window, 'touchend', stopHold);

    valEl.style.cursor = 'pointer';
    const onValClick = () => {
      const currentVal = valEl.value;
      const newValStr = prompt(`Введіть нове значення (мінімум: ${minVal}, максимум: ${maxVal}):`, currentVal);
      if (newValStr !== null && newValStr.trim() !== '') {
        updateVal(newValStr.replace(',', '.'));
      }
    };
    addTrackedEventListener(valEl, 'click', onValClick);

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = parseFloat(valEl.value) || parseFloat(stp.dataset.val);
      if (e.deltaY < 0) updateVal(cur + step);
      else updateVal(cur - step);
    };
    addTrackedEventListener(stp, 'wheel', onWheel, { passive: false });
  });

  const autoGapCb = document.getElementById('mra-auto-gap');
  autoGapCb.addEventListener('change', () => {
    document.getElementById('mra-auto-sect').style.display = autoGapCb.checked ? '' : 'none';
    document.getElementById('mra-manual-sect').style.display = autoGapCb.checked ? 'none' : '';
    // Авто-пілот керує чутливістю і запасними сам — ручні налаштування лише в ручному режимі
    const tuningSect = document.getElementById('mra-tuning-sect');
    if (tuningSect) tuningSect.style.display = autoGapCb.checked ? 'none' : '';
    triggerAutoAnalyze();
  });

  const guaranteeCb = document.getElementById('mra-guarantee');
  if (guaranteeCb) guaranteeCb.addEventListener('change', triggerAutoAnalyze);

  const focusStartCb = document.getElementById('mra-focus-start');
  if (focusStartCb) focusStartCb.addEventListener('change', triggerAutoAnalyze);

  const autoOpenCbEvt = document.getElementById('mra-auto-open');
  if (autoOpenCbEvt) {
    autoOpenCbEvt.addEventListener('change', () => {
      CONFIG.autoOpenPanel = autoOpenCbEvt.checked;
      saveSettings();
    });
  }

  const autosaveCbEvt = document.getElementById('mra-autosave');
  if (autosaveCbEvt) {
    autosaveCbEvt.addEventListener('change', () => {
      CONFIG.autoSaveAfterInsert = autosaveCbEvt.checked;
      saveSettings();
    });
  }

  const fullAutoCbEvt = document.getElementById('mra-full-auto');
  if (fullAutoCbEvt) {
    fullAutoCbEvt.addEventListener('change', () => {
      CONFIG.fullAutoInsert = fullAutoCbEvt.checked;
      saveSettings();
      // Якщо щойно увімкнули на сторінці з відео без міток — стартуємо одразу
      if (fullAutoCbEvt.checked && typeof maybeFullAutoRun === 'function') maybeFullAutoRun();
    });
  }

  const preserveManualCbEvt = document.getElementById('mra-preserve-manual');
  if (preserveManualCbEvt) {
    preserveManualCbEvt.addEventListener('change', () => {
      CONFIG.preserveManualMarks = preserveManualCbEvt.checked;
      saveSettings();
      triggerAutoAnalyze();
    });
  }

  document.getElementById('mra-analyze').addEventListener('click', async () => {
    updateStatus('⏳ Аналізуємо...', 'info');
    try { await analyzeWaveform(); }
    catch (e) { updateStatus('❌ Помилка: ' + e.message, 'error'); log(e.message, 'error'); }
  });

  function setWaveformZoom(nextZoom, anchor = 0.5) {
    if (!state.waveformData || !state.waveformData.duration) return;
    const duration = state.waveformData.duration;
    const view = getWaveformView(duration);
    const anchorSec = view.start + view.viewDuration * anchor;

    const zoom = Math.max(1, Math.min(16, nextZoom));
    const viewDuration = duration / zoom;

    state.waveformZoom = zoom;
    state.waveformOffsetSec = Math.max(0, Math.min(anchorSec - viewDuration * anchor, duration - viewDuration));
    resetWaveformRenderCache();
    updateWaveformZoomUI();
    scheduleWaveformRender();
  }

  function panWaveform(deltaSec) {
    if (!state.waveformData || !state.waveformData.duration) return;

    const view = getWaveformView(state.waveformData.duration);
    state.waveformOffsetSec = Math.max(0, Math.min(view.start + deltaSec, view.maxStart));
    resetWaveformRenderCache();
    updateWaveformZoomUI();
    scheduleWaveformRender();
  }

  function resetWaveformRenderCache() {
    lastRenderSignature = null;
  }

  function scheduleWaveformRender() {
    renderWaveform();
  }

  function updateWaveformHintsLabel() {
    const label = document.getElementById('mra-wave-hints-label');
    const wrap = document.getElementById('mra-wave-hints-wrap');
    if (!label) return;
    const hintsOn = state.waveformManualHints !== false;
    label.textContent = hintsOn ? 'так' : 'ні';
    if (wrap) {
      if (hintsOn) wrap.classList.remove('is-off');
      else wrap.classList.add('is-off');
    }
  }

  function updateWaveformZoomUI() {
    if (!state.waveformData || !state.waveformData.duration) return;
    const view = getWaveformView(state.waveformData.duration);

    const panSlider = document.getElementById('mra-wave-pan');
    if (panSlider) {
      panSlider.value = view.maxStart > 0 ? (view.start / view.maxStart) * 100 : 0;
      panSlider.disabled = view.zoom <= 1;
    }

    const zoomResetBtn = document.getElementById('mra-wave-zoom-reset');
    if (zoomResetBtn) {
      zoomResetBtn.textContent = view.zoom > 1 ? `${Math.round(view.zoom * 100)}%` : '100%';
    }
  }

  const zoomOutBtn = document.getElementById('mra-wave-zoom-out');
  const zoomResetBtn = document.getElementById('mra-wave-zoom-reset');
  const zoomInBtn = document.getElementById('mra-wave-zoom-in');
  const wavePan = document.getElementById('mra-wave-pan');
  const waveHints = document.getElementById('mra-wave-hints');

  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setWaveformZoom((state.waveformZoom || 1) / 1.2));
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => setWaveformZoom((state.waveformZoom || 1) * 1.2));
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => {
    state.waveformZoom = 1;
    state.waveformOffsetSec = 0;
    resetWaveformRenderCache();
    updateWaveformZoomUI();
    scheduleWaveformRender();
  });
  if (wavePan) wavePan.addEventListener('input', () => {
    if (!state.waveformData || !state.waveformData.duration) return;
    const view = getWaveformView(state.waveformData.duration);
    state.waveformOffsetSec = view.maxStart * ((parseFloat(wavePan.value) || 0) / 100);
    resetWaveformRenderCache();
    scheduleWaveformRender();
  });
  if (waveHints) {
    waveHints.checked = state.waveformManualHints !== false;
    waveHints.addEventListener('change', () => {
      state.waveformManualHints = waveHints.checked;
      updateWaveformHintsLabel();
      scheduleWaveformRender();
    });
  }
  globalThis.updateWaveformZoomUI = updateWaveformZoomUI;
  updateWaveformZoomUI();

  const waveformCanvas = document.getElementById('mra-waveform');
  if (waveformCanvas) {
    waveformCanvas.addEventListener('wheel', (e) => {
      if (!state.waveformData || !state.waveformData.duration) return;

      e.preventDefault();

      const rect = waveformCanvas.getBoundingClientRect();
      const anchorRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const view = getWaveformView(state.waveformData.duration);

      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        panWaveform(delta * (view.viewDuration / Math.max(rect.width, 1)) * 1.2);
        return;
      }

      const zoomFactor = Math.max(0.86, Math.min(1.16, Math.exp(-e.deltaY * 0.0012)));
      setWaveformZoom((state.waveformZoom || 1) * zoomFactor, anchorRatio);
    }, { passive: false });

    waveformCanvas.addEventListener('click', (e) => {
      if (!state.waveformData) return;

      const rect = waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickPercent = x / rect.width;
      const view = getWaveformView(state.waveformData.duration);
      const clickSec = view.start + clickPercent * view.viewDuration;

      // Ctrl/Cmd+клік — прослухати місце: плеєр Studio перемотується на 2с до точки
      if (e.ctrlKey || e.metaKey) {
        const v = document.querySelector('video');
        if (v) {
          v.currentTime = Math.max(0, clickSec - 2);
          const playPromise = v.play();
          if (playPromise && playPromise.catch) playPromise.catch(() => { });
          showHud(`▶ Прослуховування ${toTimecode(clickSec)}`, 'info', 2200);
        }
        return;
      }

      const existingIdx = state.selected.findIndex(s => Math.abs(s.seconds - clickSec) < 5);

      if (existingIdx !== -1) {
        state.selected.splice(existingIdx, 1);
        log(`Видалено мітку на ${toTimecode(clickSec)}`, 'warn');
        renderSelectedList();
        renderWaveform();
        return;
      }

      if (!state.silences || state.silences.length === 0) {
        log('❌ Немає знайдених пауз. Спочатку виконайте аналіз або змініть поріг тиші.', 'error');
        showHud('❌ Немає жовтих вертикалей пауз', 'error');
        return;
      }

      let closestSilence = null;
      let minDist = Infinity;
      let allowedSilence = null;

      state.silences.forEach(s => {
        const minVisualSec = view.viewDuration * (12 / rect.width);
        const halfDuration = Math.max((Number(s.ideal_duration_sec || s.duration_sec) || 0) / 2, minVisualSec / 2);
        const start = s.seconds - halfDuration;
        const end = s.seconds + halfDuration;
        const dist = Math.abs(s.seconds - clickSec);

        if (clickSec >= start && clickSec <= end) allowedSilence = s;
        if (dist < minDist) {
          minDist = dist;
          closestSilence = s;
        }
      });

      if (!allowedSilence) {
        const nearest = closestSilence ? ` Найближча пауза: ${toTimecode(closestSilence.seconds)}.` : '';
        log(`❌ Тут немає реальної паузи (${toTimecode(clickSec)}).${nearest}`, 'error');
        showHud(`❌ Клікніть по жовтій вертикалі паузи${closestSilence ? `\nнайближча: ${toTimecode(closestSilence.seconds)}` : ''}`, 'error');
        return;
      }

      closestSilence = allowedSilence;
      minDist = Math.abs(closestSilence.seconds - clickSec);
      const finalSec = closestSilence.seconds;

      if (finalSec < 0 || finalSec >= state.waveformData.duration) {
        log(`Таймкод за межами відео: ${toTimecode(finalSec)}`, 'error');
        updateStatus('❌ Таймкод за межами відео', 'error');
        return;
      }

      const snappedExistingIdx = state.selected.findIndex(s => Math.abs(s.seconds - finalSec) < 1);
      if (snappedExistingIdx !== -1) {
        state.selected.splice(snappedExistingIdx, 1);
        log(`Видалено мітку на ${toTimecode(finalSec)}`, 'warn');
        renderSelectedList();
        renderWaveform();
        return;
      }

      state.selected.push({
        timecode: toTimecode(finalSec),
        seconds: +finalSec.toFixed(2),
        duration_sec: closestSilence.duration_sec,
        ideal_duration_sec: closestSilence.ideal_duration_sec,
        amplitude: closestSilence.amplitude,
        quality_score: closestSilence.quality_score,
        quality_label: closestSilence.quality_label,
        silenceSource: 'detected',
        manual: true
      });
      state.selected.sort((a, b) => a.seconds - b.seconds);

      const distStr = minDist < 0.5 ? 'точно' : `±${minDist.toFixed(1)}с`;
      const msg = `🧲 Мітка: ${toTimecode(finalSec)}\n${distStr} від кліку · пауза ${closestSilence.duration_sec?.toFixed(1) || '?'}с`;
      log(msg.replace('\n', ' '), 'success');
      showHud(msg, 'success');
      updateStatus(`✅ Мітка на ${toTimecode(finalSec)}`, 'success');

      renderSelectedList();
      renderWaveform();
    });
  }

  document.getElementById('mra-insert').addEventListener('click', insertTimecodes);

  document.getElementById('mra-clear').addEventListener('click', async () => {
    updateStatus('🗑️ Очищення міток...', 'info');

    await ensureAutoAdsDisabled();
    const deleteBtns = getAdBreakDeleteButtons();
    if (deleteBtns.length === 0) {
      log('Не знайдено міток для видалення', 'warn');
      updateStatus('Не знайдено міток', 'warn');
      return;
    }
    await deleteAllExistingAdBreaks();
    updateStatus('🗑️ Всі реклами успішно видалено!', 'success');
  });

  document.getElementById('mra-minimize').addEventListener('click', () => {
    const btn = document.getElementById('mra-minimize');
    const isMinimized = panel.classList.toggle('mra-minimized');
    btn.textContent = isMinimized ? '+' : '−';
  });

  document.getElementById('mra-close').addEventListener('click', () => {
    isPanelClosedByUser = true;
    cleanupPanel();
    panel.remove();
    createReopenButton();
  });

  document.getElementById('mra-reload').addEventListener('click', () => {
    log('♻️ Перезавантаження розширення та скидання налаштувань...', 'info');
    resetSettings();
    state.cachedAudioBuffer = null;
    state.cachedAudioUrl = null;
    state.waveformData = null;
    state.waveformZoom = 1;
    state.waveformOffsetSec = 0;
    state.waveformManualHints = true;
    state.silences = [];
    state.selected = [];
    state.analysisMeta = null;
    state.existingMarks = [];
    state.ytAutoMarks = [];
    offscreenCanvas = null;
    lastRenderSignature = null;
    isPanelClosedByUser = false;
    cleanupPanel();
    panel.remove();
  });

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

  addPanelEventListener(document, 'mousemove', onMouseMove);
  addPanelEventListener(document, 'mouseup', onMouseUp);

  // Два пресети розміру (як у попапі) + синхронізація з реальною шириною:
  // клас .mra-size-small керує кадруванням фігури, кнопка показує наступну дію
  const PANEL_BIG = 500;
  const PANEL_SMALL = 360;
  const sizeBtn = document.getElementById('mra-size');
  const syncSizeUI = () => {
    const w = panel.getBoundingClientRect().width;
    const small = w < 440;
    panel.classList.toggle('mra-size-small', small);
    if (sizeBtn) sizeBtn.textContent = small ? 'Більше' : 'Менше';
  };
  if (sizeBtn) {
    sizeBtn.addEventListener('click', () => {
      const small = panel.getBoundingClientRect().width < 440;
      panel.style.width = (small ? PANEL_BIG : PANEL_SMALL) + 'px';
      syncSizeUI();
    });
  }

  // Гумово: відновлюємо вибраний розмір, але обмежуємо поточним екраном (адаптивність)
  const applyAdaptiveSize = () => {
    const maxW = Math.max(300, window.innerWidth - 24);
    const maxH = Math.max(200, window.innerHeight - 80);
    const cur = panel.getBoundingClientRect();
    if (cur.width > maxW) panel.style.width = maxW + 'px';
    if (cur.height > maxH) panel.style.height = maxH + 'px';
    // Тримаємо панель у межах вікна
    if (cur.left < 0) { panel.style.left = '8px'; panel.style.right = 'auto'; }
  };

  // Ключі v2: даємо всім новий дефолт 500px (старий збережений розмір ігнорується)
  safeChromeStorageGet(['mraPanelWidth2', 'mraPanelHeight2'], (data) => {
    const clampPx = (val, min, max) => {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n)) return null;
      return Math.max(min, Math.min(n, max)) + 'px';
    };
    const w = clampPx(data.mraPanelWidth2, 300, Math.max(300, window.innerWidth - 24));
    const h = clampPx(data.mraPanelHeight2, 200, Math.max(200, window.innerHeight - 80));
    if (w) panel.style.width = w;
    if (h) panel.style.height = h;
    applyAdaptiveSize();
    syncSizeUI();
  });

  // Підлаштування під розмір вікна браузера на льоту
  addPanelEventListener(window, 'resize', applyAdaptiveSize);

  let resizeTimer, waveTimer;
  const panelResizeObs = new ResizeObserver(() => {
    // Панель «розуміє» свій розмір: клас пресету і напис на кнопці — завжди актуальні
    syncSizeUI();

    // Чітка перемальовка вейвформи під нову ширину/висоту панелі (гумово)
    clearTimeout(waveTimer);
    waveTimer = setTimeout(() => {
      if (state.waveformData && typeof renderWaveform === 'function') renderWaveform();
    }, 120);

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      safeChromeStorageSet({
        mraPanelWidth2: panel.style.width,
        mraPanelHeight2: panel.style.height
      });
    }, 500);
  });
  panelResizeObs.observe(panel);
  panelObservers.push(panelResizeObs);

  if (typeof runHealthCheck === 'function') runHealthCheck();
}

function createReopenButton() {
  if (document.getElementById('mra-reopen-btn')) return;
  
  createStylesInHead();
  
  const btn = document.createElement('button');
  btn.id = 'mra-reopen-btn';
  btn.innerHTML = '⚡ Відкрити ТСН АвтоРеклама';

  btn.addEventListener('click', () => {
    isPanelClosedByUser = false;
    btn.remove();
  });

  document.body.appendChild(btn);
}
