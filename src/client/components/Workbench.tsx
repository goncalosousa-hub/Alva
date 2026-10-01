import { Command, FolderTree, Keyboard, ListTree, LogOut, Moon, PanelBottom, Search, Settings, Sun, Zap } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { currentTheme, installShortcuts } from "../commands";
import { logout } from "../ide";
import { prefs } from "../prefs";
import { setState, updateSettings, useStore, type SidebarView } from "../store";
import { BottomPanel } from "./BottomPanel";
import { Overlays } from "./Dialogs";
import { EditorArea } from "./EditorArea";
import { Explorer } from "./Explorer";
import { InactiveView } from "./InactiveView";
import { OutlinePanel } from "./OutlinePanel";
import { StatusBar } from "./StatusBar";
import { Toasts } from "./Toasts";

/** A drag handle that resizes a neighbouring pane. */
function Resizer({ axis, onDrag }: { axis: "x" | "y"; onDrag: (delta: number) => void }) {
  const last = useRef(0);
  function down(e: ReactPointerEvent) {
    e.preventDefault();
    last.current = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const pos = axis === "x" ? ev.clientX : ev.clientY;
      onDrag(pos - last.current);
      last.current = pos;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("resizing");
  }
  return <div className={`resizer resizer-${axis}`} onPointerDown={down} role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} />;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function Workbench() {
  const session = useStore((s) => s.session)!;
  const sidebar = useStore((s) => s.sidebar);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const panelVisible = useStore((s) => s.panelVisible);
  const inactiveCount = useStore((s) => s.tabs.filter((t) => t.version === "inactive").length);
  useStore((s) => s.settings.theme);
  const [layout, setLayout] = useState(prefs.layout);

  useEffect(() => installShortcuts(), []);
  useEffect(() => {
    const t = setTimeout(() => prefs.saveLayout(layout), 300);
    return () => clearTimeout(t);
  }, [layout]);

  // Losing unsaved work by closing the browser tab is the worst outcome; ask first.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().tabs.some((t) => t.dirty)) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const toggle = (view: SidebarView) => setState((s) => ({ sidebar: s.sidebar === view ? null : view }));
  const dark = currentTheme() === "dark";

  return (
    <div className="workbench">
      <header className="titlebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={18} height={18} />
          <span>Alva</span>
        </div>
        <button type="button" className="search-trigger" onClick={() => setState({ overlay: { kind: "quickOpen" } })} data-testid="open-object">
          <Search size={14} />
          <span>Abrir objeto ABAP…</span>
          <span className="keys">
            <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>A</kbd>
          </span>
        </button>
        <div className="titlebar-actions">
          {session.demo && <span className="demo-badge">Sistema demo</span>}
          <button type="button" className="icon-button" title="Comandos (Ctrl+Shift+P)" onClick={() => setState({ overlay: { kind: "commands" } })}>
            <Command size={15} />
          </button>
          <button type="button" className="icon-button" title={dark ? "Tema claro" : "Tema escuro"} onClick={() => updateSettings({ theme: dark ? "light" : "dark" })}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="icon-button" title="Terminar sessão" onClick={() => void logout()}>
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <div className="main">
        <nav className="activitybar" aria-label="Vistas">
          <button type="button" className={sidebar === "explorer" ? "active" : ""} title="Pacotes (Ctrl+B)" onClick={() => toggle("explorer")}>
            <FolderTree size={20} />
          </button>
          <button type="button" className={sidebar === "inactive" ? "active" : ""} title="Objetos inativos (Ctrl+Shift+F3)" onClick={() => toggle("inactive")}>
            <Zap size={20} />
            {inactiveCount > 0 && <span className="activity-badge">{inactiveCount}</span>}
          </button>
          <span className="spacer" />
          <button type="button" className={outlineVisible ? "active" : ""} title="Outline (Ctrl+Shift+U)" onClick={() => setState((s) => ({ outlineVisible: !s.outlineVisible }))}>
            <ListTree size={20} />
          </button>
          <button type="button" className={panelVisible ? "active" : ""} title="Problemas e saída (Ctrl+J)" onClick={() => setState((s) => ({ panelVisible: !s.panelVisible }))}>
            <PanelBottom size={20} />
          </button>
          <button type="button" title="Atalhos (Ctrl+K)" onClick={() => setState({ overlay: { kind: "shortcuts" } })}>
            <Keyboard size={20} />
          </button>
          <button type="button" title="Preferências (Ctrl+,)" onClick={() => setState({ overlay: { kind: "settings" } })}>
            <Settings size={20} />
          </button>
        </nav>

        {sidebar && (
          <>
            <aside className="sidebar" style={{ width: layout.sidebar }}>
              {sidebar === "explorer" ? <Explorer /> : <InactiveView />}
            </aside>
            <Resizer axis="x" onDrag={(d) => setLayout((l) => ({ ...l, sidebar: clamp(l.sidebar + d, 180, 600) }))} />
          </>
        )}

        <div className="center">
          <EditorArea />
          {panelVisible && (
            <>
              <Resizer axis="y" onDrag={(d) => setLayout((l) => ({ ...l, panel: clamp(l.panel - d, 90, 600) }))} />
              <div className="panel-wrap" style={{ height: layout.panel }}>
                <BottomPanel />
              </div>
            </>
          )}
        </div>

        {outlineVisible && (
          <>
            <Resizer axis="x" onDrag={(d) => setLayout((l) => ({ ...l, outline: clamp(l.outline - d, 160, 500) }))} />
            <div className="outline-wrap" style={{ width: layout.outline }}>
              <OutlinePanel />
            </div>
          </>
        )}
      </div>

      <StatusBar />
      <Overlays />
      <Toasts />
    </div>
  );
}
