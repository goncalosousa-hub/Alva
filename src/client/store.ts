import { create } from "zustand";
import type { OutlineItem } from "../shared/abaplint";
import type { ClassInclude, Diagnostic, ObjectRef, SessionInfo, TransportOption } from "../shared/types";
import { prefs, type Settings } from "./prefs";

export interface Tab {
  /** The source URI; also the Monaco model path. */
  key: string;
  ref: ObjectRef;
  sourceUri: string;
  language: "abap" | "cds" | "plaintext";
  version: "active" | "inactive";
  etag: string;
  /** For classes: which include this tab shows, and all includes of the class. */
  include?: string;
  includes?: ClassInclude[];
  /** Monaco alternative version id at the last load/save, to tell whether the tab is dirty. */
  savedVersionId: number;
  dirty: boolean;
  busy?: "saving" | "activating" | "checking" | "formatting";
  transport?: string;
  localDiagnostics: Diagnostic[];
  sapDiagnostics: Diagnostic[];
  outline: OutlineItem[];
}

export type Overlay =
  | { kind: "quickOpen" }
  | { kind: "commands" }
  | { kind: "settings" }
  | { kind: "shortcuts" }
  | { kind: "transport"; tabKey: string; transports: TransportOption[]; packageName?: string; then: "save" | "activate" }
  | { kind: "confirm"; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };

export interface LogEntry {
  id: number;
  time: Date;
  level: "info" | "success" | "warning" | "error";
  text: string;
}

export interface Toast {
  id: number;
  level: LogEntry["level"];
  text: string;
}

export type SidebarView = "explorer" | "inactive";

interface State {
  session: SessionInfo | null;
  tabs: Tab[];
  activeKey: string | null;
  sidebar: SidebarView | null;
  outlineVisible: boolean;
  panelVisible: boolean;
  panelTab: "problems" | "output";
  overlay: Overlay | null;
  log: LogEntry[];
  toasts: Toast[];
  settings: Settings;
  cursor: { line: number; column: number } | null;
  /** Bumped when objects were saved/activated, so views listing inactive objects refresh. */
  repositoryVersion: number;
}

export const useStore = create<State>(() => ({
  session: null,
  tabs: [],
  activeKey: null,
  sidebar: "explorer",
  outlineVisible: true,
  panelVisible: false,
  panelTab: "problems",
  overlay: null,
  log: [],
  toasts: [],
  settings: prefs.settings(),
  cursor: null,
  repositoryVersion: 0,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

export function activeTab(): Tab | undefined {
  const { tabs, activeKey } = getState();
  return tabs.find((t) => t.key === activeKey);
}

export function updateTab(key: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) {
  setState((s) => ({
    tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)),
  }));
}

let nextId = 1;

export function log(level: LogEntry["level"], text: string) {
  setState((s) => ({ log: [...s.log.slice(-499), { id: nextId++, time: new Date(), level, text }] }));
}

export function toast(level: Toast["level"], text: string, { logIt = true } = {}) {
  const id = nextId++;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, text }] }));
  if (logIt) log(level, text);
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === "error" ? 7000 : 3500);
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...getState().settings, ...patch };
  prefs.saveSettings(settings);
  setState({ settings });
}

export function systemKey(session: SessionInfo): string {
  return `${session.url}|${session.client}`.toLowerCase();
}
