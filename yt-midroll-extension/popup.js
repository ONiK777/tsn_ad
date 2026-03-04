document.addEventListener('DOMContentLoaded', () => {
    const autoOpenCb = document.getElementById('auto-open-cb');
    const forceOpenBtn = document.getElementById('force-open-btn');

    // Load the current autoOpenPanel setting
    chrome.storage.local.get('mraSettings', (result) => {
        if (result && result.mraSettings && result.mraSettings.autoOpenPanel !== undefined) {
            autoOpenCb.checked = result.mraSettings.autoOpenPanel;
        } else {
            autoOpenCb.checked = true; // default value
        }
    });

    // Save the setting when checkbox is toggled
    autoOpenCb.addEventListener('change', () => {
        chrome.storage.local.get('mraSettings', (result) => {
            let data = (result && result.mraSettings) ? result.mraSettings : {};
            data.autoOpenPanel = autoOpenCb.checked;
            chrome.storage.local.set({ mraSettings: data });
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
