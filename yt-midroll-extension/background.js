chrome.action.onClicked.addListener((tab) => {
    // Send message to the active tab to toggle the panel
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "mra_toggle_panel" }).catch(err => {
            console.log("Could not send message to tab, script might not be injected yet.");
        });
    }
});
