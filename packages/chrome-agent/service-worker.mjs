void configureAction();

chrome.runtime.onInstalled.addListener(() => void configureAction());
chrome.runtime.onStartup.addListener(() => void configureAction());

chrome.action.onClicked.addListener((tab) => {
  const panelContext = tab.windowId
    ? { windowId: tab.windowId }
    : { tabId: tab.id };
  void chrome.sidePanel
    .open(panelContext)
    .then(() =>
      chrome.runtime.sendMessage({
        type: "signet:refresh-tools",
        tabId: tab.id,
      }),
    )
    .catch(() => undefined);
});

async function configureAction() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}
