const DEVICE_TOKEN_KEY = "chipnvote:device-token";

export function getDeviceToken() {
  const existing = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing && existing.length >= 32) return existing;

  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  return token;
}
