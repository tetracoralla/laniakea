export type ColorTheme = "light" | "dark";
export const COLOR_THEME_KEY = "origin.color-theme";
const THEME_EVENT = "origin:color-theme";

export function getColorTheme(): ColorTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function readColorTheme(): ColorTheme {
  try {
    return localStorage.getItem(COLOR_THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.removeProperty("background-color");
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--canvas").trim();
  if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function setColorTheme(theme: ColorTheme) {
  try {
    localStorage.setItem(COLOR_THEME_KEY, theme);
  } catch {
    // A blocked preference store must not prevent changing this session's theme.
  }
  applyColorTheme(theme);
}

export function subscribeColorTheme(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

export function initializeColorTheme() {
  applyColorTheme(readColorTheme());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLOR_THEME_KEY && event.key !== null) return;
    try {
      if (event.storageArea !== localStorage) return;
    } catch {
      return;
    }
    applyColorTheme(readColorTheme());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
