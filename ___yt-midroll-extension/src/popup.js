document.addEventListener('DOMContentLoaded', () => {
    const autoOpenCb = document.getElementById('auto-open-cb');
    const inpHH = document.getElementById('inp-hh');
    const inpMM = document.getElementById('inp-mm');
    const btnSchedule = document.getElementById('btn-schedule');
    const btnCancel = document.getElementById('btn-cancel');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const countdownText = document.getElementById('countdown-text');
    const timePickerUI = document.getElementById('time-picker-ui');

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

    // ── Підрахунок відкритих трансляцій ──
    const streamsCountEl = document.getElementById('streams-count');
    if (streamsCountEl) {
        chrome.tabs.query({ url: 'https://studio.youtube.com/*' }, (tabs) => {
            const livestreamTabs = (tabs || []).filter(t =>
                t.url && t.url.includes('/livestreaming') && !t.url.includes('/livestreaming/manage')
            );
            const n = livestreamTabs.length;
            if (n === 0) {
                streamsCountEl.textContent = '⚠️ Жодної відкритої трансляції не знайдено';
                streamsCountEl.style.color = '#ff6b6b';
            } else {
                streamsCountEl.textContent = `📡 Знайдено ${n} ${n === 1 ? 'трансляцію' : n < 5 ? 'трансляції' : 'трансляцій'} для запуску`;
                streamsCountEl.style.color = '#10B981';
            }
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
            setUIScheduled(response.scheduledTime, response.alarm.scheduledTime);
        } else {
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
        statusText.textContent = `Запуск о ${timeStr}`;
        
        btnSchedule.style.display = 'none';
        btnCancel.style.display = 'flex';
        
        // Візуально контримо поля вводу (щоб не відволікали увагу)
        timePickerUI.style.opacity = '0.5';
        timePickerUI.style.pointerEvents = 'none';

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
        countdownText.textContent = '';
        
        btnSchedule.style.display = 'flex';
        btnCancel.style.display = 'none';
        
        timePickerUI.style.opacity = '1';
        timePickerUI.style.pointerEvents = 'auto';

        clearAllIntervals();
    }

    // ── Відлік до запуску ──
    function updateCountdown(fireAtISO) {
        if (!fireAtISO) return;
        const diff = new Date(fireAtISO) - new Date();

        if (diff <= 0) {
            countdownText.innerHTML = '⚡ Зараз запускається...';
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
            countdownText.innerHTML = `До запуску: <b>${m} хв ${s} сек</b>`;
        } else {
            // Більше години
            countdownText.innerHTML = `До запуску: <b>${h}год ${m} хв ${s} сек</b>`;
        }
    }
});
