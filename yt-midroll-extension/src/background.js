// ─── BACKGROUND SERVICE WORKER ───────────────────────────────────────────────
// Використовує chrome.alarms (MV3) — не засинає під час очікування.
// При спрацюванні: переходить на вкладку livestreaming/manage, чекає завантаження
// і надсилає повідомлення напряму в scheduler.js.

const ALARM_NAME = 'mra_stream_launch';

// ── Ініціалізація при встановленні або оновленні ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['tgSettings', 'tgEnabledMigrated'], (data) => {
    if (!data.tgSettings) {
      chrome.storage.local.set({
        tgSettings: { enabled: true, token: '', chatId: '' },
        tgEnabledMigrated: true
      });
      console.log('[TSN MANAGER BG] ✅ Initialized tgSettings with enabled=true');
    } else if (data.tgSettings.enabled === false && !data.tgEnabledMigrated) {
      // Старий баг: enabled=false записувався мовчки за замовчуванням. Одноразово вмикаємо.
      chrome.storage.local.set({
        tgSettings: { ...data.tgSettings, enabled: true },
        tgEnabledMigrated: true
      });
      console.log('[TSN MANAGER BG] ✅ Migrated tgSettings.enabled false→true (one-time)');
    } else if (!data.tgEnabledMigrated) {
      chrome.storage.local.set({ tgEnabledMigrated: true });
    }
  });
});

// ── Сповіщення з перевіркою налаштувань ──
// Категорії: 'notif-stream-live', 'notif-stream-ended', 'notif-command-sent',
//            'notif-plan', 'notif-steps', 'notif-plan-done', 'notif-errors', 'notif-smart'
function notify(id, opts, category) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('notifSettings', (data) => {
        if (chrome.runtime.lastError) {
          console.error('[TSN MANAGER BG] Storage get error:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        const s = (data && data.notifSettings) || {};
        if (s._master === false) { resolve(false); return; }
        if (category && s[category] === false) { resolve(false); return; }

        chrome.notifications.create(id, opts, () => {
          if (chrome.runtime.lastError) {
            console.error('[TSN MANAGER BG] chrome.notifications.create error:', chrome.runtime.lastError.message);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (e) {
      console.error('[TSN MANAGER BG] Exception inside notify:', e);
      resolve(false);
    }
  });
}

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

      const modeLabel = endBeforeLaunch ? 'Спочатку END → потім GO LIVE' : 'Спочатку GO LIVE → потім END';
      await notify('mra_found_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: `🔄 ПЛАН ДІЙ: ${plan.steps.length} кроків`,
        message: `${modeLabel}: ${liveTabs.length} завершити + ${notLiveTabs.length} запустити`
      }, 'notif-plan');

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
            // 40с: повний цикл end у content script (пошук кнопки до 22.5с + клік + діалог + верифікація) може тривати до ~36с
            const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 40000);
            const listener = (req) => {
              if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
            };
            chrome.runtime.onMessage.addListener(listener);
          });

          chrome.tabs.sendMessage(liveTabs[i].tab.id, { action: 'mra_end_stream' }, () => {
            if (chrome.runtime.lastError) console.warn('End fail:', chrome.runtime.lastError.message);
          });

          const endOk = await endVerifiedPromise;
          plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
          // Якщо завершення не підтвердилось — крок failed, але запуск нових НЕ зупиняємо:
          // новий ефір пріоритетніший, оператор побачить ❌ і завершить старий вручну.
          plan.steps[stepIdx].status = endOk ? 'done' : 'failed';
          stepIdx++;
          await broadcastPlan(plan);

          if (!endOk) console.warn('[TSN MANAGER BG] ⚠️ End NOT confirmed for tab', liveTabs[i].tab.id);
          await notify('mra_step_' + Date.now(), {
            type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: endOk ? `⏹ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
            message: endOk
              ? `«${plan.steps[stepIdx-1].title}» — ЗАВЕРШЕНО!`
              : `«${plan.steps[stepIdx-1].title}» — завершення НЕ підтверджено! Перевірте вкладку.`
          }, 'notif-steps');

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

          const ok = result === 'mra_live_verified';
          await notify('mra_step_' + Date.now(), {
            type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: ok ? `✅ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
            message: ok ? `«${plan.steps[stepIdx-1].title}» — НАЖИВО!` : `«${plan.steps[stepIdx-1].title}» — не вдалося`
          }, 'notif-steps');

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

            const ok = result === 'mra_live_verified';
            await notify('mra_step_' + Date.now(), {
              type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: ok ? `✅ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
              message: ok ? `«${plan.steps[stepIdx-1].title}» — НАЖИВО!` : `«${plan.steps[stepIdx-1].title}» — не вдалося`
            }, 'notif-steps');
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
              // 40с: повний цикл end у content script (пошук кнопки до 22.5с + клік + діалог + верифікація) може тривати до ~36с
              const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 40000);
              const listener = (req) => {
                if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
              };
              chrome.runtime.onMessage.addListener(listener);
            });

            chrome.tabs.sendMessage(oldTab.tab.id, { action: 'mra_end_stream' }, () => {
              if (chrome.runtime.lastError) console.warn('End fail:', chrome.runtime.lastError.message);
            });

            const endOk = await endVerifiedPromise;
            plan.steps[stepIdx].duration = Math.round((Date.now() - stepStart) / 1000);
            plan.steps[stepIdx].status = endOk ? 'done' : 'failed';
            stepIdx++;
            await broadcastPlan(plan);

            if (!endOk) console.warn('[TSN MANAGER BG] ⚠️ End NOT confirmed for tab', oldTab.tab.id);
            await notify('mra_step_' + Date.now(), {
              type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: endOk ? `✅ Крок ${stepIdx}/${plan.steps.length}` : `❌ Крок ${stepIdx}/${plan.steps.length}`,
              message: endOk
                ? `«${plan.steps[stepIdx-1].title}» — ЗАВЕРШЕНО!`
                : `«${plan.steps[stepIdx-1].title}» — завершення НЕ підтверджено! Перевірте вкладку.`
            }, 'notif-steps');

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
      const doneSteps = plan.steps.filter(s => s.status === 'done').length;
      const planOk = doneSteps === plan.steps.length;
      await notify('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: planOk ? '✅ ТСН — План виконано!' : '⚠️ ТСН — План виконано частково',
        message: planOk
          ? `Всі ${plan.steps.length} кроків завершено.`
          : `Успішно: ${doneSteps} з ${plan.steps.length}. Перевірте кроки з ❌!`
      }, 'notif-plan-done');

      return;
    }

    // ── РЕЖИМ: ЗАВЕРШЕННЯ ЕФІРУ (якщо це НЕ "Зміна ефіру") ──
    if (data.actionType === 'end') {
      if (liveTabs.length === 0) {
        console.log('[TSN MANAGER BG] 🔴 No live tabs found to end.');
        await notify('mra_found_notify', {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '⚠️ ТСН — Не знайдено ефірів',
          message: 'Таймер зупинки спрацював, але трансляцій НАЖИВО немає.'
        }, 'notif-errors');
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
          // 40с: повний цикл end у content script (пошук кнопки до 22.5с + клік + діалог + верифікація) може тривати до ~36с
          const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(false); }, 40000);
          const listener = (req) => {
            if (req.action === 'mra_stream_ended') { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve(true); }
          };
          chrome.runtime.onMessage.addListener(listener);
        });

        chrome.tabs.sendMessage(liveTabs[i].tab.id, { action: 'mra_end_stream' }, () => {
          if (chrome.runtime.lastError) console.warn('[TSN MANAGER BG] Failed to send end_stream:', chrome.runtime.lastError.message);
        });

        const endOk = await endPromise;
        plan.steps[i].duration = Math.round((Date.now() - stepStart) / 1000);
        plan.steps[i].status = endOk ? 'done' : 'failed';
        await broadcastPlan(plan);

        await notify('mra_step_' + Date.now(), {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: endOk ? `⏹ Крок ${i+1}/${plan.steps.length}` : `❌ Крок ${i+1}/${plan.steps.length}`,
          message: endOk
            ? `«${plan.steps[i].title}» — ЗАВЕРШЕНО!`
            : `«${plan.steps[i].title}» — завершення НЕ підтверджено! Перевірте вкладку.`
        }, 'notif-steps');
      }

      await broadcastPlan(plan);
      const endedCount = plan.steps.filter(s => s.status === 'done').length;
      const endFailed = plan.steps.length - endedCount;
      await notify('mra_done_notify', {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: endFailed === 0 ? '⏹ ТСН — Всі трансляції зупинено' : '⚠️ ТСН — Зупинено не всі трансляції',
        message: endFailed === 0
          ? `Завершено ${endedCount} трансляці${endedCount === 1 ? 'ю' : 'й'} за планом.`
          : `Завершено: ${endedCount} з ${plan.steps.length}. Перевірте вкладки з ❌!`
      }, 'notif-plan-done');
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

    await notify('mra_found_notify', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `🚀 ПЛАН ДІЙ: запустити ${plan.steps.length} ефірів`,
      message: 'Починаємо почерговий запуск о ' + (data.scheduledTime || '') + '...'
    }, 'notif-plan');

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

      const ok = result === 'mra_live_verified';
      await notify('mra_step_' + Date.now(), {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: ok ? `✅ Крок ${i+1}/${plan.steps.length}` : `❌ Крок ${i+1}/${plan.steps.length}`,
        message: ok ? `«${plan.steps[i].title}» — НАЖИВО!` : `«${plan.steps[i].title}» — не вдалося`
      }, 'notif-steps');

      if (i < livestreamTabs.length - 1) {
        plan.detail = '⏳ Cooldown 8с...';
        await broadcastPlan(plan);
        await new Promise(r => setTimeout(r, 8000));
        plan.detail = '';
      }
    }

    await broadcastPlan(plan);
    const allOk = failed === 0;
    await notify('mra_done_notify', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: allOk
        ? '✅ ТСН — План виконано!'
        : `⚠️ ТСН — Запущено: ${launched} з ${plan.steps.length}`,
      message: allOk
        ? `${launched} трансляцій успішно запущено 🔴`
        : `Успішно: ${launched} | Помилка: ${failed}`
    }, 'notif-plan-done');

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
    await notify('mra_smart_switch_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🧠 ТСН — Розумне перемикання',
      message: 'Таймер був "Зупинка", але трансляція не в ефірі — запускаю!'
    }, 'notif-smart');
  } else if (resolvedAction === 'launch' && realIsLive) {
    console.warn('[TSN MANAGER BG] ⚠️ actionType=launch, але стрім вже НАЖИВО! Нічого не робимо.');
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });
    await notify('mra_already_live_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '✅ ТСН — Вже в ефірі',
      message: 'Трансляція вже НАЖИВО — нічого не запускаємо.'
    }, 'notif-smart');
    return;
  }

  // ── РЕЖИМ ЗАВЕРШЕННЯ ──
  if (resolvedAction === 'end') {
    await chrome.storage.local.set({ scheduleEnabled: false, pendingLaunch: false });
    chrome.action.setBadgeText({ text: '' });

    if (!livestreamTab) {
      console.log('[TSN MANAGER BG] 🔴 End mode fired, but no active livestream tab found.');
      await notify('mra_found_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '⚠️ ТСН — Не знайдено ефірів',
        message: 'Таймер зупинки спрацював, але відкритої сторінки трансляції немає.'
      }, 'notif-errors');
      return;
    }

    await chrome.tabs.update(livestreamTab.id, { active: true });
    await chrome.windows.update(livestreamTab.windowId, { focused: true });
    console.log('[TSN MANAGER BG] 🔴 Sending end stream command to tab', livestreamTab.id);
    chrome.tabs.sendMessage(livestreamTab.id, { action: 'mra_end_stream' }, () => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    });

    await notify('mra_done_notify', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '⏹ ТСН — Зупиняємо ефір',
      message: 'Команду на зупинку трансляції успішно надіслано.'
    }, 'notif-command-sent');
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
  const foundCount = livestreamTab ? 1 : 0;
  const foundMsg = foundCount > 0
    ? `Знайдено 1 трансляцію, запускаємо о ${data.scheduledTime || ''}...`
    : `Відкриваємо YouTube Studio о ${data.scheduledTime || ''}...`;

  await notify('mra_launch_notify', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '🔍 ТСН — Знайдено: ' + (foundCount > 0 ? '1 трансляцію' : 'немає вкладок'),
    message: foundMsg
  }, 'notif-command-sent');

  // Вимикаємо розклад (одноразовий)
  await chrome.storage.local.set({ scheduleEnabled: false });
  chrome.action.setBadgeText({ text: '' });

  // ── КЛЮЧОВА ЧАСТИНА: Чекаємо повного завантаження сторінки і надсилаємо trigger ──
  // Це надійніше ніж покладатись на pendingLaunch флаг при document_start
  const tabId = targetTab.id;

  function sendLaunchWithRetry(attemptsLeft, delayMs) {
    if (attemptsLeft <= 0) {
      console.warn('[TSN MANAGER BG] All retry attempts exhausted, content script did not respond.');
      notify('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '⚠️ ТСН — Не вдалось запустити ефір',
        message: 'Скрипт не відповів після 5 спроб. Перевірте вкладку YouTube Studio.'
      }, 'notif-errors');
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
      notify('mra_done_notify', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '✅ ТСН — Команду надіслано!',
        message: 'Бот запускає трансляцію 🔴'
      }, 'notif-command-sent');
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

// ── Telegram-звіти ──
function tgEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function fmtDur(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  if (h > 0) return `${h} год ${mm} хв ${sss} с`;
  return `${mm} хв ${sss} с`;
}

function fmtTc(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

async function tgApi(token, method, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    // Не логуємо токен
    throw new Error('Telegram API fetch error: ' + e.message);
  }
}

function buildTgReport(report) {
  const { videoTitle, videoId, videoDurationSec, totalPlanned, ok, fail, events } = report;

  const durStr = videoDurationSec > 0 ? fmtDur(videoDurationSec) : 'невідомо';
  const studioUrl = videoId ? `https://studio.youtube.com/video/${videoId}/edit` : '';

  // ── КРИТИЧНИЙ КЕЙС: «встик» — жодного місця для реклами ──
  if (report.kind === 'no_spots') {
    const an = report.analysis || {};
    let lines = [];
    lines.push(`🔴 <b>ТСН Менеджер — КРИТИЧНО: МІТКИ НЕ ПОСТАВЛЕНО</b>`);
    lines.push('');
    lines.push(`📹 Відео: «${tgEscape(videoTitle)}»`);
    lines.push(`⏱ Хронометраж: ${durStr}`);
    if (studioUrl) lines.push(`🔗 <a href="${studioUrl}">Відкрити редактор</a>`);
    lines.push('');
    lines.push(`🎬 <b>Відео змонтоване ВСТИК</b> — бот не знайшов жодного придатного місця для реклами.`);
    if (an.idealAds) {
      const escalatedNote = an.escalated
        ? ` навіть з максимальною чутливістю (поріг ${an.finalThr}%, мін. тиша ${an.finalMinS}с)`
        : '';
      lines.push(`За хронометражем тут мало бути ${an.idealAds} міток. Бот шукав паузи${escalatedNote} — сирих тихих ділянок знайдено: ${an.pausesFound}, придатних: 0.`);
    }
    lines.push('');
    lines.push(`⚠️ <b>Наслідок:</b> у цьому відео РЕКЛАМИ НЕ БУДЕ, доки мітки не поставлять вручну.`);
    lines.push('');
    lines.push(`👉 <b>Що робити:</b>`);
    lines.push(`1. Відкрити редактор за посиланням і спробувати поставити мітки вручну.`);
    lines.push(`2. Якщо пауз справді нема — повернути відео монтажерам, щоб додали природні паузи (~кожні 2 хвилини).`);
    const text = lines.join('\n');
    if (text.length > 4000) return text.substring(0, 3997) + '…';
    return text;
  }

  // ── ПОПЕРЕДЖЕННЯ: складний монтаж / міток менше за ідеал (звіт одразу після аналізу) ──
  if (report.kind === 'analysis_warn') {
    const an = report.analysis || {};
    const selectedCount = report.selectedCount || 0;
    let lines = [];
    lines.push(`🟠 <b>ТСН Менеджер — СКЛАДНИЙ МОНТАЖ: мало природних пауз</b>`);
    lines.push('');
    lines.push(`📹 Відео: «${tgEscape(videoTitle)}»`);
    lines.push(`⏱ Хронометраж: ${durStr}`);
    if (studioUrl) lines.push(`🔗 <a href="${studioUrl}">Відкрити редактор</a>`);
    lines.push('');
    lines.push(`📊 <b>Мітки:</b> ${selectedCount} із ~${an.idealAds || '?'} ідеальних. Природних пауз: ${an.realPauses || 0}, запасних (у «найтихіших місцях»): ${an.backupCount || 0}.`);
    if (an.escalated) lines.push(`🤖 Бот сам підняв чутливість до ${an.finalThr}% (пауза ≥${an.finalMinS}с), але природних пауз все одно мало.`);
    if (Array.isArray(report.marks) && report.marks.length) {
      lines.push('');
      lines.push(`<i>Поставлені позиції:</i>`);
      report.marks.forEach((m, i) => {
        lines.push(`${i + 1}. ${tgEscape(m.tc)} — ${m.backup ? '🛟 запасна' : `✅ пауза${m.quality ? ' ' + tgEscape(m.quality) : ''}`}`);
      });
    }
    lines.push('');
    lines.push(`⚠️ <b>Наслідок:</b> YouTube може рідше показувати рекламу в запасних мітках, а частини доходу бракуватиме через нестачу міток.`);
    lines.push('');
    lines.push(`👉 <b>Що робити:</b> відкрити редактор, прослухати запасні мітки і за можливості пересунути їх у реальні паузи; якщо міток мало — додати вручну.`);
    const text = lines.join('\n');
    if (text.length > 4000) return text.substring(0, 3997) + '…';
    return text;
  }

  // ── Звичайний звіт про вставку ──
  const allProblems = (events || []).filter(ev => ev.type !== 'yt_flag_moved');
  const movedOk = (events || []).filter(ev => ev.type === 'yt_flag_moved');
  // insert_failed вже є в allProblems (кожен fail++ пушить подію) — fail окремо не додаємо
  const problemCount = Math.max(allProblems.length, fail);

  let lines = [];
  lines.push(`🚨 <b>ТСН Менеджер — проблеми з мітками реклами</b>`);
  lines.push('');
  lines.push(`📹 Відео: «${tgEscape(videoTitle)}»`);
  lines.push(`⏱ Хронометраж: ${durStr}`);
  if (studioUrl) lines.push(`🔗 <a href="${studioUrl}">Відкрити редактор</a>`);
  lines.push('');
  lines.push(`📊 <b>Підсумок:</b> мали вставити ${totalPlanned} міток, успішно ${ok}, з проблемами ${problemCount}`);

  // Попередження про монтаж встик (якщо менше 30% природних пауз)
  const an = report.analysis || {};
  if (an.idealAds > 0 && (an.realPauses || 0) / an.idealAds < 0.3) {
    const zeroNote = (an.realPauses || 0) === 0 ? ' (ЖОДНОЇ)' : '';
    lines.push('');
    lines.push(`🎬 <b>Увага — монтаж встик:</b> з потрібних ${an.idealAds} міток природних пауз лише ${an.realPauses || 0}${zeroNote}. Решта (${an.backupCount || 0}) поставлені у «найтихіших місцях» — YouTube може рідше показувати там рекламу або бракувати ці мітки.`);
  }

  lines.push('');
  lines.push(`<i>Що пішло не так:</i>`);

  // Всі події: спочатку проблемні, потім переміщені (довідково)
  const allEvents = [...allProblems, ...movedOk];
  const showEvents = allEvents.slice(0, 15);
  const hiddenCount = allEvents.length - showEvents.length;

  showEvents.forEach((ev, i) => {
    const num = i + 1;
    if (ev.type === 'insert_failed') {
      lines.push(`${num}. ❌ ${tgEscape(ev.plannedTc)} — мітку НЕ ВСТАВЛЕНО (технічний збій). Як мало бути: рекламна пауза на ${tgEscape(ev.plannedTc)}${ev.quality ? ` (якість паузи: ${tgEscape(ev.quality)})` : ''}. Цю мітку треба поставити вручну.${ev.error ? ` <i>Причина для розробника: ${tgEscape(String(ev.error).substring(0, 120))}</i>` : ''}`);
    } else if (ev.type === 'time_mismatch') {
      lines.push(`${num}. ⚠️ ${tgEscape(ev.plannedTc)} — мітка стала на НЕПРАВИЛЬНИЙ час ${tgEscape(ev.actualTc)}. Як мало бути: ${tgEscape(ev.plannedTc)}. Перевірте і пересуньте вручну.`);
    } else if (ev.type === 'yt_flag_stuck') {
      lines.push(`${num}. 🟡 ${tgEscape(ev.atTc)} — YouTube попереджає, що реклама в цьому місці може НЕ ПОКАЗУВАТИСЬ (немає природної паузи поруч). Бот 3 рази спробував пересунути — не вийшло. Перегляньте це місце.`);
    } else if (ev.type === 'yt_flag_removed') {
      lines.push(`${num}. 🗑 ${tgEscape(ev.atTc)} — YouTube не прийняв це місце, мітку ВИДАЛЕНО. В цій частині відео реклами не буде, якщо не поставити вручну.`);
    } else if (ev.type === 'yt_flag_moved') {
      lines.push(`${num}. ✅ ${tgEscape(ev.fromTc)} → ${tgEscape(ev.toTc)} — YouTube забракував місце, але бот сам пересунув мітку на сусідню паузу. Виправлено автоматично.`);
    }
  });

  if (hiddenCount > 0) {
    lines.push(`…та ще ${hiddenCount} проблем`);
  }

  lines.push('');
  lines.push(`👉 <b>Що робити:</b> відкрити редактор за посиланням вище і перевірити мітки зі значками ❌/⚠️/🟡/🗑.`);

  const text = lines.join('\n');
  // Telegram ліміт 4096 символів
  if (text.length > 4000) return text.substring(0, 3997) + '…';
  return text;
}

async function pushTgHistory(entry) {
  try {
    const data = await chrome.storage.local.get('tgHistory');
    const history = Array.isArray(data.tgHistory) ? data.tgHistory : [];
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ tgHistory: history });
  } catch (e) { /* не критично */ }
}

// ── Повідомлення від popup.js та content scripts ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── Верифікація: ефір успішно запустився ──
  if (request.action === 'mra_live_verified') {
    console.log('[TSN MANAGER BG] ✅ Live verified:', request.title);
    notify('mra_live_ok_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '✅ ТСН — Ефір НАЖИВО!',
      message: `"${request.title || 'Трансляція'}" успішно запущена 🔴`
    }, 'notif-stream-live');
    return;
  }

  // ── Верифікація: ефір успішно завершився ──
  if (request.action === 'mra_stream_ended') {
    console.log('[TSN MANAGER BG] ⏹ Stream ended verified:', request.title);
    notify('mra_end_ok_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '✅ ТСН — Ефір ЗАВЕРШЕНО!',
      message: `"${request.title || 'Трансляція'}" успішно зупинена ⏹`
    }, 'notif-stream-ended');
    return;
  }

  // ── Тривога: ефір НЕ запустився після 60с ──
  if (request.action === 'mra_live_check_failed') {
    console.error('[TSN MANAGER BG] 🚨 Live check FAILED:', request.title);
    notify('mra_live_fail_' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🚨 ТСН — ЕФІР НЕ ЗАПУСТИВСЯ!',
      message: `"${request.title || 'Трансляція'}" — перевірте ключ трансляції у Studio!`
    }, 'notif-errors');
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

  // ── Telegram: надіслати звіт про проблемні мітки ──
  if (request.action === 'mra_tg_report') {
    (async () => {
      const { tgSettings } = await chrome.storage.local.get('tgSettings');
      const s = tgSettings || {};
      const entry = {
        ts: request.report.ts,
        videoTitle: request.report.videoTitle,
        videoId: request.report.videoId,
        ok: request.report.ok,
        fail: request.report.fail,
        kind: request.report.kind || 'insert',
        problems: request.report.kind === 'no_spots'
          ? ((request.report.analysis && request.report.analysis.idealAds) || 1)
          : request.report.kind === 'analysis_warn'
            ? ((request.report.analysis && request.report.analysis.backupCount) || 0) + Math.max(0, ((request.report.analysis && request.report.analysis.idealAds) || 0) - (request.report.selectedCount || 0))
            : (request.report.events || []).filter(ev => ev.type !== 'yt_flag_moved').length,
        sent: false,
        error: ''
      };

      console.log('[TSN MANAGER BG] 📨 Telegram report received:', {
        title: request.report.videoTitle,
        kind: request.report.kind,
        enabled: s.enabled,
        hasToken: !!s.token,
        hasChatId: !!s.chatId
      });

      if (s.enabled !== false && s.token && s.chatId) {
        try {
          console.log('[TSN MANAGER BG] 📤 Sending Telegram message...');
          const res = await tgApi(s.token, 'sendMessage', {
            chat_id: s.chatId,
            text: buildTgReport(request.report),
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
          entry.sent = !!(res && res.ok);
          if (!entry.sent) entry.error = (res && res.description) || 'невідома помилка';
          console.log('[TSN MANAGER BG] 📬 Telegram response:', { sent: entry.sent, error: entry.error });
        } catch (e) {
          entry.error = String(e.message || e);
          console.error('[TSN MANAGER BG] ❌ Telegram API error:', entry.error);
        }
      } else {
        const reason = !s.enabled ? 'disabled' : (!s.token ? 'no token' : 'no chatId');
        entry.error = `Telegram ${reason}`;
        console.warn('[TSN MANAGER BG] ⚠️ Telegram не налаштовано:', reason);
      }
      await pushTgHistory(entry);
      sendResponse({ ok: entry.sent, error: entry.error });
    })();
    return true; // async
  }

  // ── Telegram: тестове повідомлення ──
  if (request.action === 'mra_tg_test') {
    (async () => {
      try {
        const res = await tgApi(request.token, 'sendMessage', {
          chat_id: request.chatId,
          text: '✅ ТСН Менеджер підключено!\nЗвіти про проблемні мітки реклами надходитимуть у цей чат.',
          parse_mode: 'HTML'
        });
        if (res && res.ok) {
          sendResponse({ ok: true, error: '' });
        } else {
          sendResponse({ ok: false, error: (res && res.description) || 'невідома помилка' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true; // async
  }

  // ── Telegram: визначити Chat ID з оновлень бота ──
  if (request.action === 'mra_tg_detect_chat') {
    (async () => {
      try {
        const res = await tgApi(request.token, 'getUpdates', { limit: 50 });
        if (!res || !res.ok) {
          sendResponse({ ok: false, error: (res && res.description) || 'Помилка getUpdates' });
          return;
        }
        const seen = new Map();
        for (const upd of (res.result || [])) {
          const chat = (upd.message && upd.message.chat) || (upd.my_chat_member && upd.my_chat_member.chat);
          if (chat && chat.id && !seen.has(chat.id)) {
            seen.set(chat.id, {
              id: chat.id,
              title: chat.title || chat.first_name || String(chat.id),
              type: chat.type || 'unknown'
            });
          }
        }
        sendResponse({ ok: true, chats: Array.from(seen.values()) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true; // async
  }
});
