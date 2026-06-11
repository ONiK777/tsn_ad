// ─── BACKGROUND SERVICE WORKER ───────────────────────────────────────────────
// Використовує chrome.alarms (MV3) — не засинає під час очікування.
// При спрацюванні: переходить на вкладку livestreaming/manage, чекає завантаження
// і надсилає повідомлення напряму в scheduler.js.

const ALARM_NAME = 'mra_stream_launch';

// ── Спрацювання аларму ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.local.get(['scheduledTime', 'scheduleEnabled']);
  if (!data.scheduleEnabled) return;

  console.log('[MRA Background] ⏰ Launch Alarm fired at', new Date().toLocaleTimeString());

  // Ставимо прапор — якщо content script перезавантажиться, він підхопить
  await chrome.storage.local.set({ pendingLaunch: true });

  // Знаходимо всі відкриті вкладки YouTube Studio
  const allStudioTabs = await chrome.tabs.query({ url: 'https://studio.youtube.com/*' });

  // Всі вкладки з конкретними трансляціями (не /manage)
  const livestreamTabs = allStudioTabs.filter(t =>
    t.url && t.url.includes('/livestreaming') && !t.url.includes('/livestreaming/manage')
  );

  // ── РЕЖИМ: Кілька трансляцій → запускаємо всі ──
  if (livestreamTabs.length > 1) {
    console.log('[MRA Background] 🚀 LAUNCH ALL MODE:', livestreamTabs.length, 'tabs');
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });

    // Сповіщення #1: знайдено N трансляцій
    try {
      chrome.notifications.create('mra_found_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🔍 ТСН — Знайдено трансляцій: ' + livestreamTabs.length,
        message: 'Починаємо запуск ' + livestreamTabs.length + ' ефірів о ' + (data.scheduledTime || '') + '...'
      });
    } catch (e) { }

    // Активуємо вікно першої вкладки
    if (livestreamTabs[0]) {
      await chrome.windows.update(livestreamTabs[0].windowId, { focused: true });
    }

    // Надсилаємо mra_launch_stream КОЖНІЙ вкладці з трансляцією
    let launched = 0;
    let failed = 0;

    for (const tab of livestreamTabs) {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise(r => setTimeout(r, 600));
      await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { action: 'mra_launch_stream' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('[MRA Background] Tab', tab.id, 'error:', chrome.runtime.lastError.message);
            failed++;
          } else {
            console.log('[MRA Background] ✅ Launched tab', tab.id, tab.url);
            launched++;
          }
          resolve();
        });
      });
    }

    // Сповіщення #2: підсумок запуску
    try {
      const allOk = failed === 0;
      chrome.notifications.create('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: allOk
          ? '✅ ТСН — Всі ефіри запущено!'
          : `⚠️ ТСН — Запущено: ${launched} з ${livestreamTabs.length}`,
        message: allOk
          ? `${launched} трансляцій успішно запущено 🔴`
          : `Успішно: ${launched} | Помилка: ${failed} — перевірте вкладки`
      });
    } catch (e) { }

    return; // Виходимо — не треба одиночної логіки нижче
  }

  // ── РЕЖИМ: Одна трансляція (стандарт) ──
  const livestreamTab = livestreamTabs[0] || null;
  const anyStudioTab = allStudioTabs[0] || null;

  let targetTab = null;
  let needsNavigation = false;

  if (livestreamTab) {
    // ✅ Ідеально: вкладка вже на правильній сторінці трансляції — не чіпаємо URL!
    targetTab = livestreamTab;
    await chrome.tabs.update(targetTab.id, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    console.log('[MRA Background] Found existing livestream tab, keeping URL:', targetTab.url);
  } else if (anyStudioTab) {
    // 🔄 Є вкладка Studio але не на livestreaming — переходимо на manage
    targetTab = anyStudioTab;
    needsNavigation = true;
    await chrome.tabs.update(targetTab.id, {
      active: true,
      url: 'https://studio.youtube.com/livestreaming/manage'
    });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    console.log('[MRA Background] Navigating Studio tab to manage page');
  } else {
    // 🆕 Немає жодної вкладки — відкриваємо нову
    targetTab = await chrome.tabs.create({
      url: 'https://studio.youtube.com/livestreaming/manage',
      active: true
    });
    needsNavigation = true;
    console.log('[MRA Background] Opened new tab');
  }

  // Системне сповіщення #1: знайдено і запускаємо
  try {
    const foundCount = livestreamTab ? 1 : 0;
    const foundMsg = foundCount > 0
      ? `Знайдено 1 трансляцію, запускаємо о ${data.scheduledTime || ''}...`
      : `Відкриваємо YouTube Studio о ${data.scheduledTime || ''}...`;

    chrome.notifications.create('mra_launch_notify', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🔍 ТСН — Знайдено: ' + (foundCount > 0 ? '1 трансляцію' : 'немає вкладок'),
      message: foundMsg
    });
  } catch (e) { /* notifications не критичні */ }

  // Вимикаємо розклад (одноразовий)
  await chrome.storage.local.set({ scheduleEnabled: false });
  chrome.action.setBadgeText({ text: '' });

  // ── КЛЮЧОВА ЧАСТИНА: Чекаємо повного завантаження сторінки і надсилаємо trigger ──
  // Це надійніше ніж покладатись на pendingLaunch флаг при document_start
  const tabId = targetTab.id;

  function sendLaunchWithRetry(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      console.warn('[MRA Background] All retry attempts exhausted, content script did not respond.');
      try {
        chrome.notifications.create('mra_done_notify', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '⚠️ ТСН — Не вдалось запустити ефір',
          message: 'Скрипт не відповів після 5 спроб. Перевірте вкладку YouTube Studio.'
        });
      } catch (e) { }
      return;
    }

    console.log(`[MRA Background] Sending launch message, attempts left: ${attemptsLeft}`);
    chrome.tabs.sendMessage(tabId, { action: 'mra_launch_stream' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(`[MRA Background] Content script not ready (${attemptsLeft} left):`, chrome.runtime.lastError.message);
        // Повторна спроба через delayMs
        setTimeout(() => sendLaunchWithRetry(attemptsLeft - 1, delayMs), delayMs);
        return;
      }
      console.log('[MRA Background] ✅ Launch message delivered');
      try {
        chrome.notifications.create('mra_done_notify', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '✅ ТСН — Команду надіслано!',
          message: 'Бот запускає трансляцію 🔴'
        });
      } catch (e) { }
    });
  }

  if (!needsNavigation) {
    // ✅ Вкладка вже на правильній сторінці — пробуємо підключитись, 5 спроб по 3с
    setTimeout(() => sendLaunchWithRetry(5, 3000), 1500);
  } else {
    // 🔄 Вкладка завантажується — чекаємо події 'complete'
    let messageSent = false;

    const onUpdatedListener = (tId, changeInfo) => {
      if (tId !== tabId || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);

      // Затримка 1.5с щоб YouTube Studio SPA повністю завантажився
      setTimeout(() => {
        if (messageSent) return;
        messageSent = true;
        sendLaunchWithRetry(5, 3000);
      }, 1500);
    };

    chrome.tabs.onUpdated.addListener(onUpdatedListener);

    // Safety timeout: якщо сторінка не завантажилась за 45с — прибираємо listener
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    }, 45000);
  }
});

// ── Повідомлення від popup.js та content scripts ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── Верифікація: ефір успішно запустився ──
  if (request.action === 'mra_live_verified') {
    console.log('[MRA Background] ✅ Live verified:', request.title);
    try {
      chrome.notifications.create('mra_live_ok_' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '✅ ТСН — Ефір НАЖИВО!',
        message: `"${request.title || 'Трансляція'}" успішно запущена 🔴`
      });
    } catch (e) { }
    return;
  }

  // ── Тривога: ефір НЕ запустився після 60с ──
  if (request.action === 'mra_live_check_failed') {
    console.error('[MRA Background] 🚨 Live check FAILED:', request.title);
    try {
      chrome.notifications.create('mra_live_fail_' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🚨 ТСН — ЕФІР НЕ ЗАПУСТИВСЯ!',
        message: `"${request.title || 'Трансляція'}" — перевірте ключ трансляції у Studio!`
      });
    } catch (e) { }
    return;
  }

  // Встановити або скасувати аларм
  if (request.action === 'mra_set_alarm') {
    const { timeStr, enabled } = request;

    chrome.alarms.clear(ALARM_NAME);

    if (!enabled) {
      chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ success: true, cancelled: true });
      return true;
    }

    // Розраховуємо час спрацювання (найближча HH:MM — сьогодні або завтра)
    const [hh, mm] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    const delayMin = (target.getTime() - now.getTime()) / 60000;

    chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMin });

    chrome.storage.local.set({
      scheduledTime: timeStr,
      scheduleEnabled: true,
      pendingLaunch: false
    }).then(() => {
      // Badge показує час запуску
      chrome.action.setBadgeText({ text: timeStr });
      chrome.action.setBadgeBackgroundColor({ color: '#c91c1c' });

      console.log('[MRA Background] Alarm set for', timeStr, '(in', Math.round(delayMin), 'min)');
      sendResponse({ success: true, fireAt: target.toISOString() });
    });

    return true; // async
  }

  // Отримати поточний стан
  if (request.action === 'mra_get_alarm_status') {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
      chrome.storage.local.get(['scheduledTime', 'scheduleEnabled'], (data) => {
        sendResponse({ alarm: alarm || null, ...data });
      });
    });
    return true;
  }
});
