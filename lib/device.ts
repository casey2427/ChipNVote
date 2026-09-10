const DEVICE_TOKEN_KEY = "chipnvote:device-token";
const DISPLAY_NAME_KEY = "chipnvote:display-name";

export function getDeviceToken() {
  const existing = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing && existing.length >= 32) return existing;

  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  return token;
}


export function getRememberedDisplayName() {
  try {
    return window.localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberDisplayName(name: string) {
  const cleanName = name.trim();
  if (!cleanName) return;

  try {
    window.localStorage.setItem(DISPLAY_NAME_KEY, cleanName);
  } catch {
    // Ignore browsers that block localStorage.
  }
}
