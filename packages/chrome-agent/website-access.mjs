export const WEBSITE_ORIGINS = ["http://*/*", "https://*/*"];

export function hasWebsiteAccess(permissions = chrome.permissions) {
  return permissions.contains({ origins: WEBSITE_ORIGINS });
}

export function requestWebsiteAccess(permissions = chrome.permissions) {
  return permissions.request({ origins: WEBSITE_ORIGINS });
}
