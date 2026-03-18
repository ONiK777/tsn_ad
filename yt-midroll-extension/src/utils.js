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
    if (parsedUrl.protocol !== 'https:') return false;
    const host = parsedUrl.hostname;
    return host.includes('youtube.com') || host.includes('googlevideo.com') ||
      host.includes('ytimg.com') || host.includes('ggpht.com') || host.includes('googleusercontent.com');
  } catch {
    return false;
  }
}

function log(msg, type = 'info') {
  const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' };
  console.log(`%c🎬 [MRA] ${msg}`, `color:${c[type] || c.info}`);
}

// Кеш для DOM елементів з TTL (time-to-live)
var domCacheWithTTL = {
  cache: new Map(),
  TTL: 5000,

  set(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  },

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

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

// Безпечний пошук максимуму у Float32Array (без spread → без stack overflow)
function arrayMax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

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

function findConfirmButton() {
  // Шукаємо тільки у ВИДИМИХ діалогах (не в прихованих/закритих)
  const dialogs = document.querySelectorAll('ytcp-dialog, .ytcp-dialog');
  for (const dialog of dialogs) {
    if (dialog.hasAttribute('hidden') || dialog.style.display === 'none' || dialog.getBoundingClientRect().width === 0) continue;
    for (const btn of dialog.querySelectorAll('button')) {
      if (btn.getBoundingClientRect().width === 0) continue; // Пропускаємо невидимі кнопки
      const t = btn.textContent?.toLowerCase() || '';
      if (['ok', 'confirm', 'підтвердити'].some(v => t.includes(v))) return btn;
    }
  }
  return null;
}

// Кешована тривалість відео (оновлюється при аналізі через updateCachedVideoDuration)
var _cachedVideoDuration = 0;

function updateCachedVideoDuration() {
  const video = document.querySelector('video');
  _cachedVideoDuration = video && isFinite(video.duration) ? video.duration : 0;
}

function toTimecode(seconds) {
  // YouTube Studio приймає формат [ГГ:]ММ:СС:КК (кадри, 25fps)
  const f = Math.min(24, Math.floor((seconds % 1) * 25));
  const sec = Math.floor(seconds) % 60;
  const min = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);

  const totalH = Math.floor(_cachedVideoDuration / 3600);

  if (h > 0 || totalH > 0) {
    return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
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

// ── HUD-сповіщення (плаваючий оверлей у стилі scheduler) ──
function showHud(text, type = 'info', durationMs = 3000) {
  const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' }[type] || '#4cc9f0';

  // Видаляємо попередній HUD
  document.getElementById('mra-hud-toast')?.remove();

  const el = document.createElement('div');
  el.id = 'mra-hud-toast';
  el.textContent = text;
  el.style.cssText = `
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%) translateY(10px);
    background: rgba(17,17,17,0.95);
    color: ${c};
    border: 2px solid ${c};
    border-radius: 10px;
    padding: 12px 22px;
    font-family: 'Roboto', sans-serif;
    font-size: 14px;
    font-weight: 700;
    z-index: 2147483647;
    box-shadow: 0 4px 24px rgba(0,0,0,0.7);
    pointer-events: none;
    white-space: pre-wrap;
    max-width: 480px;
    text-align: center;
    transition: opacity 0.4s ease, transform 0.3s ease;
    opacity: 0;
  `;
  document.body.appendChild(el);

  // Анімація появи
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // Автозакриття
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => el.remove(), 400);
  }, durationMs);
}


function updateProgress(cur, total) {
  const bar = document.getElementById('mra-progress-bar');
  const label = document.getElementById('mra-progress-label');
  if (!bar || !label) return;
  bar.style.width = (total ? Math.round(cur / total * 100) : 0) + '%';
  label.textContent = total ? `${cur} / ${total}` : '';
}

// ─── ЧИТАННЯ НАЛАШТУВАНЬ З ПАНЕЛІ ────────────────────────────────────────────
var _clamp = (val, min, max, defaultVal) => {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num)) return defaultVal;
  return Math.max(min, Math.min(max, num));
};

function readSettings() {
  try {
    CONFIG.minSilenceSec = _clamp(getVal('mra-min-silence'), 0.1, 30, 1.5);
    CONFIG.silenceThresholdPct = _clamp(getVal('mra-threshold'), 1, 50, 15);

    CONFIG.focusStart = document.getElementById('mra-focus-start')?.checked ?? true;
    CONFIG.autoOpenPanel = document.getElementById('mra-auto-open')?.checked ?? true;
    CONFIG.autoGap = document.getElementById('mra-auto-gap')?.checked ?? true;

    CONFIG.minGapSec = _clamp(getVal('mra-min-gap'), 1, 7200, 120);
    CONFIG.shortVideoCutoff = _clamp(getVal('mra-cutoff'), 1, 120, 10) * 60;
    CONFIG.longVideoGapSec = _clamp(getVal('mra-long-gap'), 1, 3600, 120);
    CONFIG.shortVideoGapSec = _clamp(getVal('mra-short-gap'), 1, 600, 60);

    log(`Налаштування: gap=${CONFIG.autoGap ? 'auto' : CONFIG.minGapSec + 's'}`, 'info');
  } catch (error) {
    log('⚠️ Помилка читання налаштувань, використовуємо defaults: ' + error.message, 'warn');
  }
}

// ─── ЗБЕРЕЖЕННЯ / ЗАВАНТАЖЕННЯ НАЛАШТУВАНЬ ───────────────────────────────────
var SETTINGS_KEYS = ['autoOpenPanel', 'minSilenceSec', 'silenceThresholdPct', 'focusStart', 'autoGap',
  'minGapSec', 'shortVideoCutoff', 'longVideoGapSec', 'shortVideoGapSec'];

function saveSettings() {
  try {
    const data = {};
    SETTINGS_KEYS.forEach(k => { data[k] = CONFIG[k]; });
    localStorage.setItem('mraSettings', JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('mraSettings');
    if (raw) {
      const s = JSON.parse(raw);
      SETTINGS_KEYS.forEach(k => {
        if (s[k] !== undefined) CONFIG[k] = s[k];
      });
      log('Налаштування завантажено з попередньої сесії', 'info');
    }
  } catch (e) { /* ignore */ }
}

function resetSettings() {
  const defaults = {
    autoOpenPanel: true,
    autoGap: true,
    minGapSec: 120,
    shortVideoCutoff: 600,
    longVideoGapSec: 120,
    shortVideoGapSec: 60,
    minSilenceSec: 1.5,
    silenceThresholdPct: 15,
    focusStart: true,
  };
  Object.assign(CONFIG, defaults);
  try {
    localStorage.removeItem('mraSettings');
  } catch (e) { /* ignore */ }
  log('Налаштування скинуто до заводських', 'info');
}
