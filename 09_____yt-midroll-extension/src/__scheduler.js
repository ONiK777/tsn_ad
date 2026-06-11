// ─── SCHEDULER CONTENT SCRIPT ────────────────────────────────────────────────
// Запускається при кожному завантаженні studio.youtube.com.
// Перевіряє прапор pendingLaunch у chrome.storage — якщо є, стартує запуск.
// Також слухає пряме повідомлення від background.js після навігації.

(function () {
  'use strict';

  // ── Перевіряємо прапор одразу при завантаженні сторінки ──
  function checkPendingLaunch() {
    chrome.storage.local.get('pendingLaunch', (data) => {
      if (!data.pendingLaunch) return;

      const url = window.location.href;
      console.log('[MRA Scheduler] 🚀 pendingLaunch detected on:', url);

      if (url.includes('livestreaming/manage')) {
        // ✅ На сторінці списку — знімаємо прапор і шукаємо рядок
        chrome.storage.local.set({ pendingLaunch: false });
        waitForPageAndLaunch(16, 1200);
      } else if (url.includes('/livestreaming') || url.includes('/video/')) {
        // ✅ Вже на сторінці конкретного стріму — ТИСНЕМО GO LIVE ОДРАЗУ!
        console.log('[MRA Scheduler] 🎯 Already on livestream page, clicking Go Live directly!');
        chrome.storage.local.set({ pendingLaunch: false });
        waitForGoLiveButton(20, 1500);
      } else {
        // ⚠️ Ми на іншій сторінці Studio — переходимо на manage
        console.log('[MRA Scheduler] Not on livestream page, navigating...');
        window.location.href = 'https://studio.youtube.com/livestreaming/manage';
        // pendingLaunch залишається true — content script підхопить після завантаження
      }
    });
  }

  // Запускаємо перевірку після готовності DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingLaunch);
  } else {
    // Додаткова затримка — YouTube Studio рендерить список асинхронно
    setTimeout(checkPendingLaunch, 500);
  }

  // ── Слухаємо ПРЯМЕ повідомлення від background.js (резервний канал) ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'mra_launch_stream') return;

    const url = window.location.href;
    console.log('[MRA Scheduler] 📨 Direct launch message received, URL:', url);

    if (url.includes('livestreaming/manage')) {
      // ✅ На сторінці списку — шукаємо рядок і відкриваємо стрім
      chrome.storage.local.set({ pendingLaunch: false });
      waitForPageAndLaunch(16, 1200);
    } else if (url.includes('/livestreaming') || url.includes('/video/')) {
      // ✅ Вже на сторінці конкретного стріму — ТИСНЕМО GO LIVE ОДРАЗУ!
      console.log('[MRA Scheduler] 🎯 Already on stream page! Searching for Go Live button...');
      chrome.storage.local.set({ pendingLaunch: false });
      showOverlay('🔴 Шукаємо кнопку Go Live...', 'info');
      waitForGoLiveButton(20, 1500);
    } else {
      // Інша сторінка Studio — переходимо на manage
      chrome.storage.local.set({ pendingLaunch: true });
      window.location.href = 'https://studio.youtube.com/livestreaming/manage';
    }

    sendResponse({ started: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // КРОК 1: Чекаємо список і знаходимо сьогоднішню трансляцію
  // ────────────────────────────────────────────────────────────────────────────

  function waitForPageAndLaunch(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      showOverlay('❌ Не вдалося знайти трансляцію на сьогодні', 'error');
      return;
    }

    const rows = findAllStreamRows();
    if (!rows || rows.length === 0) {
      console.log('[MRA Scheduler] Waiting for stream list... (' + attemptsLeft + ')');
      setTimeout(() => waitForPageAndLaunch(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    const targetRow = findTodaysRow(rows);
    if (!targetRow) {
      console.warn('[MRA Scheduler] ⚠️ No stream found for today');
      showOverlay('⚠️ Трансляцію на сьогодні не знайдено в списку', 'warn');
      return;
    }

    const streamTitle = (targetRow.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 60);
    console.log('[MRA Scheduler] ✅ Today stream found:', streamTitle);
    showOverlay('🔴 Знайдено! Відкриваємо трансляцію...', 'info');

    // Клікаємо на рядок — переходимо на сторінку стріму
    const link = findStreamLink(targetRow);

    // Якщо є href — краще навігувати напряму (надійніше ніж click у Web Components)
    if (link && link.tagName === 'A' && link.href) {
      console.log('[MRA Scheduler] Navigating to stream URL:', link.href);
      window.location.href = link.href;
    } else {
      link.click();
    }

    // Чекаємо завантаження сторінки стріму → тиснемо Go Live
    setTimeout(() => waitForGoLiveButton(20, 1500), 3500);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // КРОК 2: Чекаємо кнопку Go Live і натискаємо
  // ────────────────────────────────────────────────────────────────────────────

  function waitForGoLiveButton(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      showOverlay('⚠️ Відкрито стрім — натисніть Go Live вручну', 'warn');
      return;
    }

    const btn = findGoLiveButton();

    if (!btn) {
      console.log('[MRA Scheduler] Go Live not found yet... (' + attemptsLeft + ') URL:', window.location.href);
      setTimeout(() => waitForGoLiveButton(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    if (btn.disabled || btn.getAttribute('disabled') !== null || btn.getAttribute('aria-disabled') === 'true') {
      console.log('[MRA Scheduler] Go Live is disabled, waiting...');
      setTimeout(() => waitForGoLiveButton(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    console.log('[MRA Scheduler] 🔴 FOUND GO LIVE BUTTON:', btn.outerHTML.substring(0, 150));
    showOverlay('🔴 Кнопку знайдено! Чекаємо завантаження YouTube Studio...', 'info');

    // Чекаємо 4с щоб YouTube Studio встиг завантажити внутрішні модулі (RequestBuilder)
    // 500мс замало! Помилка "No RequestBuilder for endpoint" = снайпали раніше ніж фреймворк встиг
    setTimeout(() => {
      // Перевіряємо що кнопка все ще на місці і не заблокована
      const freshBtn = findGoLiveButton();
      const clickTarget = freshBtn || btn;
      console.log('[MRA Scheduler] 🔴 CLICKING NOW!');
      showOverlay('🔴 Натискаємо Go Live...', 'info');
      clickTarget.click();
      // Обробляємо можливий діалог підтвердження
      setTimeout(handleConfirmDialog, 2000);
      setTimeout(handleConfirmDialog, 4000); // друга спроба
      // Після усіх дій — запускаємо контрольну перевірку
      setTimeout(() => verifyLiveStatus(), 8000);
    }, 4000);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ДОПОМІЖНІ ФУНКЦІЇ
  // ────────────────────────────────────────────────────────────────────────────

  // Знайти всі рядки таблиці трансляцій
  function findAllStreamRows() {
    // YouTube Studio кастомні елементи (пріоритет)
    const direct = [
      ...document.querySelectorAll('ytcp-video-row'),
      ...document.querySelectorAll('[class*="video-row"]'),
    ];
    if (direct.length > 0) return direct;

    // Fallback: рядки що містять маркери стрімів
    const filtered = Array.from(document.querySelectorAll('[role="row"], tr')).filter(r => {
      const t = r.textContent || '';
      return t.includes('Відеокодер') || t.includes('Трансл') || t.includes('НАЖИВО') || t.includes('Заплановано');
    });
    return filtered.length > 0 ? filtered : null;
  }

  // Знайти рядок з сьогоднішньою датою
  function findTodaysRow(rows) {
    const variants = buildTodayDateVariants(new Date());
    console.log('[MRA Scheduler] Date variants:', variants.slice(0, 4).join(' | '), '...');

    for (const row of rows) {
      const text = row.textContent || '';
      for (const v of variants) {
        if (text.includes(v)) {
          console.log('[MRA Scheduler] Matched date: "' + v + '"');
          return row;
        }
      }
    }
    return null;
  }

  // Всі формати сьогоднішньої дати що може показувати YouTube Studio
  function buildTodayDateVariants(date) {
    const d = date.getDate();
    const mo = date.getMonth();       // 0-based
    const y = date.getFullYear();
    const dd = String(d).padStart(2, '0');
    const mm = String(mo + 1).padStart(2, '0');

    const UA_SHORT = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];
    const UA_FULL = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

    const ms = UA_SHORT[mo];
    const mf = UA_FULL[mo];

    return [
      // Точний формат зі скріншота: "9 бер. 2026 р." / "10 бер. 2026 р."
      `${d} ${ms}. ${y} р.`,
      `${dd} ${ms}. ${y} р.`,
      // Без "р."
      `${d} ${ms}. ${y}`,
      `${dd} ${ms}. ${y}`,
      // Без крапки після місяця
      `${d} ${ms} ${y}`,
      `${dd} ${ms} ${y}`,
      // Повна назва місяця
      `${d} ${mf} ${y}`,
      `${dd} ${mf} ${y}`,
      // Числові формати
      `${dd}.${mm}.${y}`,
      `${dd}/${mm}/${y}`,
      `${y}-${mm}-${dd}`,
    ];
  }

  // Знайти клікабельне посилання у рядку стріму
  function findStreamLink(row) {
    return (
      row.querySelector('a[href*="/livestreaming/stream"]') ||
      row.querySelector('a[href*="livestreaming"]') ||
      row.querySelector('a') ||
      row  // fallback — клікаємо сам рядок
    );
  }

  // Знайти кнопку Go Live на сторінці стріму
  function findGoLiveButton() {
    // Спочатку точні селектори (не пов'язані з Тест-кнопкою)
    const selectors = [
      '#start-stream-button button',
      '#start-stream-button',
      'ytcp-go-live-button button',
      'ytcp-go-live-button',
      '#go-live-button',
      'ytcp-button-shape button[aria-label="Go live"]',
      'ytcp-button-shape button[aria-label="Почати трансляцію"]',
      'ytcp-button-shape button[aria-label="Розпочати трансляцію"]',
      'button[aria-label="Go live"]',
      'button[aria-label="Почати трансляцію"]',
      'button[aria-label="Розпочати трансляцію"]',
      'ytcp-button[aria-label="Go live"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0 && !el.disabled) {
        // Перевіряємо що це НЕ кнопка Тесту
        const text = (el.textContent || '').toLowerCase();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('тест') || label.includes('тест') || text.includes('test') || label.includes('test') || text.includes('preview')) continue;
        console.log('[MRA Scheduler] Found Go Live via selector:', sel);
        return el;
      }
    }

    // Текстовий/aria-label fallback (із перевіркою на Тест)
    const candidates = document.querySelectorAll(
      'ytcp-button-shape button, button, ytcp-button, ytcp-go-live-button, #start-stream-button'
    );

    const visible = Array.from(candidates).filter(b => b.getBoundingClientRect().width > 0 && !b.disabled);

    for (const btn of visible) {
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();

      // Виключаємо кнопки Тесту і Попереднього перегляду
      const isTest = text.includes('тест') || label.includes('тест') || text.includes('test') || label.includes('test') || text.includes('preview');
      if (isTest) continue;

      const isGoLive =
        text === 'go live' || text === 'почати трансляцію' || text === 'розпочати трансляцію' ||
        label === 'go live' || label.includes('почати трансляцію') || label.includes('розпочати трансляцію') ||
        label.includes('livestream now');

      if (isGoLive) {
        console.log('[MRA Scheduler] Found Go Live via text/label:', label || text);
        return btn;
      }
    }

    return null;
  }



  // Підтвердити діалог якщо з'явився після Go Live
  function handleConfirmDialog() {
    const selectors = [
      'ytcp-button[dialog-confirm]',
      'ytcp-button-shape button[aria-label*="підтвердити"]',
      'ytcp-button-shape button[aria-label*="Підтвердити"]',
      'button[cdkfocusinitial]',
      '.ytcp-confirmation-dialog ytcp-button:last-child',
    ];
    let clicked = false;
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent) {
        console.log('[MRA Scheduler] Confirming dialog:', sel);
        btn.click();
        clicked = true;
        break;
      }
    }
    showOverlay(clicked ? '🔴 Підтверджено! Чекаємо статус LIVE...' : '🔴 Go Live натиснуто! Чекаємо LIVE...', 'info');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ПЕРЕВІРКА: чи ефір реально запустився
  // ────────────────────────────────────────────────────────────────────────────

  function isStreamLive() {
    // Шукаємо будь-який видимий елемент з текстом LIVE / НАЖИВО / В ЕФІРІ
    const liveKeywords = ['LIVE', 'НАЖИВО', 'В ЕФІРІ', 'НАЖИВО ЗАРАЗ'];

    // CSS-селектори відомих LIVE-бейджів YouTube Studio
    const badgeSelectors = [
      'ytcp-live-badge',
      '[class*="live-badge"]',
      'ytcp-badge',
      '[aria-label*="live"]',
      '[aria-label*="наживо"]',
      '#broadcast-status',
    ];

    for (const sel of badgeSelectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0) {
        console.log('[MRA Scheduler] LIVE badge found via selector:', sel);
        return true;
      }
    }

    // Fallback: шукаємо текстовий маркер у видимих leaf-елементах
    const all = document.querySelectorAll('span, div, p, ytcp-badge, ytcp-live-badge');
    for (const el of all) {
      if (el.children.length > 0) continue; // тільки leaf-nodes
      if (el.getBoundingClientRect().width === 0) continue; // тільки видимі
      const t = (el.textContent || '').trim().toUpperCase();
      if (liveKeywords.some(kw => t === kw || t.startsWith(kw))) {
        console.log('[MRA Scheduler] LIVE status found via text:', t);
        return true;
      }
    }

    return false;
  }

  function getStreamTitle() {
    // Спроба 1: поле назви трансляції у YouTube Studio
    const titleSelectors = [
      'ytcp-social-suggestions-textbox[label="Title"] #input',
      'ytcp-social-suggestions-textbox #input',
      '#stream-title-text',
      '[data-testid="stream-title"]',
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = (el?.value || el?.textContent || '').trim();
      if (text) return text.substring(0, 60);
    }
    // Спроба 2: заголовок вкладки ("Назва - YouTube Studio")
    const fromTab = document.title.replace(/\s*[-–|]?\s*YouTube Studio\s*$/i, '').trim();
    return fromTab.substring(0, 60) || 'Невідома трансляція';
  }

  function verifyLiveStatus() {
    const START = Date.now();
    const MAX_WAIT_MS = 60000;
    const INTERVAL_MS = 5000;
    const title = getStreamTitle();

    showOverlay(`🔍 Перевіряємо: "${title}"...`, 'info');
    console.log('[MRA Scheduler] 🔍 Verifying live status for:', title);

    function check() {
      if (isStreamLive()) {
        console.log('[MRA Scheduler] ✅ Stream is LIVE:', title);
        showOverlay(`✅ НАЖИВО: "${title}" 🔴`, 'success');
        chrome.runtime.sendMessage({
          action: 'mra_live_verified',
          title,
          url: window.location.href
        });
        return;
      }

      const elapsed = Date.now() - START;
      console.log(`[MRA Scheduler] Not live yet: "${title}" (${Math.round(elapsed / 1000)}s)`);

      if (elapsed >= MAX_WAIT_MS) {
        console.error('[MRA Scheduler] 🚨 FAILED to go LIVE:', title);
        showOverlay(`🚨 НЕ ЗАПУСТИВСЯ: "${title}"!`, 'error');
        chrome.runtime.sendMessage({
          action: 'mra_live_check_failed',
          title,
          url: window.location.href
        });
        return;
      }

      setTimeout(check, INTERVAL_MS);
    }

    setTimeout(check, INTERVAL_MS);
  }


  // ── Оверлей-повідомлення поверх сторінки ──
  function showOverlay(text, type) {
    if (!document.getElementById('mra-sched-css')) {
      const s = document.createElement('style');
      s.id = 'mra-sched-css';
      s.textContent = `
        @keyframes mraIn { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        #mra-sched-overlay {
          position:fixed; top:20px; right:20px; z-index:2147483647;
          background:#111; border-radius:10px; padding:14px 22px;
          font-family:'Roboto','Segoe UI',sans-serif; font-size:14px; font-weight:bold;
          box-shadow:0 6px 28px rgba(0,0,0,.7); animation:mraIn .3s ease;
          min-width:240px; pointer-events:none;
        }
      `;
      document.head.appendChild(s);
    }
    document.getElementById('mra-sched-overlay')?.remove();

    const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' }[type] || '#4cc9f0';
    const el = document.createElement('div');
    el.id = 'mra-sched-overlay';
    el.style.cssText = `color:${c};border:2px solid ${c};`;
    el.textContent = text;
    document.body.appendChild(el);

    const autoRemoveMs = { success: 7000, error: 15000, warn: 10000 }[type];
    if (autoRemoveMs) setTimeout(() => el?.remove(), autoRemoveMs);
  }

})();
