import * as ide from "./ide";
import { activeTab, getState, setState, updateSettings } from "./store";

export interface Command {
  id: string;
  title: string;
  /** Display form, e.g. "Ctrl+Shift+A" */
  shortcut?: string;
  /** Extra shortcuts that trigger the command but are not displayed. */
  aliases?: string[];
  /** Only offered when this returns true. */
  enabled?: () => boolean;
  run: () => void;
}

const hasTab = () => !!activeTab();
const hasAbapTab = () => activeTab()?.language === "abap";
const withTab = (fn: (key: string) => void) => () => {
  const tab = activeTab();
  if (tab) fn(tab.key);
};

export const COMMANDS: Command[] = [
  { id: "quickOpen", title: "Abrir objeto ABAP…", shortcut: "Ctrl+Shift+A", aliases: ["Ctrl+P"], run: () => setState({ overlay: { kind: "quickOpen" } }) },
  { id: "commands", title: "Mostrar todos os comandos", shortcut: "Ctrl+Shift+P", aliases: ["F1"], run: () => setState({ overlay: { kind: "commands" } }) },
  { id: "save", title: "Gravar", shortcut: "Ctrl+S", enabled: hasTab, run: withTab((k) => void ide.save(k)) },
  { id: "saveAll", title: "Gravar tudo", shortcut: "Ctrl+Shift+S", run: () => void ide.saveAll() },
  { id: "activate", title: "Ativar", shortcut: "Ctrl+F3", enabled: hasTab, run: withTab((k) => void ide.activate(k)) },
  { id: "check", title: "Verificar sintaxe (sistema SAP)", shortcut: "Ctrl+F2", enabled: hasAbapTab, run: withTab((k) => void ide.check(k)) },
  { id: "format", title: "Formatar código (Pretty Printer)", shortcut: "Shift+F1", enabled: hasAbapTab, run: withTab((k) => void ide.format(k)) },
  { id: "definition", title: "Ir para a definição", shortcut: "F3", enabled: hasAbapTab, run: () => ide.goToDefinition() },
  { id: "symbol", title: "Ir para símbolo no objeto…", shortcut: "Ctrl+O", aliases: ["Ctrl+Shift+O"], enabled: hasAbapTab, run: () => ide.getEditor() && (ide.getEditor()!.focus(), ide.getEditor()!.trigger("alva", "editor.action.quickOutline", {})) },
  { id: "gotoLine", title: "Ir para a linha…", shortcut: "Ctrl+L", enabled: hasTab, run: () => ide.getEditor() && (ide.getEditor()!.focus(), ide.getEditor()!.trigger("alva", "editor.action.gotoLine", {})) },
  { id: "reload", title: "Recarregar objeto do sistema", enabled: hasTab, run: withTab((k) => void ide.reloadTab(k)) },
  { id: "close", title: "Fechar separador", shortcut: "Alt+W", enabled: hasTab, run: withTab((k) => ide.closeTab(k)) },
  { id: "closeAll", title: "Fechar todos os separadores", shortcut: "Alt+Shift+W", enabled: hasTab, run: () => ide.closeAllTabs() },
  { id: "nextTab", title: "Separador seguinte", shortcut: "Alt+PageDown", enabled: hasTab, run: () => cycleTab(1) },
  { id: "prevTab", title: "Separador anterior", shortcut: "Alt+PageUp", enabled: hasTab, run: () => cycleTab(-1) },
  { id: "explorer", title: "Mostrar/ocultar explorador de pacotes", shortcut: "Ctrl+B", run: () => toggleSidebar("explorer") },
  { id: "inactive", title: "Mostrar objetos inativos", shortcut: "Ctrl+Shift+F3", run: () => toggleSidebar("inactive") },
  { id: "outline", title: "Mostrar/ocultar outline", shortcut: "Ctrl+Shift+U", run: () => setState((s) => ({ outlineVisible: !s.outlineVisible })) },
  { id: "problems", title: "Mostrar/ocultar problemas", shortcut: "Ctrl+J", run: () => setState((s) => ({ panelVisible: !s.panelVisible })) },
  { id: "theme", title: "Alternar tema claro/escuro", run: () => updateSettings({ theme: currentTheme() === "dark" ? "light" : "dark" }) },
  { id: "settings", title: "Preferências…", shortcut: "Ctrl+,", run: () => setState({ overlay: { kind: "settings" } }) },
  { id: "shortcuts", title: "Atalhos de teclado", shortcut: "Ctrl+K", run: () => setState({ overlay: { kind: "shortcuts" } }) },
  { id: "logout", title: "Terminar sessão", run: () => void ide.logout() },
];

export function currentTheme(): "dark" | "light" {
  const { theme } = getState().settings;
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function toggleSidebar(view: "explorer" | "inactive") {
  setState((s) => ({ sidebar: s.sidebar === view ? null : view }));
}

function cycleTab(direction: number) {
  const { tabs, activeKey } = getState();
  if (!tabs.length) return;
  const i = tabs.findIndex((t) => t.key === activeKey);
  setState({ activeKey: tabs[(i + direction + tabs.length) % tabs.length].key });
}

/** "Ctrl+Shift+A" for a keyboard event (Cmd counts as Ctrl on macOS). */
export function shortcutOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  else if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

const byShortcut = new Map<string, Command>();
for (const c of COMMANDS) {
  for (const s of [c.shortcut, ...(c.aliases ?? [])]) if (s) byShortcut.set(s, c);
}

/**
 * Global shortcuts, handled in the capture phase so they win over the browser and Monaco
 * (F3 is "find next" in both, Ctrl+S would save the page...).
 */
export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!getState().session) return;
    const command = byShortcut.get(shortcutOf(e));
    if (!command) return;
    // While a dialog is open, leave the keyboard to it (except the dialog toggles themselves).
    if (getState().overlay && !["quickOpen", "commands"].includes(command.id)) return;
    if (command.enabled && !command.enabled()) return;
    e.preventDefault();
    e.stopPropagation();
    command.run();
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
