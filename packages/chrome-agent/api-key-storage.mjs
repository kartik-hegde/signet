const LOCAL_KEY = "signetAgentSavedKey";
const SESSION_KEY = "signetAgentKey";

export async function loadApiKey(storage = chrome.storage) {
  const [local, session] = await Promise.all([
    storage.local.get(LOCAL_KEY),
    storage.session.get(SESSION_KEY),
  ]);
  return {
    apiKey: session[SESSION_KEY] ?? local[LOCAL_KEY] ?? "",
    remembered: typeof local[LOCAL_KEY] === "string" && local[LOCAL_KEY] !== "",
  };
}

export async function saveApiKey(
  apiKey,
  { remember = false, storage = chrome.storage } = {},
) {
  await storage.session.set({ [SESSION_KEY]: apiKey });
  if (remember && apiKey) {
    await storage.local.set({ [LOCAL_KEY]: apiKey });
    return { remembered: true };
  }
  await storage.local.remove(LOCAL_KEY);
  return { remembered: false };
}
