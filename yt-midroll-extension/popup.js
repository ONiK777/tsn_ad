document.addEventListener('DOMContentLoaded', () => {
    const autoOpenCb = document.getElementById('auto-open-cb');
    const forceOpenBtn = document.getElementById('force-open-btn');

    // Set version from manifest automatically
    const versionEl = document.getElementById('extension-version');
    if (versionEl) {
        versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    // Load the current autoOpenPanel setting from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'mra_get_settings' }, (response) => {
                if (chrome.runtime.lastError) {
                    return; // Ignore error when content script is not loaded
                }
                if (response && response.autoOpenPanel !== undefined) {
                    autoOpenCb.checked = response.autoOpenPanel;
                }
            });
        }
    });

    // Save the setting when checkbox is toggled by sending to active tab
    autoOpenCb.addEventListener('change', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'mra_set_setting',
                    key: 'autoOpenPanel',
                    value: autoOpenCb.checked
                }, (response) => {
                    if (chrome.runtime.lastError) return;
                });
            }
        });
    });

    // Force open the panel in the active YouTube Studio tab
    forceOpenBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'mra_force_open' }).catch(err => {
                    console.warn("Could not send message, content script may not be loaded.");
                });
                window.close(); // Automatically close the popup after clicking
            }
        });
    });
});
