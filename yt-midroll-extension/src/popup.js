document.addEventListener('DOMContentLoaded', () => {
    const autoOpenCb = document.getElementById('auto-open-cb');
    const endFirstCb = document.getElementById('end-first-cb');
    const inpHH = document.getElementById('inp-hh');
    const inpMM = document.getElementById('inp-mm');
    const btnSchedule = document.getElementById('btn-schedule');
    const btnCancel = document.getElementById('btn-cancel');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const countdownText = document.getElementById('countdown-text');
    const timePickerUI = document.getElementById('time-picker-ui');
    const actionTypeUI = document.getElementById('action-type-ui');
    const typeLaunch = document.getElementById('type-launch');
    const typeEnd = document.getElementById('type-end');
    const hintAction = document.getElementById('hint-action');

    let currentActionType = 'launch'; // 'launch' | 'end'

    // Версія та Назва з маніфесту (єдине місце істини — не захардкодити в HTML!)
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('ext-version');
    if (versionEl) {
        versionEl.textContent = 'v' + manifest.version;
    }
    const titleEl = document.getElementById('ext-title');
    if (titleEl) {
        titleEl.textContent = manifest.name.replace(/ТСН\s*/i, '').replace(/\s*\(beta\)/i, '').trim();
    }

    // Input handlers for custom time picker to ensure valid format
    function pad(n) { return String(n).padStart(2, '0'); }
    
    inpHH.addEventListener('blur', () => {
        let val = parseInt(inpHH.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > 23) val = 23;
        inpHH.value = pad(val);
    });
    
    inpMM.addEventListener('blur', () => {
        let val = parseInt(inpMM.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > 59) val = 59;
        inpMM.value = pad(val);
    });

    // Авто-фокус на хвилини після 2 символів у годинах
    inpHH.addEventListener('input', () => {
        if (inpHH.value.length === 2 && parseInt(inpHH.value, 10) <= 23) {
            inpMM.focus();
        }
    });

    // ── Вибір типу дії ──
    typeLaunch.addEventListener('click', () => {
        if (currentActionType === 'launch') return;
        currentActionType = 'launch';
        typeLaunch.classList.add('active');
        typeEnd.classList.remove('active');
        hintAction.textContent = 'Почне ефір';
        hintAction.style.color = '#10B981'; // Green
    });

    typeEnd.addEventListener('click', () => {
        if (currentActionType === 'end') return;
        currentActionType = 'end';
        typeEnd.classList.add('active');
        typeLaunch.classList.remove('active');
        hintAction.textContent = 'Завершить ефір';
        hintAction.style.color = '#ff6b6b'; // Red
    });

    // ── Завантажуємо стан авто-відкриття панелі ──
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'mra_get_settings' }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response && response.autoOpenPanel !== undefined) {
                    autoOpenCb.checked = response.autoOpenPanel;
                }
            });
        }
    });

    // ── Завантажуємо "Спочатку завершити" ──
    chrome.storage.local.get('endBeforeLaunch', (data) => {
        endFirstCb.checked = data.endBeforeLaunch !== false; // default: true
    });

    // ── Зберігаємо авто-відкриття ──
    autoOpenCb.addEventListener('change', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'mra_set_setting',
                    key: 'autoOpenPanel',
                    value: autoOpenCb.checked
                }, () => { if (chrome.runtime.lastError) return; });
            }
        });
    });

    // ── Зберігаємо "Спочатку завершити" ──
    endFirstCb.addEventListener('change', () => {
        chrome.storage.local.set({ endBeforeLaunch: endFirstCb.checked });
    });

    // ── Підрахунок відкритих трансляцій ──
    const streamsCountEl = document.getElementById('streams-count');
    if (streamsCountEl) {
        chrome.tabs.query({ url: 'https://studio.youtube.com/*' }, (tabs) => {
            // Тільки реальні трансляції (/video/*/livestreaming), не /channel/*/livestreaming
            const livestreamTabs = (tabs || []).filter(t =>
                t.url && t.url.includes('/video/') && t.url.includes('/livestreaming')
            );
            const n = livestreamTabs.length;
            if (n === 0) {
                streamsCountEl.textContent = '⚠️ Жодної відкритої трансляції не знайдено';
                streamsCountEl.style.color = '#ff6b6b';
                return;
            }

            // Перевіряємо стан кожної вкладки через executeScript (не залежить від content script)
            Promise.all(livestreamTabs.map(tab =>
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
                                            const text  = (el.textContent  || '').replace(/\s+/g, ' ').trim().toLowerCase();
                                            const label = (el.getAttribute  ? (el.getAttribute('aria-label') || '') : '').toLowerCase();
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
                        resolve(isLive);
                    });
                })
            )).then(statuses => {
                const liveCount    = statuses.filter(Boolean).length;
                const notLiveCount = statuses.filter(s => !s).length;

                if (n === 1) {
                    if (liveCount === 1) {
                        streamsCountEl.textContent = '🔴 1 трансляція зараз НАЖИВО';
                        streamsCountEl.style.color = '#ef4444';
                    } else {
                        streamsCountEl.textContent = '📡 Знайдено 1 трансляцію для запуску';
                        streamsCountEl.style.color = '#10B981';
                    }
                } else if (liveCount >= 1 && notLiveCount >= 1) {
                    streamsCountEl.innerHTML = `
                        <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                            <span style="color:#f59e0b;">🔄 <b>Зміна ефірів:</b></span>
                            <span style="color:#10B981; margin-left:14px; display:flex; align-items:center; gap:4px;">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <b>Запустити нові</b>: ${notLiveCount}
                            </span>
                            <span style="color:#ef4444; margin-left:14px; display:flex; align-items:center; gap:4px;">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10h6v4H9z"></path></svg>
                                <b>Завершити "LIVE"</b>: ${liveCount}
                            </span>
                        </div>
                    `;
                    streamsCountEl.style.color = ''; // Стилі задані всередині
                } else if (liveCount === 0) {
                    streamsCountEl.textContent = `📡 Знайдено трансляцій для запуску: ${n}`;
                    streamsCountEl.style.color = '#10B981';
                } else {
                    streamsCountEl.innerHTML = `📡 Трансляцій: ${n} (<span style="color:#ef4444; font-weight:bold;">LIVE: ${liveCount}</span>, нових: ${notLiveCount})`;
                    streamsCountEl.style.color = '#10B981';
                }
            });
        });
    }

    // ────────────────────────────────────────────────────────────────
    // ── ПЛАНУВАЛЬНИК ──
    // ────────────────────────────────────────────────────────────────

    let countdownInterval = null;

    // Завантажуємо поточний стан аларму
    chrome.runtime.sendMessage({ action: 'mra_get_alarm_status' }, (response) => {
        if (chrome.runtime.lastError || !response) return;

        if (response.scheduledTime) {
            const parts = response.scheduledTime.split(':');
            if (parts.length === 2) {
                inpHH.value = parts[0];
                inpMM.value = parts[1];
            }
        }

        if (response.scheduleEnabled && response.alarm) {
            if (response.actionType) {
                currentActionType = response.actionType;
                if (currentActionType === 'end') {
                    typeEnd.click(); // Update UI
                } else {
                    typeLaunch.click();
                }
            }
            setUIScheduled(response.scheduledTime, response.alarm.scheduledTime);
        } else {
            // Завжди скидаємо на "Запуск", якщо таймер зараз неактивний
            currentActionType = 'launch';
            typeLaunch.click();
            setUIIdle();
        }
    });

    // Натиснули "Запланувати"
    btnSchedule.addEventListener('click', () => {
        // Форматуємо значення якщо користувач не клікнув поза полем
        inpHH.dispatchEvent(new Event('blur'));
        inpMM.dispatchEvent(new Event('blur'));
        
        const timeStr = `${inpHH.value}:${inpMM.value}`;

        // Анімуємо кнопку
        btnSchedule.innerHTML = '<span style="opacity:0.7">Зберігаємо...</span>';
        btnSchedule.disabled = true;

        chrome.runtime.sendMessage({
            action: 'mra_set_alarm',
            timeStr,
            actionType: currentActionType,
            enabled: true
        }, (response) => {
            btnSchedule.disabled = false;
            btnSchedule.innerHTML = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Запланувати';

            if (chrome.runtime.lastError) {
                alert('Помилка: ' + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                setUIScheduled(timeStr, response.fireAt);
            }
        });
    });

    // Натиснули "Скасувати"
    btnCancel.addEventListener('click', () => {
        chrome.runtime.sendMessage({
            action: 'mra_set_alarm',
            enabled: false
        }, () => {
            setUIIdle();
        });
    });

    // ── UI: стан "активний розклад" ──
    function setUIScheduled(timeStr, fireAtISO) {
        statusDot.classList.add('active');
        statusText.classList.add('active');
        
        let actionWord = currentActionType === 'end' ? 'Зупинка' : 'Запуск';
        statusText.textContent = `${actionWord} о ${timeStr}`;
        statusText.style.color = currentActionType === 'end' ? '#ff6b6b' : '#10B981';
        statusDot.style.background = currentActionType === 'end' ? '#ff6b6b' : '#10B981';
        statusDot.style.boxShadow = currentActionType === 'end' ? '0 0 8px rgba(255, 107, 107, 0.6)' : '0 0 8px rgba(16, 185, 129, 0.6)';
        
        btnSchedule.style.display = 'none';
        btnCancel.style.display = 'flex';
        
        // Візуально контримо поля вводу (щоб не відволікали увагу)
        timePickerUI.style.opacity = '0.5';
        timePickerUI.style.pointerEvents = 'none';
        actionTypeUI.style.opacity = '0.5';
        actionTypeUI.style.pointerEvents = 'none';

        clearAllIntervals();
        updateCountdown(fireAtISO);
        // Оновлюємо кожну секунду щоб відлік був "живим"
        countdownInterval = setInterval(() => updateCountdown(fireAtISO), 1000);
    }

    // ── Очищення всіх інтервалів ──
    function clearAllIntervals() {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    }

    // ── UI: стан "вимкнено" ──
    function setUIIdle() {
        statusDot.classList.remove('active');
        statusText.classList.remove('active');
        statusText.textContent = 'Вимкнено';
        statusText.style.color = '';
        statusDot.style.background = '';
        statusDot.style.boxShadow = '';
        countdownText.textContent = '';
        
        btnSchedule.style.display = 'flex';
        btnCancel.style.display = 'none';
        
        timePickerUI.style.opacity = '1';
        timePickerUI.style.pointerEvents = 'auto';
        actionTypeUI.style.opacity = '1';
        actionTypeUI.style.pointerEvents = 'auto';

        clearAllIntervals();
    }

    // ── Відлік до запуску ──
    function updateCountdown(fireAtISO) {
        if (!fireAtISO) return;
        const diff = new Date(fireAtISO) - new Date();

        if (diff <= 0) {
            countdownText.innerHTML = currentActionType === 'end' ? '⚡ Зараз зупиняється...' : '⚡ Зараз запускається...';
            return;
        }

        const totalSec = Math.floor(diff / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;

        if (totalSec < 60) {
            // Менше хвилини
            countdownText.innerHTML = `Залишилось: <b>${s} сек</b>`;
        } else if (totalSec < 3600) {
            // Менше години
            countdownText.innerHTML = `${currentActionType === 'end' ? 'До зупинки' : 'До запуску'}: <b>${m} хв ${s} сек</b>`;
        } else {
            // Більше години
            countdownText.innerHTML = `${currentActionType === 'end' ? 'До зупинки' : 'До запуску'}: <b>${h}год ${m} хв ${s} сек</b>`;
        }
    }
});
