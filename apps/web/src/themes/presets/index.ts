import type { ThemePreset } from "../types";
import { defaultPreset } from "./default";
import { catppuccinMocha } from "./catppuccin-mocha";
import { catppuccinLatte } from "./catppuccin-latte";
import { nord } from "./nord";
import { dracula } from "./dracula";
import { oneDark } from "./one-dark";
import { solarizedDark } from "./solarized-dark";
import { flexokiLight, flexokiDark } from "./flexoki";

export { defaultPreset };

export const BUILT_IN_PRESETS: ThemePreset[] = [
  defaultPreset,
  catppuccinMocha,
  catppuccinLatte,
  nord,
  dracula,
  oneDark,
  solarizedDark,
  flexokiLight,
  flexokiDark,
];

export function findPreset(id: string): ThemePreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id);
}
