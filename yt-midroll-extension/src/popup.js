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

    // ── Tabs ──
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetTab = document.getElementById('tab-' + btn.dataset.tab);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        });
    });

    // ── Notification settings ──
    const NOTIF_KEYS = [
        'notif-stream-live', 'notif-stream-ended', 'notif-command-sent',
        'notif-plan', 'notif-steps', 'notif-plan-done', 'notif-errors', 'notif-smart'
    ];
    const notifMasterCb = document.getElementById('notif-master-cb');
    const notifList = document.getElementById('notif-list');

    // Завантажити збережені налаштування
    chrome.storage.local.get('notifSettings', (data) => {
        const s = data.notifSettings || {};
        // Master toggle
        const masterOff = s._master === false;
        notifMasterCb.checked = !masterOff;
        if (masterOff) {
            notifList.style.opacity = '0.35';
            notifList.style.pointerEvents = 'none';
        } else {
            notifList.style.opacity = '1';
            notifList.style.pointerEvents = 'auto';
        }

        NOTIF_KEYS.forEach(key => {
            const cb = document.getElementById(key);
            if (cb) cb.checked = s[key] !== false; // default: true
        });
    });

    function saveNotifSettings() {
        const settings = { _master: notifMasterCb.checked };
        NOTIF_KEYS.forEach(key => {
            const cb = document.getElementById(key);
            if (cb) settings[key] = cb.checked;
        });
        chrome.storage.local.set({ notifSettings: settings });
    }

    notifMasterCb.addEventListener('change', () => {
        if (notifMasterCb.checked) {
            notifList.style.opacity = '1';
            notifList.style.pointerEvents = 'auto';
        } else {
            notifList.style.opacity = '0.35';
            notifList.style.pointerEvents = 'none';
        }
        saveNotifSettings();
    });

    NOTIF_KEYS.forEach(key => {
        const cb = document.getElementById(key);
        if (cb) cb.addEventListener('change', saveNotifSettings);
    });

    const timePickerUI = document.getElementById('time-picker-ui');
    const actionTypeUI = document.getElementById('action-type-ui');
    const typeLaunch = document.getElementById('type-launch');
    const typeEnd = document.getElementById('type-end');
    const hintAction = document.getElementById('hint-action');

    let currentActionType = 'launch'; // 'launch' | 'end'

    // Версія та Назва з маніфесту
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
        currentActionType = 'launch';
        typeLaunch.classList.add('active');
        typeEnd.classList.remove('active');
        if (hintAction) {
            hintAction.textContent = 'Почне ефір';
            hintAction.style.color = 'var(--cyber-cyan)';
        }
    });

    typeEnd.addEventListener('click', () => {
        currentActionType = 'end';
        typeEnd.classList.add('active');
        typeLaunch.classList.remove('active');
        if (hintAction) {
            hintAction.textContent = 'Завершить ефір';
            hintAction.style.color = 'var(--cyber-pink)';
        }
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
            const livestreamTabs = (tabs || []).filter(t =>
                t.url && t.url.includes('/video/') && t.url.includes('/livestreaming')
            );
            const n = livestreamTabs.length;
            if (n === 0) {
                streamsCountEl.textContent = '⚠️ Жодної відкритої трансляції не знайдено';
                streamsCountEl.style.color = '#ff6b6b';
                return;
            }

            if (!chrome.scripting) {
                streamsCountEl.textContent = `📡 Знайдено трансляцій: ${n}`;
                streamsCountEl.style.color = '#10B981';
                return;
            }

            // Перевіряємо стан кожної вкладки через executeScript
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
                    streamsCountEl.style.color = '';
                } else if (liveCount === 0) {
                    streamsCountEl.textContent = `📡 Знайдено трансляцій для запуску: ${n}`;
                    streamsCountEl.style.color = '#10B981';
                } else {
                    streamsCountEl.innerHTML = `📡 Трансляцій: ${n} (<span style="color:#ef4444; font-weight:bold;">LIVE: ${liveCount}</span>, нових: ${notLiveCount})`;
                    streamsCountEl.style.color = '#10B981';
                }
            }).catch(() => {
                streamsCountEl.textContent = `📡 Знайдено трансляцій: ${n}`;
                streamsCountEl.style.color = '#10B981';
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
            if (response.actionType === 'end') {
                typeEnd.click();
            } else {
                typeLaunch.click();
            }
            setUIScheduled(response.scheduledTime, response.alarm.scheduledTime);
        } else {
            typeLaunch.click();
            setUIIdle();
        }
    });

    // Натиснули "Запланувати"
    btnSchedule.addEventListener('click', () => {
        inpHH.dispatchEvent(new Event('blur'));
        inpMM.dispatchEvent(new Event('blur'));
        
        const timeStr = `${inpHH.value}:${inpMM.value}`;

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
        statusText.style.color = currentActionType === 'end' ? 'var(--cyber-pink)' : 'var(--cyber-cyan)';
        statusDot.style.background = currentActionType === 'end' ? 'var(--cyber-pink)' : 'var(--cyber-cyan)';
        statusDot.style.boxShadow = currentActionType === 'end' ? '0 0 10px var(--cyber-pink-glow)' : '0 0 10px var(--cyber-cyan-glow)';
        
        btnSchedule.style.display = 'none';
        btnCancel.style.display = 'flex';
        
        timePickerUI.style.opacity = '0.5';
        timePickerUI.style.pointerEvents = 'none';
        actionTypeUI.style.opacity = '0.5';
        actionTypeUI.style.pointerEvents = 'none';

        clearAllIntervals();
        updateCountdown(fireAtISO);
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
            countdownText.innerHTML = `Залишилось: <b>${s} сек</b>`;
        } else if (totalSec < 3600) {
            countdownText.innerHTML = `${currentActionType === 'end' ? 'До зупинки' : 'До запуску'}: <b>${m} хв ${s} сек</b>`;
        } else {
            countdownText.innerHTML = `${currentActionType === 'end' ? 'До зупинки' : 'До запуску'}: <b>${h}год ${m} хв ${s} сек</b>`;
        }
    }
    
    // ── TELEGRAM-МОНІТОРИНГ ──
    // Звіти йдуть автоматично через власний проксі (див. proxy/README.md),
    // токен живе лише на проксі — тому вкладку Telegram прибрано з UI.

    // ── Спеціальний функціонал для розтягування (Resize) Popup ──
    // ── Два фіксовані розміри вікна: більший (з нішею під 3D) і менший ──
    const SIZE_BIG = 660;
    const SIZE_SMALL = 460;
    const sizeToggle = document.getElementById('size-toggle');
    let sizeMode = localStorage.getItem('mraPopupSize') === 'small' ? 'small' : 'big';

    function applySize() {
        const cap = window.screen.availWidth - 40 || SIZE_BIG;
        const w = Math.min(sizeMode === 'small' ? SIZE_SMALL : SIZE_BIG, cap);
        document.body.style.width = w + 'px';
        // Клас пресету на body: 3D-фігура і сітка знають, який зараз розмір
        document.body.classList.toggle('size-small', sizeMode === 'small');
        document.body.classList.toggle('size-big', sizeMode !== 'small');
        if (sizeToggle) sizeToggle.textContent = sizeMode === 'small' ? 'Більше' : 'Менше';
    }
    applySize();

    if (sizeToggle) {
        sizeToggle.addEventListener('click', () => {
            sizeMode = sizeMode === 'small' ? 'big' : 'small';
            localStorage.setItem('mraPopupSize', sizeMode);
            applySize();
        });
    }

    // ── Changelog: автоматичний рендер з CHANGELOG.md ──
    renderChangelog();
});

// Назви місяців для відображення дати (індекс 0 = Січень)
const CL_MONTHS = [
    'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
];

// Максимум пунктів на версію (решта згортається)
const CL_MAX_ITEMS = 12;

/**
 * Визначає badge-мітку та CSS-клас за назвою поточної ### секції
 * @param {string} section — назва секції (рядок після ###)
 * @returns {{ label: string, badgeClass: string, itemHot: boolean }}
 */
function clBadgeForSection(section) {
    const s = section.toLowerCase();
    if (s.includes('критичн')) {
        return { label: '🔴 КРИТИЧНО', badgeClass: 'cl-hot', itemHot: true };
    }
    if (s.includes('найголовніш') || s.startsWith('🎯')) {
        return { label: '🎯 ГОЛОВНА', badgeClass: 'cl-hot', itemHot: true };
    }
    if (s.includes('виправ') || s.includes('🐛')) {
        return { label: 'ВИПРАВ', badgeClass: 'cl-fix', itemHot: false };
    }
    if (s.includes('технічн') || s.includes('🔧')) {
        return { label: 'ТЕХ', badgeClass: 'cl-imp', itemHot: false };
    }
    if (s.includes('додатков') || s.includes('⚠️')) {
        return { label: 'ПОКРАЩ', badgeClass: 'cl-imp', itemHot: false };
    }
    if (s.includes('faq') || s.includes('📚') || s.includes('ux')) {
        return { label: 'UX', badgeClass: 'cl-ux', itemHot: false };
    }
    return { label: 'НОВЕ', badgeClass: 'cl-new', itemHot: false };
}

/**
 * Очищує текст bullet-рядка від markdown-розмітки:
 * - знімає ведучий ✅ і пробіл
 * - розгортає **жирний** → звичайний текст
 * - прибирає зворотні апострофи
 * - [текст](url) → лише текст
 * - стискає зайві пробіли
 * @param {string} raw
 * @returns {string}
 */
function clCleanBullet(raw) {
    let t = raw.replace(/^[-*]\s*/, '');           // знімаємо маркер списку
    t = t.replace(/^✅\s*/, '');                    // знімаємо ✅ на початку
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // [text](url) → text
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');        // **bold** → text
    t = t.replace(/`([^`]+)`/g, '$1');              // `code` → text
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

/**
 * Парсить CHANGELOG.md і повертає масив об'єктів версій
 * @param {string} md — вміст CHANGELOG.md
 * @returns {Array<{ version: string, date: string, items: Array<{ text: string, label: string, badgeClass: string, itemHot: boolean }> }>}
 */
function clParseMd(md) {
    const VERSION_RE = /^## \[(\d+[^\]]*)\]\s*[—-]\s*(\d{4})-(\d{2})-(\d{2})/;
    const SECTION_RE = /^### (.+)/;

    const lines = md.split(/\r?\n/);
    const versions = [];
    let cur = null;         // поточна версія
    let section = '';       // поточний ### заголовок

    for (const line of lines) {
        // Нова версія
        const vm = line.match(VERSION_RE);
        if (vm) {
            cur = { version: vm[1], year: vm[2], month: parseInt(vm[3], 10), items: [] };
            versions.push(cur);
            section = '';
            continue;
        }

        // Не-версійний ## заголовок («Як оновитись» тощо) — закриває поточну версію,
        // інакше його пункти протечуть у попередню картку
        if (/^## /.test(line)) {
            cur = null;
            section = '';
            continue;
        }

        // Секція ### (лише якщо всередині версії)
        if (cur) {
            const sm = line.match(SECTION_RE);
            if (sm) {
                section = sm[1].trim();
                continue;
            }
        }

        // Bullet-рядок
        if (cur && /^\s*- /.test(line)) {
            const text = clCleanBullet(line.trim());
            if (!text) continue;
            const badge = clBadgeForSection(section);
            cur.items.push({ text, ...badge });
            continue;
        }
    }

    return versions;
}

/**
 * Будує DOM-картку однієї версії
 * @param {{ version: string, year: string, month: number, items: Array }} v
 * @param {string} currentVer — версія з manifest (для мітки «Поточна»)
 * @returns {HTMLElement}
 */
function clBuildCard(v, currentVer) {
    const isCurrent = v.version === currentVer;

    const card = document.createElement('div');
    card.className = 'cl-version' + (isCurrent ? ' cl-current' : '');

    // Заголовок картки
    const header = document.createElement('div');
    header.className = 'cl-version-header';

    const verNum = document.createElement('span');
    verNum.className = 'cl-ver-num';
    verNum.textContent = 'v' + v.version;

    const tag = document.createElement('span');
    tag.className = 'cl-tag ' + (isCurrent ? 'cl-tag-current' : 'cl-tag-stable');
    tag.textContent = isCurrent ? 'Поточна' : 'Стабільна';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'cl-ver-date';
    dateSpan.textContent = CL_MONTHS[v.month - 1] + ' ' + v.year;

    header.appendChild(verNum);
    header.appendChild(tag);
    header.appendChild(dateSpan);
    card.appendChild(header);

    // Пункти
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'cl-items';

    const visibleItems = v.items.slice(0, CL_MAX_ITEMS);
    const hiddenCount = v.items.length - visibleItems.length;

    for (const item of visibleItems) {
        const row = document.createElement('div');
        row.className = 'cl-item' + (item.itemHot ? ' cl-item-hot' : '');

        const badge = document.createElement('span');
        badge.className = 'cl-badge ' + item.badgeClass;
        badge.textContent = item.label;

        row.appendChild(badge);
        row.appendChild(document.createTextNode(item.text));
        itemsWrap.appendChild(row);
    }

    // «…і ще N змін» якщо пунктів більше за CL_MAX_ITEMS
    if (hiddenCount > 0) {
        const more = document.createElement('div');
        more.className = 'cl-item';
        more.style.color = 'var(--text-muted)';
        more.textContent = '…і ще ' + hiddenCount + ' змін';
        itemsWrap.appendChild(more);
    }

    card.appendChild(itemsWrap);
    return card;
}

/**
 * Завантажує CHANGELOG.md і рендерить картки версій у #tab-changelog.
 * Запускається один раз при відкритті popup.
 */
async function renderChangelog() {
    const container = document.getElementById('tab-changelog');
    const loader = document.getElementById('cl-loading');
    if (!container) return;

    let md;
    try {
        const resp = await fetch(chrome.runtime.getURL('CHANGELOG.md'));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        md = await resp.text();
    } catch (err) {
        if (loader) loader.textContent = 'Не вдалося завантажити CHANGELOG 😕';
        return;
    }

    const versions = clParseMd(md);
    const currentVer = chrome.runtime.getManifest().version;

    // Видаляємо заглушку-лоадер
    if (loader) loader.remove();

    // Додаємо картки (CHANGELOG.md вже впорядкований від нового до старого)
    for (const v of versions) {
        container.appendChild(clBuildCard(v, currentVer));
    }
}
