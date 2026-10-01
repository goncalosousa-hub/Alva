/** Small per-browser preferences. Never holds passwords. */
import type { AbapRelease } from "../shared/releases";
import type { ObjectRef } from "../shared/types";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: preferences are a convenience only.
  }
}

export interface SystemProfile {
  id: string;
  name: string;
  url: string;
  client: string;
  user: string;
  language: string;
  allowSelfSigned: boolean;
}

export type ThemeChoice = "dark" | "light" | "system";

export interface Settings {
  theme: ThemeChoice;
  release: AbapRelease;
  fontSize: number;
  checkOnSave: boolean;
  minimap: boolean;
  liveLint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  release: "v758",
  fontSize: 14,
  checkOnSave: true,
  minimap: true,
  liveLint: true,
};

export const prefs = {
  systems: () => read<SystemProfile[]>("alva.systems", []),
  saveSystems: (systems: SystemProfile[]) => write("alva.systems", systems),
  settings: () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("alva.settings", {}) }),
  saveSettings: (s: Settings) => write("alva.settings", s),
  favorites: (systemKey: string, fallback: string[]) => read<string[]>(`alva.favorites.${systemKey}`, fallback),
  saveFavorites: (systemKey: string, packages: string[]) => write(`alva.favorites.${systemKey}`, packages),
  recent: (systemKey: string) => read<ObjectRef[]>(`alva.recent.${systemKey}`, []),
  saveRecent: (systemKey: string, refs: ObjectRef[]) => write(`alva.recent.${systemKey}`, refs.slice(0, 15)),
  layout: () => read<{ sidebar: number; outline: number; panel: number }>("alva.layout", { sidebar: 280, outline: 240, panel: 200 }),
  saveLayout: (l: { sidebar: number; outline: number; panel: number }) => write("alva.layout", l),
};
