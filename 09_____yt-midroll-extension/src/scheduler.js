// ─── SCHEDULER CONTENT SCRIPT ────────────────────────────────────────────────
// Запускається при кожному завантаженні studio.youtube.com.
// Перевіряє прапор pendingLaunch у chrome.storage — якщо є, стартує запуск.
// Також слухає пряме повідомлення від background.js після навігації.

(function () {
  'use strict';

  // Захист від подвійного запуску ланцюга (race condition)
  window.mraLaunchInProgress = false;

  // ── Перевіряємо прапор одразу при завантаженні сторінки ──
  function checkPendingLaunch() {
    if (window.mraLaunchInProgress) return;
    chrome.storage.local.get('pendingLaunch', (data) => {
      if (!data.pendingLaunch) return;
      window.mraLaunchInProgress = true;

      const url = window.location.href;
      console.log('[TSN MANAGER] 🚀 pendingLaunch detected on:', url);

      if (url.includes('livestreaming/manage')) {
        // ✅ На сторінці списку — знімаємо прапор і шукаємо рядок
        chrome.storage.local.set({ pendingLaunch: false });
        waitForPageAndLaunch(16, 1200);
      } else if (url.includes('/livestreaming') || url.includes('/video/')) {
        // ✅ Вже на сторінці конкретного стріму — ТИСНЕМО GO LIVE ОДРАЗУ!
        console.log('[TSN MANAGER] 🎯 Already on livestream page, clicking Go Live directly!');
        chrome.storage.local.set({ pendingLaunch: false });
        waitForGoLiveButton(20, 1500);
      } else {
        // ⚠️ Ми на іншій сторінці Studio — переходимо на manage
        console.log('[TSN MANAGER] Not on livestream page, navigating...');
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
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

    // ── Перевірка поточного стану (LIVE / не LIVE) ──
    if (request.action === 'mra_check_live_status') {
      const live = isStreamLive();
      console.log('[TSN MANAGER] 📡 Live status check:', live);
      sendResponse({ isLive: live });
      return true;
    }

    // ── Завершити трансляцію ──
    if (request.action === 'mra_end_stream') {
      console.log('[TSN MANAGER] ⏹ End stream command received');
      window.mraLaunchInProgress = false;
      window.mraIsEndConfirmed = false;
      showOverlay('⏹ Завершуємо трансляцію...', 'info');
      waitForEndStreamButton(15, 1500);
      sendResponse({ started: true });
      return true;
    }

    // ── Оновлення Плану Дій (Action Plan) ──
    if (request.action === 'mra_plan_update') {
      showPlanOverlay(request.plan);
      sendResponse({ ok: true });
      return true;
    }

    if (request.action !== 'mra_launch_stream') return;

    // БАГ 1: Захист від подвійного запуску
    if (window.mraLaunchInProgress) {
      sendResponse({ started: false, reason: 'already_working' });
      return;
    }
    window.mraLaunchInProgress = true;

    const url = window.location.href;
    console.log('[TSN MANAGER] 📨 Direct launch message received, URL:', url);

    if (url.includes('livestreaming/manage')) {
      // ✅ На сторінці списку — шукаємо рядок і відкриваємо стрім
      chrome.storage.local.set({ pendingLaunch: false });
      waitForPageAndLaunch(16, 1200);
    } else if (url.includes('/livestreaming') || url.includes('/video/')) {
      // ✅ Вже на сторінці конкретного стріму — ТИСНЕМО GO LIVE ОДРАЗУ!
      console.log('[TSN MANAGER] 🎯 Already on stream page! Searching for Go Live button...');
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
      window.mraLaunchInProgress = false;
      return;
    }

    const rows = findAllStreamRows();
    if (!rows || rows.length === 0) {
      console.log('[TSN MANAGER] Waiting for stream list... (' + attemptsLeft + ')');
      setTimeout(() => waitForPageAndLaunch(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    const targetRow = findTodaysRow(rows);
    if (!targetRow) {
      console.warn('[TSN MANAGER] ⚠️ No stream found for today');
      showOverlay('⚠️ Трансляцію на сьогодні не знайдено в списку', 'warn');
      window.mraLaunchInProgress = false;
      return;
    }

    const streamTitle = (targetRow.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 60);
    console.log('[TSN MANAGER] ✅ Today stream found:', streamTitle);
    showOverlay('🔴 Знайдено! Відкриваємо трансляцію...', 'info');

    const link = findStreamLink(targetRow);

    // Підстраховка на випадок повного перезавантаження
    chrome.storage.local.set({ pendingLaunch: true });

    if (link) {
      console.log('[TSN MANAGER] Clicking stream link for SPA routing...');
      link.click();
    } else {
      console.log('[TSN MANAGER] No link found inside row, clicking row directly...');
      targetRow.click();
    }

    // Чекаємо завантаження сторінки стріму (бо це SPA-перехід) → тиснемо Go Live
    setTimeout(() => {
      // Якщо це був SPA-перехід, знімаємо прапор і шукаємо кнопку.
      chrome.storage.local.set({ pendingLaunch: false });

      // Якщо клік по targetRow взагалі нічого не дав, ми досі на сторінці manage
      if (window.location.href.includes('/livestreaming/manage')) {
        showOverlay('❌ Не вдалося відкрити трансляцію зі списку. Відкрийте її вручну!', 'error');
        window.mraLaunchInProgress = false;
        return;
      }

      waitForGoLiveButton(20, 1500);
    }, 4000);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // КРОК 2: Чекаємо кнопку Go Live і натискаємо
  // ────────────────────────────────────────────────────────────────────────────

  function waitForGoLiveButton(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      showOverlay('⚠️ Відкрито стрім — натисніть Go Live вручну', 'warn');
      window.mraLaunchInProgress = false;
      return;
    }

    if (isStreamLive()) {
      console.log('[TSN MANAGER] Stream is ALREADY LIVE! No need to click Go Live.');
      showOverlay('✅ Трансляція вже НАЖИВО!', 'success');
      verifyLiveStatus(); // Відправить mra_live_verified майже одразу
      return;
    }

    const btn = findGoLiveButton();

    if (!btn) {
      console.log('[TSN MANAGER] Go Live not found yet... (' + attemptsLeft + ') URL:', window.location.href);
      setTimeout(() => waitForGoLiveButton(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    if (btn.disabled || btn.getAttribute('disabled') !== null || btn.getAttribute('aria-disabled') === 'true') {
      console.log('[TSN MANAGER] Go Live is disabled, waiting...');
      setTimeout(() => waitForGoLiveButton(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    console.log('[TSN MANAGER] 🔴 FOUND GO LIVE BUTTON:', btn.outerHTML.substring(0, 150));
    showOverlay('🔴 Кнопку Go Live знайдено! Зачекайте 3с...', 'info');

    // Чекаємо 3с щоб YouTube Studio встиг завантажити внутрішні модулі (RequestBuilder)
    setTimeout(() => {
      const freshBtn = findGoLiveButton();
      const clickTarget = freshBtn || btn;
      console.log('[TSN MANAGER] 🔴 CLICKING NOW!');
      showOverlay('🔴 Натискаю Go Live... Зачекайте', 'info');

      window.mraIsStartConfirmed = false;
      clickTarget.click();

      // Обробляємо можливий діалог підтвердження
      setTimeout(handleConfirmDialog, 1000);
      setTimeout(handleConfirmDialog, 2000);

      // ── Швидкий retry-цикл (обхід помилки No RequestBuilder) ──
      // Якщо кнопка ще на місці через 2.5с — клік не спрацював, натискаємо знову
      let quickRetries = 0;
      function quickRetryClick() {
        if (quickRetries >= 4) return;  // макс 4 швидких спроби
        const retryBtn = findGoLiveButton();
        if (retryBtn && !retryBtn.disabled) {
          quickRetries++;
          console.warn(`[TSN MANAGER] ⚡ Quick retry #${quickRetries}: кнопка ще на місці, натискаю знову...`);
          showOverlay(`⚠️ YouTube не відповів — повторний клік #${quickRetries + 1}. Зачекайте!`, 'warn');
          window.mraIsStartConfirmed = false;
          retryBtn.click();
          setTimeout(handleConfirmDialog, 1000);
          setTimeout(handleConfirmDialog, 2000);
          setTimeout(quickRetryClick, 2500);
        }
        // Якщо кнопка зникла — клік спрацював, retry не потрібний
      }
      setTimeout(quickRetryClick, 2500);

      // Контрольна перевірка статусу НАЖИВО (страховка)
      setTimeout(() => verifyLiveStatus(), 5000);
    }, 3000);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ДОПОМІЖНІ ФУНКЦІЇ
  // ────────────────────────────────────────────────────────────────────────────

  // Знайти всі рядки таблиці трансляцій
  function findAllStreamRows() {
    // YouTube Studio кастомні елементи (пріоритет)
    // БАГ 3: Запобігаємо дублікатам рядків
    const direct = Array.from(new Set([
      ...document.querySelectorAll('ytcp-video-row'),
      ...document.querySelectorAll('[class*="video-row"]'),
    ]));
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
    console.log('[TSN MANAGER] Date variants:', variants.slice(0, 4).join(' | '), '...');

    for (const row of rows) {
      const text = row.textContent || '';
      for (const v of variants) {
        if (text.includes(v)) {
          console.log('[TSN MANAGER] Matched date: "' + v + '"');
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
      row.querySelector('a')
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

        // Перевіряємо що це НЕ кнопка "Завершити/Зупинити трансляцію"
        if (text.includes('завершити') || text.includes('зупинити') || text.includes('end stream') ||
          label.includes('завершити') || label.includes('зупинити') || label.includes('end stream')) {
          continue;
        }

        console.log('[TSN MANAGER] Found Go Live via selector:', sel);
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
        console.log('[TSN MANAGER] Found Go Live via text/label:', label || text);
        return btn;
      }
    }

    return null;
  }



  // Підтвердити діалог якщо з'явився після Go Live
  function handleConfirmDialog() {
    // БАГ 2: Guard flag для Confirm діалогу
    if (window.mraIsStartConfirmed) return;

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
        console.log('[TSN MANAGER] Confirming dialog:', sel);
        window.mraIsStartConfirmed = true;
        btn.click();
        clicked = true;
        break;
      }
    }

    if (clicked) {
      showOverlay('🔴 Підтверджено! Чекаємо статус LIVE...', 'info');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ПЕРЕВІРКА: чи ефір реально запустився
  // ────────────────────────────────────────────────────────────────────────────

  function isStreamLive() {
    // 0. МАЛА: Оптимізація - швидкий пошук кнопки "Завершити" (тільки цільові селектори)
    const fastBtns = document.querySelectorAll('#start-stream-button button, #start-stream-button, ytcp-go-live-button button, ytcp-go-live-button');
    for (const btn of fastBtns) {
      if (btn.getBoundingClientRect().width === 0 || btn.disabled) continue;
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isPlayback = text.includes('відтворення') || label.includes('відтворення') || text.includes('play') || label.includes('play');
      if (!isPlayback && (text.includes('завершити') || label.includes('завершити') || text.includes('зупинити') || label.includes('зупинити') || text.includes('end stream'))) {
        console.log('[TSN MANAGER] 📡 isStreamLive: TRUE → END BUTTON (fast path):', label || text);
        return true;
      }
    }

    // 1. Пошук кнопки "Завершити" у Shadow DOM (fallback)
    function searchInRoot(root) {
      for (const el of root.querySelectorAll('*')) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'button' || tag.startsWith('ytcp-')) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const label = (el.getAttribute ? (el.getAttribute('aria-label') || '') : '').toLowerCase();
            const isPlaybackControl = text.includes('відтворення') || label.includes('відтворення') || text.includes('play') || label.includes('play');

            if (!isPlaybackControl && (
              text.includes('завершити') || label.includes('завершити') ||
              text === 'зупинити' || label === 'зупинити' ||
              (text.includes('зупинити') && text.includes('трансляцію')) ||
              (label.includes('зупинити') && label.includes('трансляцію')) ||
              text.includes('end stream') || label.includes('end stream')
            )) {
              console.log('[TSN MANAGER] 📡 isStreamLive: TRUE → END BUTTON:', label || text.substring(0, 40));
              return true;
            }
          }
        }
        if (el.shadowRoot && searchInRoot(el.shadowRoot)) return true;
      }
      return false;
    }

    if (searchInRoot(document.body)) return true;

    // 2. Fallback: пошук бейджа "LIVE" / "НАЖИВО"
    const liveKeywords = ['LIVE', 'НАЖИВО', 'В ЕФІРІ', 'НАЖИВО ЗАРАЗ'];

    // БАГ 1: Вилучено [aria-label*="live"], щоб не чіпляло кнопку "Go live"
    const certainBadgeSelectors = ['ytcp-live-badge', 'div[class*="live-badge"]', 'span[class*="live-badge"]'];
    for (const sel of certainBadgeSelectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0) {
        console.log('[TSN MANAGER] 📡 isStreamLive: TRUE → BADGE found:', sel);
        return true;
      }
    }

    const statusBadges = document.querySelectorAll('ytcp-badge, #broadcast-status');
    for (const el of statusBadges) {
      if (el.getBoundingClientRect().width > 0) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (liveKeywords.some(kw => t === kw || t.startsWith(kw + ' '))) {
          console.log('[TSN MANAGER] 📡 isStreamLive: TRUE → STATUS BADGE found:', t);
          return true;
        }
      }
    }

    const all = document.querySelectorAll('span, div, p, ytcp-badge, ytcp-live-badge');
    for (const el of all) {
      if (el.children.length === 0 && el.getBoundingClientRect().width > 0) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (liveKeywords.some(kw => t === kw || t.startsWith(kw + ' '))) {
          console.log('[TSN MANAGER] 📡 isStreamLive: TRUE → TEXT found:', t);
          return true;
        }
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
    const MAX_WAIT_MS = 60000;  // 60с для 3 повторних спроб
    const INTERVAL_MS = 2000;   // перевірка кожні 2с замість 5с
    const title = getStreamTitle();

    showOverlay(`⏳ ЕТАП 2: Запущено! Чекаємо переходу в статус НАЖИВО...`, 'info');
    console.log('[TSN MANAGER] 🔍 Verifying live status for:', title);

    let retryCount = 0;

    function check() {
      if (isStreamLive()) {
        console.log('[TSN MANAGER] ✅ Stream is LIVE:', title);
        showOverlay(`✅ Трансляцію запущено! 🔴 «${title}»`, 'success');
        window.mraLaunchInProgress = false;
        chrome.runtime.sendMessage({
          action: 'mra_live_verified',
          title,
          url: window.location.href
        });
        return;
      }

      const elapsed = Date.now() - START;
      console.log(`[TSN MANAGER] Not live yet: "${title}" (${Math.round(elapsed / 1000)}s)`);

      // ── АВТОМАТИЧНИЙ RETRY КЛІКУ (Броня від помилки No RequestBuilder) ──
      // До 3 повторних спроб з наростаючою затримкою: 6с, 15с, 25с
      const retryThresholds = [6000, 15000, 25000];
      if (retryCount < retryThresholds.length && elapsed > retryThresholds[retryCount]) {
        const btn = findGoLiveButton();
        if (btn && !btn.disabled) {
          retryCount++;
          console.warn(`[TSN MANAGER] ⚠️ Retry #${retryCount}/3: Button still present after ${Math.round(elapsed/1000)}s. Re-clicking...`);
          showOverlay(`⚠️ YouTube помилка — спроба #${retryCount}/3. Зачекайте, бот працює!`, 'warn');
          window.mraIsStartConfirmed = false;
          setTimeout(() => {
            const freshBtn = findGoLiveButton();
            if (freshBtn && !freshBtn.disabled) {
              freshBtn.click();
              setTimeout(handleConfirmDialog, 1500);
              setTimeout(handleConfirmDialog, 3000);
            }
          }, 3000);
        }
      }

      // БАГ: Cosmetic - спочатку перевіряємо elapsed до виводу showOverlay('В очікуванні')
      if (elapsed >= MAX_WAIT_MS) {
        console.error('[TSN MANAGER] 🚨 FAILED to go LIVE:', title);
        const btn = findGoLiveButton();

        let failReason;
        if (btn) {
          failReason = `🚨 БОТ НЕ ЗМІГ запустити «${title}» \nЗапустіть вручну!`;
        } else {
          failReason = `🚨 Таймаут 60с: «${title}» не перейшла в НАЖИВО \nПеревірте сторінку вручну!`;
        }

        showOverlay(failReason, 'error');
        window.mraLaunchInProgress = false;
        chrome.runtime.sendMessage({
          action: 'mra_live_check_failed',
          title,
          url: window.location.href,
          reason: btn ? 'Button click failed internally' : 'Timeout'
        });
        return;
      }

      const sec = Math.round(elapsed / 1000);
      const retryInfo = retryCount > 0 ? ` | спроба ${retryCount}/3` : '';
      showOverlay(`⏳ Чекайте, бот працює... (${sec}с${retryInfo})`, 'info');
      setTimeout(check, INTERVAL_MS);
    }

    setTimeout(check, INTERVAL_MS);
  }


  // ────────────────────────────────────────────────────────────────────────────
  // ЗАВЕРШЕННЯ ТРАНСЛЯЦІЇ
  // ────────────────────────────────────────────────────────────────────────────

  function waitForEndStreamButton(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      showOverlay('⚠️ Кнопку завершення не знайдено — завершіть вручну!', 'error');
      return;
    }

    const btn = findEndStreamButton();
    if (!btn) {
      console.log('[TSN MANAGER] End stream button not found yet... (' + attemptsLeft + ')');
      setTimeout(() => waitForEndStreamButton(attemptsLeft - 1, delayMs), delayMs);
      return;
    }

    console.log('[TSN MANAGER] ⏹ FOUND END STREAM BUTTON:', btn.outerHTML.substring(0, 150));
    showOverlay('⏹ Кнопку знайдено! Зачекайте 3с...', 'info');

    // Затримка 3с для ініціалізації YouTube Studio
    setTimeout(() => {
      const freshBtn = findEndStreamButton();
      const clickTarget = freshBtn || btn;
      console.log('[TSN MANAGER] ⏹ CLICKING END STREAM NOW!');
      showOverlay('⏹ Натискаю завершити... Зачекайте', 'info');
      clickTarget.click();

      // Обробляємо діалог підтвердження завершення
      setTimeout(handleEndConfirmDialog, 1000);
      setTimeout(handleEndConfirmDialog, 2000);
      setTimeout(handleEndConfirmDialog, 3000);
    }, 3000);
  }

  function findEndStreamButton() {
    // Та сама кнопка що й Go Live — тільки коли стрім LIVE надпис міняється на "Завершити"
    const candidates = document.querySelectorAll(
      '#start-stream-button button, #start-stream-button, ytcp-go-live-button button, ytcp-go-live-button, ytcp-button-shape button, button'
    );

    for (const btn of candidates) {
      if (btn.getBoundingClientRect().width === 0 || btn.disabled) continue;
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isPlaybackControl = text.includes('відтворення') || label.includes('відтворення') || text.includes('play') || label.includes('play');
      const isEnd = !isPlaybackControl && (
        text.includes('завершити') || label.includes('завершити') ||
        text === 'зупинити' || label === 'зупинити' ||
        (text.includes('зупинити') && text.includes('трансляцію')) ||
        (label.includes('зупинити') && label.includes('трансляцію')) ||
        text.includes('end stream') || label.includes('end stream')
      );
      if (isEnd) {
        console.log('[TSN MANAGER] Found End Stream button:', label || text);
        return btn;
      }
    }

    return null;
  }

  // Підтвердити діалог завершення трансляції
  function handleEndConfirmDialog() {
    if (window.mraIsEndConfirmed) return;
    console.log('[TSN MANAGER] Looking for end stream dialog confirm button...');

    // 1. Надійний пошук через Shadow DOM
    function searchForConfirmButton(root) {
      for (const el of root.querySelectorAll('*')) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'button' || tag.startsWith('ytcp-')) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const label = (el.getAttribute ? (el.getAttribute('aria-label') || '') : '').toLowerCase();

            // Шукаємо кнопку підтвердження (Так, Завершити, Yes, End)
            if (
              text === 'так' || label === 'так' ||
              text === 'yes' || label === 'yes' ||
              text === 'завершити' || label === 'завершити' ||
              text === 'завершити трансляцію' || label === 'завершити трансляцію' ||
              text === 'end' || label === 'end' ||
              text === 'end stream' || label === 'end stream'
            ) {
              // Перевряємо, чи кнопка знаходиться всередині діалогового вікна (.ytcp-dialog, .tp-yt-paper-dialog тощо)
              let inDialog = false;
              let current = el;
              let hopCount = 0;
              while (current && hopCount < 20) {
                const ctag = current.tagName ? current.tagName.toLowerCase() : '';
                const cclass = current.className && typeof current.className === 'string' ? current.className.toLowerCase() : '';
                if (ctag.includes('dialog') || cclass.includes('dialog')) {
                  inDialog = true;
                  break;
                }
                current = current.parentElement || (current.getRootNode && current.getRootNode().host);
                hopCount++;
              }

              if (inDialog) return el;
            }
          }
        }
        if (el.shadowRoot) {
          const result = searchForConfirmButton(el.shadowRoot);
          if (result) return result;
        }
      }
      return null;
    }

    const confirmBtn = searchForConfirmButton(document.body);
    if (confirmBtn) {
      console.log('[TSN MANAGER] Confirming end stream dialog via Shadow DOM:', confirmBtn);
      const activeTitle = getStreamTitle();
      confirmBtn.click();
      window.mraIsEndConfirmed = true;
      showOverlay('⏹ Підтверджено! Чекаємо завершення...', 'info');
      verifyStreamEnded(activeTitle);
      return;
    }

    // 2. Старий варіант (який менш надійний через Shadow DOM, але працює як fallback)
    const selectors = [
      'ytcp-confirmation-dialog ytcp-button[class*="confirm"]',
      'ytcp-confirmation-dialog #confirm-button',
      'ytcp-confirmation-dialog ytcp-button:last-child button',
      'ytcp-dialog ytcp-button[dialog-confirm]',
      'button[cdkfocusinitial]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent) {
        const text = (btn.textContent || '').toLowerCase();
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('скасу') || label.includes('скасу') || text.includes('ні') || label.includes('ні') || text.includes('cancel') || label.includes('cancel')) continue;
        console.log('[TSN MANAGER] Confirming end stream dialog (fallback):', sel);
        const activeTitle = getStreamTitle();
        btn.click();
        window.mraIsEndConfirmed = true;
        showOverlay('⏹ Підтверджено! Чекаємо завершення...', 'info');
        verifyStreamEnded(activeTitle);
        return;
      }
    }
  }

  // Перевіряємо що стрім РЕАЛЬНО завершився.
  // Швидкий поллінг (500мс) — YouTube може перезавантажити сторінку після end,
  // тому треба встигнути відправити повідомлення ДО навігації.
  function verifyStreamEnded(streamTitle) {
    // Перевіряємо одразу — може вже зупинився
    if (!isStreamLive()) {
      console.log('[TSN MANAGER] ✅ Stream ended immediately after confirm:', streamTitle);
      showOverlay('⏹ Трансляцію завершено', 'success');
      notifyStreamEnded(streamTitle);
      return;
    }

    const START = Date.now();
    const MAX_WAIT_MS = 8000;  // макс 8с — після чого надсилаємо все одно
    const INTERVAL_MS = 500;   // перевірка кожні 500мс

    function check() {
      if (!isStreamLive()) {
        console.log('[TSN MANAGER] ✅ Stream confirmed ENDED:', streamTitle);
        showOverlay('⏹ Трансляцію завершено', 'success');
        notifyStreamEnded(streamTitle);
        return;
      }
      const elapsed = Date.now() - START;
      if (elapsed >= MAX_WAIT_MS) {
        // Після 8с надсилаємо будь-що — background кулдаун 12с дасть час ключу звільнитись
        console.log('[TSN MANAGER] ⏹ 8s passed after confirm, notifying end:', streamTitle);
        showOverlay('⏹ Завершення підтверджено', 'info');
        notifyStreamEnded(streamTitle);
        return;
      }
      setTimeout(check, INTERVAL_MS);
    }

    setTimeout(check, INTERVAL_MS);
  }

  function notifyStreamEnded(streamTitle) {
    chrome.runtime.sendMessage({
      action: 'mra_stream_ended',
      title: streamTitle || getStreamTitle(),
      url: window.location.href
    });
  }

  // ── ПЛАН ДІЙ (Action Plan Overlay) ─────────────────────────────────────
  function showPlanOverlay(plan) {
    // Завжди оновлюємо CSS (щоб зміни підхоплювались без перезавантаження сторінки)
    document.getElementById('mra-plan-css')?.remove();
    {
      const s = document.createElement('style');
      s.id = 'mra-plan-css';
      s.textContent = `
        @keyframes mraPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes mraPlanIn { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        #mra-plan-overlay {
          position:fixed; top:12px; right:12px; z-index:2147483647;
          background:rgba(15,15,20,0.96); border-radius:10px;
          padding:10px 14px; min-width:260px; max-width:380px;
          font-family:'Roboto','Segoe UI',sans-serif;
          box-shadow:0 4px 24px rgba(0,0,0,0.8);
          border:1px solid rgba(255,255,255,0.08);
          color:#e0e0e0; pointer-events:none;
          animation:mraPlanIn .3s ease;
        }
        .mra-plan-hdr {
          display:flex; justify-content:space-between; align-items:center;
          padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.08);
          margin-bottom:6px;
        }
        .mra-plan-ttl { font-size:12px; font-weight:700; }
        .mra-plan-tmr { font-size:10px; color:#666; font-variant-numeric:tabular-nums; }
        .mra-plan-steps { display:flex; flex-direction:column; gap:2px; }
        .mra-step {
          display:flex; align-items:center; gap:6px;
          font-size:11px; padding:1px 0; transition:color .3s;
        }
        .mra-step-ico { width:14px; text-align:center; flex-shrink:0; font-size:11px; }
        .mra-step-txt { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mra-step-tm { color:#555; font-size:10px; flex-shrink:0; }
        .mra-step.done { color:#06d6a0; }
        .mra-step.active { color:#4cc9f0; }
        .mra-step.active .mra-step-ico { animation:mraPulse 1.2s infinite; }
        .mra-step.failed { color:#ff6b6b; }
        .mra-step.pending { color:#444; }
        .mra-plan-detail {
          margin-top:6px; padding-top:5px;
          border-top:1px solid rgba(255,255,255,0.08);
          font-size:10px; color:#888;
        }
      `;
      document.head.appendChild(s);
    }

    document.getElementById('mra-plan-overlay')?.remove();
    document.getElementById('mra-sched-overlay')?.remove();

    const done = plan.steps.filter(s => s.status === 'done').length;
    const fail = plan.steps.filter(s => s.status === 'failed').length;
    const total = plan.steps.length;
    const elapsed = Math.round((Date.now() - plan.startedAt) / 1000);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    const allDone = (done + fail) === total;
    const hdrColor = allDone ? (fail > 0 ? '#ff6b6b' : '#06d6a0') : '#4cc9f0';
    const hdrIcon = allDone ? (fail > 0 ? '⚠️' : '✅') : '🔄';

    let rows = '';
    for (const step of plan.steps) {
      let ico, cls, tm = '';
      if (step.status === 'done') { ico = '✅'; cls = 'done'; tm = step.duration != null ? step.duration + 'с' : ''; }
      else if (step.status === 'active') { ico = '⏳'; cls = 'active'; tm = '← зараз'; }
      else if (step.status === 'failed') { ico = '❌'; cls = 'failed'; tm = step.duration != null ? step.duration + 'с' : 'помилка'; }
      else { ico = '⬜'; cls = 'pending'; }
      const label = step.action === 'launch' ? '🔴 Запустити' : '⏹ Завершити';
      rows += `<div class="mra-step ${cls}"><span class="mra-step-ico">${ico}</span><span class="mra-step-txt">${label} «${step.title}»</span><span class="mra-step-tm">${tm}</span></div>`;
    }

    const el = document.createElement('div');
    el.id = 'mra-plan-overlay';
    el.innerHTML = `
      <div class="mra-plan-hdr">
        <span class="mra-plan-ttl" style="color:${hdrColor}">${hdrIcon} ПЛАН ДІЙ (${done}/${total})</span>
        <span class="mra-plan-tmr">⏱ ${mm}:${ss}</span>
      </div>
      <div class="mra-plan-steps">${rows}</div>
      ${plan.detail ? `<div class="mra-plan-detail">${plan.detail}</div>` : ''}
    `;
    document.body.appendChild(el);

    // Живий таймер
    if (window._mraPlanTimer) clearInterval(window._mraPlanTimer);
    if (!allDone) {
      window._mraPlanStartedAt = plan.startedAt;
      window._mraPlanTimer = setInterval(() => {
        const tmEl = document.querySelector('.mra-plan-tmr');
        if (!tmEl) { clearInterval(window._mraPlanTimer); return; }
        const e = Math.round((Date.now() - window._mraPlanStartedAt) / 1000);
        tmEl.textContent = `⏱ ${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`;
      }, 1000);
    } else {
      setTimeout(() => el?.remove(), 12000);
    }
  }

  // ── Оверлей-повідомлення поверх сторінки ──
  function showOverlay(text, type) {
    // Якщо план активний — оновлюємо детальний рядок в плані
    const planEl = document.getElementById('mra-plan-overlay');
    if (planEl) {
      let detailEl = planEl.querySelector('.mra-plan-detail');
      if (!detailEl) {
        detailEl = document.createElement('div');
        detailEl.className = 'mra-plan-detail';
        planEl.appendChild(detailEl);
      }
      const c = { info: '#4cc9f0', success: '#06d6a0', error: '#ff6b6b', warn: '#ffd166' }[type] || '#4cc9f0';
      detailEl.style.color = c;
      detailEl.textContent = text;
      return;
    }

    // Звичайний оверлей (коли плану немає)
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
