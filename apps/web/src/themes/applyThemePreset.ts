import { THEME_TOKEN_KEYS, type ThemePreset } from "./types";

export function applyThemePreset(preset: ThemePreset, mode: "light" | "dark"): void {
  const tokens = preset[mode];
  const root = document.documentElement;
  const isElectron = root.classList.contains("electron");

  for (const [key, value] of Object.entries(tokens)) {
    // Preserve Electron vibrancy: the html.electron rule in index.css sets
    // --sidebar: transparent for native macOS translucency. An inline style
    // would have higher specificity and override it, so we skip that token.
    if (isElectron && key === "sidebar") continue;
    root.style.setProperty(`--${key}`, value);
  }
}

export function clearThemePreset(): void {
  const root = document.documentElement;
  for (const key of THEME_TOKEN_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
}
