// ─── BACKGROUND SERVICE WORKER ───────────────────────────────────────────────
// Використовує chrome.alarms (MV3) — не засинає під час очікування.
// При спрацюванні: переходить на вкладку livestreaming/manage, чекає завантаження
// і надсилає повідомлення напряму в scheduler.js.

const ALARM_NAME = 'mra_stream_launch';

// ── Допоміжні функції для Action Plan ──
function getStreamTitleFromTab(tab) {
  return (tab.title || '').replace(/\s*[-–|]?\s*YouTube Studio\s*$/i, '').trim().substring(0, 40) || 'Трансляція';
}

async function broadcastPlan(plan) {
  try {
    const allTabs = await chrome.tabs.query({ url: 'https://studio.youtube.com/*' });
    // Тільки реальні трансляції (/video/*/livestreaming), не загальний список (/channel/*/livestreaming)
    const streamTabs = allTabs.filter(t =>
      t.url && t.url.includes('/video/') && t.url.includes('/livestreaming')
    );
    for (const t of streamTabs) {
      chrome.tabs.sendMessage(t.id, { action: 'mra_plan_update', plan }, () => {
        if (chrome.runtime.lastError) {} // ignore
      });
    }
  } catch (e) {}
}

// ── Спрацювання аларму ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.local.get(['scheduledTime', 'scheduleEnabled', 'actionType', 'endBeforeLaunch']);
  if (!data.scheduleEnabled) return;

  console.log('[TSN MANAGER BG] ⏰ Launch Alarm fired at', new Date().toLocaleTimeString());

  // Ставимо прапор — якщо content script перезавантажиться, він підхопить
  await chrome.storage.local.set({ pendingLaunch: true });

  // Знаходимо всі відкриті вкладки YouTube Studio
  const allStudioTabs = await chrome.tabs.query({ url: 'https://studio.youtube.com/*' });

  // Тільки реальні трансляції (/video/*/livestreaming), не /channel/*/livestreaming (загальний список)
  const livestreamTabs = allStudioTabs.filter(t =>
    t.url && t.url.includes('/video/') && t.url.includes('/livestreaming')
  );

  // ── РЕЖИМ: Кілька трансляцій ──
  if (livestreamTabs.length > 1) {
    console.log('[TSN MANAGER BG] 🔍 MULTI-TAB MODE: checking live status of', livestreamTabs.length, 'tabs');
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });

    // Перевіряємо стан кожної вкладки через executeScript (не залежить від content script)
    const tabStatuses = await Promise.all(livestreamTabs.map(tab =>
      new Promise(resolve => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            function searchInRoot(root) {
              let state = { hasEnd: false, hasStart: false };
              for (const el of root.querySelectorAll('*')) {
                const tag = el.tagName ? el.tagName.toLowerCase() : '';
                if (tag === 'button' || tag.startsWith('ytcp-')) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const label = (el.getAttribute ? (el.getAttribute('aria-label') || '') : '').toLowerCase();
                    const isTest = text.includes('тест') || label.includes('тест') || text.includes('test') || label.includes('test') || text.includes('preview');

                    if (!isTest) {
                      const isPlaybackControl = text.includes('відтворення') || label.includes('відтворення') || text.includes('play') || label.includes('play');
                      const isEnd = !isPlaybackControl && (
                        text.includes('завершити') || label.includes('завершити') ||
                        text === 'зупинити' || label === 'зупинити' ||
                        (text.includes('зупинити') && text.includes('трансляцію')) ||
                        (label.includes('зупинити') && label.includes('трансляцію')) ||
                        text.includes('end stream') || label.includes('end stream')
                      );
                      if (isEnd) state.hasEnd = true;
                      if (text.includes('почати') || label.includes('почати') || text.includes('розпочати') || label.includes('розпочати') || text.includes('go live') || label.includes('go live')) state.hasStart = true;
                    }
                  }
                }
                if (el.shadowRoot) {
                  const childState = searchInRoot(el.shadowRoot);
                  if (childState.hasEnd) state.hasEnd = true;
                  if (childState.hasStart) state.hasStart = true;
                }
              }
              return state;
            }
            const s = searchInRoot(document.body);
            return s.hasEnd && !s.hasStart;
          }
        }, (results) => {
          const isLive = !chrome.runtime.lastError && results?.[0]?.result === true;
          console.log('[TSN MANAGER BG] Tab', tab.id, 'isLive:', isLive);
          resolve({ tab, isLive });
        });
      })
    ));

    const liveTabs = tabStatuses.filter(s => s.isLive);
    const notLiveTabs = tabStatuses.filter(s => !s.isLive);

    // ── РЕЖИМ ПРІОРИТЕТНИЙ: Зміна ефіру (ПОЧЕРГОВА) ──
    if (liveTabs.length >= 1 && notLiveTabs.length >= 1) {
      const endBeforeLaunch = data.endBeforeLaunch !== false; // default: true
      console.log(`[TSN MANAGER BG] 🔄 SEQUENTIAL MODE (${endBeforeLaunch ? 'END→LAUNCH' : 'LAUNCH→END'}): ${notLiveTabs.length} new, ${liveTabs.length} old`);

      // Будуємо План Дій
      const plan = { steps: [], currentStep: -1, startedAt: Date.now(), detail: '' };
      if (endBeforeLaunch) {
        for (const t of liveTabs)    plan.steps.push({ action: 'end',    title: getStreamTitleFromTab(t.tab),    status: 'pending', duration: null });
        for (const t of notLiveTabs) plan.steps.push({ action: 'launch', title: getStreamTitleFromTab(t.tab), status: 'pending', duration: null });
      } else {
        for (let i = 0; i < Math.max(notLiveTabs.length, liveTabs.length); i++) {
          if (i < notLiveTabs.length) plan.steps.push({ action: 'launch', title: getStreamTitleFromTab(notLiveTabs[i].tab), status: 'pending', duration: null });
          if (i < liveTabs.length)    plan.steps.push({ action: 'end',    title: getStreamTitleFromTab(liveTabs[i].tab),    status: 'pending', duration: null });
        }
      }
      await broadcastPlan(plan);

      try {
        const modeLabel = endBeforeLaunch ? 'Спочатку END → потім GO LIVE' : 'Спочатку GO LIVE → потім END';
        chrome.notifications.create('mra_found_notify', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: `🔄 ПЛАН ДІЙ: ${plan.steps.length} кроків`,
          message: `${modeLabel}: ${liveTabs.length} завершити + ${notLiveTabs.length} запустити`
        });
      } catch (e) { }

      await new Promise(r => setTimeout(r, 1000));

      let stepIdx = 0;

      if (endBeforeLaunch) {
        // ── ФАЗА 1: Завершити всі LIVE трансляції ──
        for (let i = 0; i < liveTabs.length; i++) {
          plan.steps[stepIdx].status = 'active';
          plan.detail = '';
          await broadcastPlan(plan);
          const stepStart = Date.now();

          console.log('[TSN MANAGER BG] ⏹ ENDING OLD TAB:', liveTabs[i].tab.id);
          await chrome.tabs.update(liveTabs[i].tab.id, { active: true });
          await chrome.windows.update(liveTabs[i].tab.windowId, { focused: true });
          await new Promise(r => setTimeout(r, 1000));

          const endVerifiedPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 20000);
            const listener = (req) => {
              if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
            };
            chrome.runtime.onMessage.addListener(listener);
          });

          chrome.tabs.sendMessage(liveTabs[i].tab.id, { action: 'mra_end_stream' }, () => {
            if (chrome.runtime.lastError) console.warn('End fail:', chrome.runtime.lastError.message);
          });

          await endVerifiedPromise;
          plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
          plan.steps[stepIdx].status = 'done';
          stepIdx++;
          await broadcastPlan(plan);

          try {
            chrome.notifications.create('mra_step_' + Date.now(), {
              type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: `⏹ Крок ${stepIdx}/${plan.steps.length}`,
              message: `«${plan.steps[stepIdx-1].title}» — ЗАВЕРШЕНО!`
            });
          } catch (e) {}

          plan.detail = '⏳ Cooldown 12с (чекаємо звільнення ключа)...';
          await broadcastPlan(plan);
          await new Promise(r => setTimeout(r, 12000));
          plan.detail = '';
        }

        // ── ФАЗА 2: Запустити всі нові трансляції ──
        for (let i = 0; i < notLiveTabs.length; i++) {
          plan.steps[stepIdx].status = 'active';
          plan.detail = '';
          await broadcastPlan(plan);
          const stepStart = Date.now();

          console.log('[TSN MANAGER BG] 🔴 LAUNCHING NEW TAB:', notLiveTabs[i].tab.id);
          await chrome.tabs.update(notLiveTabs[i].tab.id, { active: true });
          await chrome.windows.update(notLiveTabs[i].tab.windowId, { focused: true });
          await new Promise(r => setTimeout(r, 1000));

          const liveVerifiedPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve('mra_live_check_failed'); }, 90000);
            const listener = (req) => {
              if (req.action === 'mra_live_verified' || req.action === 'mra_live_check_failed') {
                clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(req.action);
              }
            };
            chrome.runtime.onMessage.addListener(listener);
          });

          chrome.tabs.sendMessage(notLiveTabs[i].tab.id, { action: 'mra_launch_stream' }, () => {
            if (chrome.runtime.lastError) console.warn('Launch fail:', chrome.runtime.lastError.message);
          });

          const result = await liveVerifiedPromise;
          plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
          plan.steps[stepIdx].status = result === 'mra_live_verified' ? 'done' : 'failed';
          stepIdx++;
          await broadcastPlan(plan);

          try {
            const ok = result === 'mra_live_verified';
            chrome.notifications.create('mra_step_' + Date.now(), {
              type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: ok ? `✅ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
              message: ok ? `«${plan.steps[stepIdx-1].title}» — НАЖИВО!` : `«${plan.steps[stepIdx-1].title}» — не вдалося`
            });
          } catch (e) {}

          if (i < notLiveTabs.length - 1) {
            plan.detail = '⏳ Cooldown 8с...';
            await broadcastPlan(plan);
            await new Promise(r => setTimeout(r, 8000));
            plan.detail = '';
          }
        }

      } else {
        // ── СТАРИЙ РЕЖИМ: Спочатку запустити, потім завершити ──
        const oldTabsList = [...liveTabs];
        const newTabsList = [...notLiveTabs];

        while (newTabsList.length > 0 || oldTabsList.length > 0) {
          const newTab = newTabsList.shift();
          const oldTab = oldTabsList.shift();
          let result = 'mra_live_verified';

          if (newTab) {
            plan.steps[stepIdx].status = 'active';
            plan.detail = '';
            await broadcastPlan(plan);
            const stepStart = Date.now();

            console.log('[TSN MANAGER BG] 👉 FOCUSING NEW TAB:', newTab.tab.id);
            await chrome.tabs.update(newTab.tab.id, { active: true });
            await chrome.windows.update(newTab.tab.windowId, { focused: true });
            await new Promise(r => setTimeout(r, 1000));

            const liveVerifiedPromise = new Promise((resolve) => {
              const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve('mra_live_check_failed'); }, 90000);
              const listener = (req) => {
                if (req.action === 'mra_live_verified' || req.action === 'mra_live_check_failed') {
                  clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(req.action);
                }
              };
              chrome.runtime.onMessage.addListener(listener);
            });

            chrome.tabs.sendMessage(newTab.tab.id, { action: 'mra_launch_stream' }, () => {
              if (chrome.runtime.lastError) console.warn('Launch fail:', chrome.runtime.lastError.message);
            });

            result = await liveVerifiedPromise;
            plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
            plan.steps[stepIdx].status = result === 'mra_live_verified' ? 'done' : 'failed';
            stepIdx++;
            await broadcastPlan(plan);

            try {
              const ok = result === 'mra_live_verified';
              chrome.notifications.create('mra_step_' + Date.now(), {
                type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
                title: ok ? `✅ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
                message: ok ? `«${plan.steps[stepIdx-1].title}» — НАЖИВО!` : `«${plan.steps[stepIdx-1].title}» — не вдалося`
              });
            } catch (e) {}
          }

          if (oldTab && result === 'mra_live_verified') {
            plan.steps[stepIdx].status = 'active';
            plan.detail = '';
            await broadcastPlan(plan);
            const stepStart = Date.now();

            console.log('[TSN MANAGER BG] 👉 FOCUSING OLD TAB to stop:', oldTab.tab.id);
            await chrome.tabs.update(oldTab.tab.id, { active: true });
            await chrome.windows.update(oldTab.tab.windowId, { focused: true });
            await new Promise(r => setTimeout(r, 1000));

            const endVerifiedPromise = new Promise((resolve) => {
              const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 20000);
              const listener = (req) => {
                if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
              };
              chrome.runtime.onMessage.addListener(listener);
            });

            chrome.tabs.sendMessage(oldTab.tab.id, { action: 'mra_end_stream' }, () => {
              if (chrome.runtime.lastError) console.warn('End fail:', chrome.runtime.lastError.message);
            });

            await endVerifiedPromise;
            plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
            plan.steps[stepIdx].status = 'done';
            stepIdx++;
            await broadcastPlan(plan);

            try {
              chrome.notifications.create('mra_step_' + Date.now(), {
                type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
                title: `✅ Крок ${stepIdx}/${plan.steps.length}`,
                message: `«${plan.steps[stepIdx-1].title}» — ЗАВЕРШЕНО!`
              });
            } catch (e) {}

            plan.detail = '⏳ Cooldown 8с...';
            await broadcastPlan(plan);
            await new Promise(r => setTimeout(r, 8000));
            plan.detail = '';

          } else if (newTab && result !== 'mra_live_verified') {
            console.log('[TSN MANAGER BG] 🚨 Skipping end stream because new stream FAILED to start.');
            break;
          }

          if (newTabsList.length > 0) {
            plan.detail = '⏳ Cooldown 8с...';
            await broadcastPlan(plan);
            await new Promise(r => setTimeout(r, 8000));
            plan.detail = '';
          }
        }
      }

      await broadcastPlan(plan); // Фінальний стан
      try {
        chrome.notifications.create('mra_done_notify', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '✅ ТСН — План виконано!',
          message: `Всі ${plan.steps.length} кроків завершено.`
        });
      } catch (e) {}

      return;
    }

    // ── РЕЖИМ: ЗАВЕРШЕННЯ ЕФІРУ (якщо це НЕ "Зміна ефіру") ──
    if (data.actionType === 'end') {
      if (liveTabs.length === 0) {
        console.log('[TSN MANAGER BG] 🔴 No live tabs found to end.');
        try {
          chrome.notifications.create('mra_found_notify', {
            type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: '⚠️ ТСН — Не знайдено ефірів',
            message: 'Таймер зупинки спрацював, але трансляцій НАЖИВО немає.'
          });
        } catch (e) { }
        return;
      }

      // План: завершити всі LIVE
      const plan = { steps: [], currentStep: -1, startedAt: Date.now(), detail: '' };
      for (const t of liveTabs) {
        plan.steps.push({ action: 'end', title: getStreamTitleFromTab(t.tab), status: 'pending', duration: null });
      }
      await broadcastPlan(plan);

      console.log(`[TSN MANAGER BG] 🔴 END MODE: stopping ${liveTabs.length} live stream(s).`);
      for (let i = 0; i < liveTabs.length; i++) {
        plan.steps[i].status = 'active';
        await broadcastPlan(plan);
        const stepStart = Date.now();

        await chrome.tabs.update(liveTabs[i].tab.id, { active: true });
        await chrome.windows.update(liveTabs[i].tab.windowId, { focused: true });
        await new Promise(r => setTimeout(r, 1000));

        const endPromise = new Promise((resolve) => {
          const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 20000);
          const listener = (req) => {
            if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
          };
          chrome.runtime.onMessage.addListener(listener);
        });

        chrome.tabs.sendMessage(liveTabs[i].tab.id, { action: 'mra_end_stream' }, () => {
          if (chrome.runtime.lastError) console.warn('[TSN MANAGER BG] Failed to send end_stream:', chrome.runtime.lastError.message);
        });

        await endPromise;
        plan.steps[i].duration = Math.round((Date.now() - stepStart) / 1000);
        plan.steps[i].status = 'done';
        await broadcastPlan(plan);

        try {
          chrome.notifications.create('mra_step_' + Date.now(), {
            type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `⏹ Крок ${i+1}/${plan.steps.length}`,
            message: `«${plan.steps[i].title}» — ЗАВЕРШЕНО!`
          });
        } catch (e) { }
      }

      await broadcastPlan(plan);
      try {
        chrome.notifications.create('mra_done_notify', {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '⏹ ТСН — Всі трансляції зупинено',
          message: `Завершено ${liveTabs.length} трансляці${liveTabs.length === 1 ? 'ю' : 'й'} за планом.`
        });
      } catch (e) { }
      return;
    }

    // ── Обидві не запущені → запускаємо всі ──
    console.log('[TSN MANAGER BG] 🚀 LAUNCH ALL MODE:', livestreamTabs.length, 'tabs');

    // Будуємо План Дій
    const plan = { steps: [], currentStep: -1, startedAt: Date.now(), detail: '' };
    for (const t of livestreamTabs) {
      plan.steps.push({ action: 'launch', title: getStreamTitleFromTab(t), status: 'pending', duration: null });
    }
    await broadcastPlan(plan);

    try {
      chrome.notifications.create('mra_found_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: `🚀 ПЛАН ДІЙ: запустити ${plan.steps.length} ефірів`,
        message: 'Починаємо почерговий запуск о ' + (data.scheduledTime || '') + '...'
      });
    } catch (e) { }

    if (livestreamTabs[0]) {
      await chrome.windows.update(livestreamTabs[0].windowId, { focused: true });
    }

    let launched = 0;
    let failed = 0;

    for (let i = 0; i < livestreamTabs.length; i++) {
      const tab = livestreamTabs[i];
      plan.steps[i].status = 'active';
      plan.detail = '';
      await broadcastPlan(plan);
      const stepStart = Date.now();

      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await new Promise(r => setTimeout(r, 1000));

      const verifyPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          resolve('mra_live_check_failed');
        }, 90000);
        const listener = (req) => {
          if (req.action === 'mra_live_verified' || req.action === 'mra_live_check_failed') {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(req.action);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      });

      chrome.tabs.sendMessage(tab.id, { action: 'mra_launch_stream' }, () => {
        if (chrome.runtime.lastError) console.warn('[TSN MANAGER BG] Tab', tab.id, 'sendMessage error:', chrome.runtime.lastError.message);
      });

      const result = await verifyPromise;
      plan.steps[i].duration = Math.round((Date.now() - stepStart) / 1000);

      if (result === 'mra_live_verified') {
        plan.steps[i].status = 'done';
        launched++;
      } else {
        plan.steps[i].status = 'failed';
        failed++;
      }
      await broadcastPlan(plan);

      try {
        const ok = result === 'mra_live_verified';
        chrome.notifications.create('mra_step_' + Date.now(), {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: ok ? `✅ Крок ${i+1}/${plan.steps.length}` : `❌ Крок ${i+1}/${plan.steps.length}`,
          message: ok ? `«${plan.steps[i].title}» — НАЖИВО!` : `«${plan.steps[i].title}» — не вдалося`
        });
      } catch (e) {}

      if (i < livestreamTabs.length - 1) {
        plan.detail = '⏳ Cooldown 8с...';
        await broadcastPlan(plan);
        await new Promise(r => setTimeout(r, 8000));
        plan.detail = '';
      }
    }

    await broadcastPlan(plan);
    try {
      const allOk = failed === 0;
      chrome.notifications.create('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: allOk
          ? '✅ ТСН — План виконано!'
          : `⚠️ ТСН — Запущено: ${launched} з ${plan.steps.length}`,
        message: allOk
          ? `${launched} трансляцій успішно запущено 🔴`
          : `Успішно: ${launched} | Помилка: ${failed}`
      });
    } catch (e) { }

    return;
  }

  // ── РЕЖИМ (1 Вкладка або 0 Вкладок) ──
  const livestreamTab = livestreamTabs[0] || null;
  const anyStudioTab = allStudioTabs[0] || null;

  // ── РОЗУМНА ПЕРЕВІРКА РЕАЛЬНОГО СТАНУ (для 1 вкладки) ──
  // Не довіряємо сліпо actionType! Спочатку перевіряємо, що реально відбувається.
  let realIsLive = false;
  if (livestreamTab) {
    realIsLive = await new Promise(resolve => {
      chrome.scripting.executeScript({
        target: { tabId: livestreamTab.id },
        func: () => {
          function searchInRoot(root) {
            let state = { hasEnd: false, hasStart: false };
            for (const el of root.querySelectorAll('*')) {
              const tag = el.tagName ? el.tagName.toLowerCase() : '';
              if (tag === 'button' || tag.startsWith('ytcp-')) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  const text  = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                  const label = (el.getAttribute ? (el.getAttribute('aria-label') || '') : '').toLowerCase();
                  const isTest = text.includes('тест') || label.includes('тест') || text.includes('test') || label.includes('test');
                  if (!isTest) {
                    const isPlayback = text.includes('відтворення') || label.includes('відтворення') || text.includes('play') || label.includes('play');
                    const isEnd = !isPlayback && (
                      text.includes('завершити') || label.includes('завершити') ||
                      text === 'зупинити' || label === 'зупинити' ||
                      (text.includes('зупинити') && text.includes('трансляцію')) ||
                      text.includes('end stream') || label.includes('end stream')
                    );
                    if (isEnd) state.hasEnd = true;
                    const isStart = text.includes('почати') || label.includes('почати') || text.includes('розпочати') || label.includes('розпочати') || text.includes('go live') || label.includes('go live');
                    if (isStart) state.hasStart = true;
                  }
                }
              }
              if (el.shadowRoot) {
                const cs = searchInRoot(el.shadowRoot);
                if (cs.hasEnd) state.hasEnd = true;
                if (cs.hasStart) state.hasStart = true;
              }
            }
            return state;
          }
          const s = searchInRoot(document.body);
          return s.hasEnd && !s.hasStart;
        }
      }, (results) => {
        const isLive = !chrome.runtime.lastError && results?.[0]?.result === true;
        console.log('[TSN MANAGER BG] 🔍 Single tab real live status:', isLive);
        resolve(isLive);
      });
    });
  }

  // ── ВИБІР ДІЇ НА ОСНОВІ РЕАЛЬНОСТІ ──
  let resolvedAction = data.actionType || 'launch';

  if (resolvedAction === 'end' && !realIsLive) {
    console.warn('[TSN MANAGER BG] ⚠️ actionType=end, але стрім НЕ живий! Перемикаємось на ЗАПУСК.');
    resolvedAction = 'launch';
    try {
      chrome.notifications.create('mra_smart_switch_' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🧠 ТСН — Розумне перемикання',
        message: 'Таймер був "Зупинка", але трансляція не в ефірі — запускаю!'
      });
    } catch (e) { }
  } else if (resolvedAction === 'launch' && realIsLive) {
    console.warn('[TSN MANAGER BG] ⚠️ actionType=launch, але стрім вже НАЖИВО! Нічого не робимо.');
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });
    try {
      chrome.notifications.create('mra_already_live_' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '✅ ТСН — Вже в ефірі',
        message: 'Трансляція вже НАЖИВО — нічого не запускаємо.'
      });
    } catch (e) { }
    return;
  }

  // ── РЕЖИМ ЗАВЕРШЕННЯ ──
  if (resolvedAction === 'end') {
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });

    if (!livestreamTab) {
      console.log('[TSN MANAGER BG] 🔴 End mode fired, but no active livestream tab found.');
      try {
        chrome.notifications.create('mra_found_notify', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '⚠️ ТСН — Не знайдено ефірів',
          message: 'Таймер зупинки спрацював, але відкритої сторінки трансляції немає.'
        });
      } catch (e) { }
      return;
    }

    await chrome.tabs.update(livestreamTab.id, { active: true });
    await chrome.windows.update(livestreamTab.windowId, { focused: true });
    console.log('[TSN MANAGER BG] 🔴 Sending end stream command to tab', livestreamTab.id);
    chrome.tabs.sendMessage(livestreamTab.id, { action: 'mra_end_stream' }, () => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    });

    try {
      chrome.notifications.create('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '⏹ ТСН — Зупиняємо ефір',
        message: 'Команду на зупинку трансляції успішно надіслано.'
      });
    } catch (e) { }
    return;
  }

  let targetTab = null;
  let needsNavigation = false;

  if (livestreamTab) {
    // ✅ Ідеально: вкладка вже на правильній сторінці трансляції — не чіпаємо URL!
    targetTab = livestreamTab;
    await chrome.tabs.update(targetTab.id, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    console.log('[TSN MANAGER BG] Found existing livestream tab, keeping URL:', targetTab.url);
  } else if (anyStudioTab) {
    // 🔄 Є вкладка Studio але не на livestreaming — переходимо на manage
    targetTab = anyStudioTab;
    needsNavigation = true;
    await chrome.tabs.update(targetTab.id, {
      active: true,
      url: 'https://studio.youtube.com/livestreaming/manage'
    });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    console.log('[TSN MANAGER BG] Navigating Studio tab to manage page');
  } else {
    // 🆕 Немає жодної вкладки — відкриваємо нову
    targetTab = await chrome.tabs.create({
      url: 'https://studio.youtube.com/livestreaming/manage',
      active: true
    });
    needsNavigation = true;
    console.log('[TSN MANAGER BG] Opened new tab');
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
      console.warn('[TSN MANAGER BG] All retry attempts exhausted, content script did not respond.');
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

    console.log(`[TSN MANAGER BG] Sending launch message, attempts left: ${attemptsLeft}`);
    chrome.tabs.sendMessage(tabId, { action: 'mra_launch_stream' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(`[TSN MANAGER BG] Content script not ready (${attemptsLeft} left):`, chrome.runtime.lastError.message);
        // Повторна спроба через delayMs
        setTimeout(() => sendLaunchWithRetry(attemptsLeft - 1, delayMs), delayMs);
        return;
      }
      console.log('[TSN MANAGER BG] ✅ Launch message delivered');
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
    console.log('[TSN MANAGER BG] ✅ Live verified:', request.title);
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

  // ── Верифікація: ефір успішно завершився ──
  if (request.action === 'mra_stream_ended') {
    console.log('[TSN MANAGER BG] ⏹ Stream ended verified:', request.title);
    try {
      chrome.notifications.create('mra_end_ok_' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '✅ ТСН — Ефір ЗАВЕРШЕНО!',
        message: `"${request.title || 'Трансляція'}" успішно зупинена ⏹`
      });
    } catch (e) { }
    return;
  }

  // ── Тривога: ефір НЕ запустився після 60с ──
  if (request.action === 'mra_live_check_failed') {
    console.error('[TSN MANAGER BG] 🚨 Live check FAILED:', request.title);
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
      pendingLaunch: false,
      actionType: request.actionType || 'launch'
    }).then(() => {
      // Badge показує час запуску
      chrome.action.setBadgeText({ text: timeStr });
      chrome.action.setBadgeBackgroundColor({ color: request.actionType === 'end' ? '#ff6b6b' : '#c91c1c' });

      console.log('[TSN MANAGER BG] Alarm set for', timeStr, '(in', Math.round(delayMin), 'min)');
      sendResponse({ success: true, fireAt: target.toISOString() });
    });

    return true; // async
  }

  // Отримати поточний стан
  if (request.action === 'mra_get_alarm_status') {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
      chrome.storage.local.get(['scheduledTime', 'scheduleEnabled', 'actionType'], (data) => {
        sendResponse({ alarm: alarm || null, ...data });
      });
    });
    return true;
  }
});
