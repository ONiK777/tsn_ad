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
    return parsedUrl.protocol === 'https:' && parsedUrl.hostname.includes('youtube.com');
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
  for (const btn of document.querySelectorAll('ytcp-dialog button, .ytcp-dialog button')) {
    const t = btn.textContent?.toLowerCase() || '';
    if (['insert', 'вставити', 'ok', 'confirm', 'підтвердити'].some(v => t.includes(v))) return btn;
  }
  return null;
}

function toTimecode(seconds) {
  // YouTube Studio приймає формат [ГГ:]ММ:СС:КК (кадри, 25fps)
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
var _clamp = (val, min, max, defaultVal) => {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num)) return defaultVal;
  return Math.max(min, Math.min(max, num));
};

function readSettings() {
  try {
    CONFIG.minSilenceSec = _clamp(getVal('mra-min-silence'), 0.5, 30, 1.5);
    CONFIG.silenceThresholdPct = _clamp(getVal('mra-threshold'), 1, 50, 15);

    CONFIG.focusStart = document.getElementById('mra-focus-start')?.checked ?? true;
    CONFIG.autoGap = document.getElementById('mra-auto-gap')?.checked ?? true;

    CONFIG.minGapSec = _clamp(getVal('mra-min-gap'), 10, 7200, 180);
    CONFIG.shortVideoCutoff = _clamp(getVal('mra-cutoff'), 1, 120, 10) * 60;
    CONFIG.longVideoGapSec = _clamp(getVal('mra-long-gap'), 10, 3600, 180);
    CONFIG.shortVideoGapSec = _clamp(getVal('mra-short-gap'), 10, 600, 60);

    // Зберігаємо налаштування для наступної сесії
    saveSettings();

    log(`Налаштування: gap=${CONFIG.autoGap ? 'auto' : CONFIG.minGapSec + 's'}`, 'info');
  } catch (error) {
    log('⚠️ Помилка читання налаштувань, використовуємо defaults: ' + error.message, 'warn');
  }
}

// ─── ЗБЕРЕЖЕННЯ / ЗАВАНТАЖЕННЯ НАЛАШТУВАНЬ ───────────────────────────────────
var SETTINGS_KEYS = ['minSilenceSec', 'silenceThresholdPct', 'focusStart', 'autoGap',
  'minGapSec', 'shortVideoCutoff', 'longVideoGapSec', 'shortVideoGapSec'];

function saveSettings() {
  try {
    const data = {};
    SETTINGS_KEYS.forEach(k => { data[k] = CONFIG[k]; });
    chrome.storage.local.set({ mraSettings: data });
  } catch (e) { /* ignore — не критично */ }
}

function loadSettings() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('mraSettings', result => {
        if (result && result.mraSettings) {
          const s = result.mraSettings;
          SETTINGS_KEYS.forEach(k => {
            if (s[k] !== undefined) CONFIG[k] = s[k];
          });
          log('Налаштування завантажено з попередньої сесії', 'info');
        }
        resolve();
      });
    } catch (e) {
      resolve(); // Якщо storage недоступний — просто продовжуємо
    }
  });
}

function resetSettings() {
  const defaults = {
    autoGap: true,
    minGapSec: 90,
    shortVideoCutoff: 600,
    longVideoGapSec: 110,
    shortVideoGapSec: 90,
    minSilenceSec: 1.5,
    silenceThresholdPct: 15,
    focusStart: true,
    actionDelay: 700,
  };
  Object.assign(CONFIG, defaults);
  try {
    chrome.storage.local.remove('mraSettings');
  } catch (e) { /* ignore */ }
  log('Налаштування скинуто до заводських', 'info');
}
