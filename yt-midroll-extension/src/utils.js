// ─── УТИЛІТИ ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Чекає, поки condFn поверне truthy-значення (перевірка кожні intervalMs).
// Повертає це значення, або null якщо вийшов timeoutMs.
// У фонових вкладках Chrome тротлить таймери до ~1с — тому timeout тримаємо з запасом.
async function waitFor(condFn, timeoutMs = 3000, intervalMs = 90) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try { v = condFn(); } catch (e) { /* DOM міг змінитись між перевірками */ }
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

function isExtensionContextError(error) {
  const msg = String(error?.message || error || '');
  return msg.includes('Extension context invalidated') || msg.includes('context invalidated');
}

function hasChromeStorage() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch (e) {
    return false;
  }
}

function safeChromeStorageGet(keys, callback, fallback = {}) {
  if (!hasChromeStorage()) {
    if (callback) callback(fallback);
    return false;
  }

  try {
    chrome.storage.local.get(keys, (data) => {
      try {
        if (chrome.runtime?.lastError) {
          if (callback) callback(fallback);
          return;
        }
        if (callback) callback(data || fallback);
      } catch (e) {
        if (!isExtensionContextError(e)) console.warn('[MRA] chrome.storage.get callback failed:', e);
        if (callback) callback(fallback);
      }
    });
    return true;
  } catch (e) {
    if (!isExtensionContextError(e)) console.warn('[MRA] chrome.storage.get failed:', e);
    if (callback) callback(fallback);
    return false;
  }
}

function safeChromeStorageSet(values, callback) {
  if (!hasChromeStorage()) {
    if (callback) callback(false);
    return false;
  }

  try {
    chrome.storage.local.set(values, () => {
      try {
        if (chrome.runtime?.lastError) {
          if (callback) callback(false);
          return;
        }
        if (callback) callback(true);
      } catch (e) {
        if (!isExtensionContextError(e)) console.warn('[MRA] chrome.storage.set callback failed:', e);
        if (callback) callback(false);
      }
    });
    return true;
  } catch (e) {
    if (!isExtensionContextError(e)) console.warn('[MRA] chrome.storage.set failed:', e);
    if (callback) callback(false);
    return false;
  }
}

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

// Пошук чекбокса автоматичних рекламних місць YouTube (мультимовний)
function findAutoAdsCheckbox() {
  const candidates = document.querySelectorAll('div[role="checkbox"], ytcp-checkbox-lit, tp-yt-paper-checkbox');
  const pattern = /автоматичн.*реклам|automatic ad break|автоматическ.*реклам/i;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const label = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
    if (pattern.test(label)) return el;
  }
  return document.querySelector('div[role="checkbox"][aria-label*="Автоматичні рекламні"]');
}

// Стабільний ідентифікатор поточного відео (без підписаних параметрів запиту)
function getCurrentVideoKey() {
  const videoIdMatch = window.location.pathname.match(/\/video\/([^/]+)/);
  if (videoIdMatch && videoIdMatch[1]) {
    return videoIdMatch[1];
  }
  if (state.waveformUrl) {
    try {
      return new URL(state.waveformUrl).pathname.slice(-40);
    } catch (e) { /* ignore */ }
  }
  return 'unknown';
}

// Кешована тривалість відео (оновлюється при аналізі через updateCachedVideoDuration)
var _cachedVideoDuration = 0;

function updateCachedVideoDuration() {
  const video = document.querySelector('video');
  _cachedVideoDuration = video && isFinite(video.duration) ? video.duration : 0;
}

// Чекаємо на завантаження метаданих відео з таймаутом
async function waitForVideoDuration(timeoutMs = 10000) {
  const video = document.querySelector('video');
  if (!video) {
    return null;
  }

  // Якщо тривалість вже доступна
  if (isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      video.removeEventListener('loadedmetadata', onMetadata);
      resolve(null);
    }, timeoutMs);

    const onMetadata = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onMetadata);
      const duration = video.duration;
      resolve(isFinite(duration) && duration > 0 ? duration : null);
    };

    video.addEventListener('loadedmetadata', onMetadata);
  });
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

// Зворотний парсер: "ГГ:ХХ:СС:КК" | "ХХ:СС:КК" | "ХХ:СС" → секунди (кадри 25fps)
function fromTimecode(tc) {
  const parts = String(tc || '').trim().split(':').map(p => parseInt(p, 10));
  if (!parts.length || parts.some(n => isNaN(n))) return null;

  let h = 0, m = 0, s = 0, f = 0;
  if (parts.length === 4) {
    [h, m, s, f] = parts;
  } else if (parts.length === 3) {
    if (parts[2] >= 25) {
      [h, m, s] = parts; // H:MM:SS (секунди не можуть бути кадром 25fps)
    } else {
      [m, s, f] = parts; // наш формат без годин: ХХ:СС:КК
    }
  } else if (parts.length === 2) {
    [m, s] = parts;
  } else {
    return null;
  }

  return h * 3600 + m * 60 + s + f / 25;
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
    CONFIG.autoSaveAfterInsert = document.getElementById('mra-autosave')?.checked ?? true;
    CONFIG.fullAutoInsert = document.getElementById('mra-full-auto')?.checked ?? false;
    CONFIG.preserveManualMarks = document.getElementById('mra-preserve-manual')?.checked ?? false;
    // Авто-пілот керує цими параметрами сам; ручні значення діють лише коли він вимкнений
    if (CONFIG.autoGap) {
      CONFIG.guaranteeStandard = true;
      CONFIG.rhythmFlexPct = 50;
      CONFIG.minQualityPct = 0;
      CONFIG.startOffsetSec = 10;
      CONFIG.endOffsetSec = 15;
    } else {
      CONFIG.guaranteeStandard = document.getElementById('mra-guarantee')?.checked ?? true;
      CONFIG.rhythmFlexPct = _clamp(getVal('mra-flex'), 10, 90, 50);
      CONFIG.minQualityPct = _clamp(getVal('mra-min-quality'), 0, 90, 0);
      CONFIG.startOffsetSec = _clamp(getVal('mra-start-skip'), 0, 600, 10);
      CONFIG.endOffsetSec = _clamp(getVal('mra-end-skip'), 0, 600, 15);
    }

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
  'minGapSec', 'shortVideoCutoff', 'longVideoGapSec', 'shortVideoGapSec', 'autoSaveAfterInsert', 'guaranteeStandard',
  'rhythmFlexPct', 'minQualityPct', 'startOffsetSec', 'endOffsetSec', 'fullAutoInsert', 'preserveManualMarks'];

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

// ─── АВТОЗБЕРЕЖЕННЯ: Продовжити + Зберегти ──────────────────────────────────

// Знаходить кнопку за aria-label або текстом (підтримка Shadow DOM)
function findButtonByLabel(labelText) {
  const targets = labelText.toLowerCase();
  const variants = [targets];

  // Синоніми для "Продовжити"
  if (targets === 'продовжити') {
    variants.push('continue', 'next', 'далі');
  }
  // Синоніми для "Зберегти"
  if (targets === 'зберегти') {
    variants.push('save', 'збереження');
  }

  // 1. Швидкий пошук через aria-label
  for (const v of variants) {
    const capitalized = v.charAt(0).toUpperCase() + v.slice(1);
    const btn = document.querySelector('button[aria-label="' + capitalized + '"]');
    if (btn && btn.getBoundingClientRect().width > 0 && !btn.disabled) return btn;

    const btn2 = document.querySelector('button[aria-label="' + v + '"]');
    if (btn2 && btn2.getBoundingClientRect().width > 0 && !btn2.disabled) return btn2;
  }

  // 2. Пошук за текстом у кнопках (aria-label може бути іншим)
  var candidates = document.querySelectorAll(
    'ytcp-button-shape button, button, ytcp-button'
  );
  for (const btn of candidates) {
    if (btn.getBoundingClientRect().width === 0 || btn.disabled) continue;
    var text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var label = (btn.getAttribute('aria-label') || '').toLowerCase();
    for (const v of variants) {
      if (text === v || label === v || text.includes(v)) {
        return btn;
      }
    }
  }

  // 3. Shadow DOM пошук: спершу шукаємо у активних діалогах/редакторі, потім у всьому body
  function searchShadowRoot(root) {
    if (!root) return null;
    if (root.shadowRoot) {
      const res = searchShadowRoot(root.shadowRoot);
      if (res) return res;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        var result = searchShadowRoot(el.shadowRoot);
        if (result) return result;
      }
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'button' || tag.startsWith('ytcp-')) {
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !el.disabled) {
          var stext = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          var slabel = (el.getAttribute ? (el.getAttribute('aria-label') || '') : '').toLowerCase();
          for (const v of variants) {
            if (stext === v || slabel === v || stext.includes(v)) {
              return el;
            }
          }
        }
      }
    }
    return null;
  }

  const scopedRoots = document.querySelectorAll('ytcp-dialog:not([hidden]), tp-yt-paper-dialog:not([aria-hidden="true"]), ytve-ad-breaks-editor, ytve-editor');
  for (const root of scopedRoots) {
    const found = searchShadowRoot(root);
    if (found) return found;
  }

  return searchShadowRoot(document.body);
}

// Послідовно натискає "Продовжити", а потім "Зберегти" з очікуванням
async function autoSaveFlow() {
  log('🤖 Автозбереження: шукаємо кнопку "Продовжити"...', 'info');
  updateStatus('🤖 Натискаємо "Продовжити"...', 'info');

  // Чекаємо появу кнопки "Продовжити" (до 10 секунд)
  const continueBtn = await waitFor(() => findButtonByLabel('Продовжити'), 10000, 150);

  if (!continueBtn) {
    log('⚠️ Автозбереження: кнопку "Продовжити" не знайдено', 'warn');
    updateStatus('⚠️ Кнопку "Продовжити" не знайдено. Натисніть вручну.', 'warn');
    return false;
  }

  log('🤖 Автозбереження: натискаємо "Продовжити"', 'success');
  showHud('🤖 Натискаємо "Продовжити"...', 'info', 2000);
  continueBtn.click();
  await sleep(250); // буфер, щоб діалог встиг перемкнути стан

  // Чекаємо появу кнопки "Зберегти" — це і є сигнал, що клік оброблено (до 10 секунд)
  log('🤖 Автозбереження: шукаємо кнопку "Зберегти"...', 'info');
  updateStatus('🤖 Натискаємо "Зберегти"...', 'info');

  const saveBtn = await waitFor(() => findButtonByLabel('Зберегти'), 10000, 150);

  if (!saveBtn) {
    log('⚠️ Автозбереження: кнопку "Зберегти" не знайдено', 'warn');
    updateStatus('⚠️ Кнопку "Зберегти" не знайдено. Натисніть вручну.', 'warn');
    return false;
  }

  log('🤖 Автозбереження: натискаємо "Зберегти"', 'success');
  showHud('🤖 Натискаємо "Зберегти"...', 'info', 2000);
  saveBtn.click();
  await sleep(300);

  const saveConfirmed = await waitFor(() => !findButtonByLabel('Зберегти'), 8000, 200);
  if (!saveConfirmed) {
    log('⚠️ Автозбереження: кнопка "Зберегти" досі активна — перевірте, чи не виникла помилка збереження', 'warn');
    updateStatus('⚠️ Не вдалося підтвердити збереження — перевірте кнопку «Зберегти» вручну.', 'warn');
    return false;
  }

  log('✅ Автозбереження: готово! Мітки збережено.', 'success');
  showHud('✅ Мітки збережено!', 'success', 3000);
  updateStatus('✅ Мітки збережено автоматично!', 'success');
  return true;
}

// ─── HEALTH-CHECK: чи на місці критичні елементи Studio ─────────────────────
// YouTube періодично оновлює інтерфейс — тоді бот ламається тихо.
// Ця перевірка чесно повідомляє, що саме зникло.
async function runHealthCheck() {
  const collect = () => {
    const problems = [];
    if (!document.querySelector('video')) problems.push('відеоплеєр');
    if (!findInsertAdBreakButton()) problems.push('кнопку вставки міток');
    if (!document.querySelector('input.ytcp-media-timestamp-input, ytcp-media-timestamp-input input')) problems.push('інпут таймкоду');
    if (!state.waveformUrl) problems.push('вейвформу (не перехоплено)');
    return problems;
  };

  await sleep(5000);
  if (!document.getElementById('mra-panel')) return true;
  let problems = collect();

  if (problems.length) {
    // Повільне завантаження редактора — даємо другий шанс
    await sleep(7000);
    if (!document.getElementById('mra-panel')) return true;
    problems = collect();
  }

  if (problems.length) {
    log(`🩺 Health-check: не бачу ${problems.join(', ')}. Якщо редактор давно відкритий — YouTube міг оновити інтерфейс, потрібен фікс розширення.`, 'warn');
    if (!state.analyzing && !state.inserting && !state.selected.length) {
      updateStatus(`⚠️ Не бачу: ${problems.join(', ')}`, 'warn');
    }
    return false;
  }

  log('🩺 Health-check: усі елементи Studio на місці', 'success');
  return true;
}
globalThis.mraHealthCheck = runHealthCheck;

function resetSettings() {
  const defaults = {
    autoOpenPanel: true,
    autoGap: true,
    guaranteeStandard: true,
    rhythmFlexPct: 50,
    minQualityPct: 0,
    startOffsetSec: 10,
    endOffsetSec: 15,
    minGapSec: 120,
    shortVideoCutoff: 600,
    longVideoGapSec: 120,
    shortVideoGapSec: 60,
    minSilenceSec: 1.5,
    silenceThresholdPct: 15,
    focusStart: true,
    autoSaveAfterInsert: true,
    fullAutoInsert: false,
    preserveManualMarks: false,
  };
  Object.assign(CONFIG, defaults);
  try {
    localStorage.removeItem('mraSettings');
  } catch (e) { /* ignore */ }
  log('Налаштування скинуто до заводських', 'info');
}
