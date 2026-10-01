import { Circle, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { currentTheme } from "../commands";
import { closeTab, getEditor, openObject, reveal, setEditor, takePendingReveal } from "../ide";
import { getModel, monaco } from "../monaco";
import { setState, useStore, type Tab } from "../store";
import { TypeIcon } from "./TypeIcon";

const INCLUDE_SHORT: Record<string, string> = {
  definitions: "tipos locais (def.)",
  implementations: "tipos locais (impl.)",
  macros: "macros",
  testclasses: "testes",
};

/** Eclipse-style switcher between the includes of a class (global class, local types, test classes...). */
function IncludeBar({ tab }: { tab: Tab }) {
  const tabs = useStore((s) => s.tabs);
  if (!tab.includes || tab.includes.length < 2) return null;
  return (
    <div className="include-bar" role="tablist" aria-label="Includes da classe">
      {tab.includes.map((inc) => {
        const open = tabs.find((t) => t.key === inc.uri);
        return (
          <button
            key={inc.kind}
            type="button"
            role="tab"
            aria-selected={inc.uri === tab.key}
            className={`${inc.uri === tab.key ? "active" : ""} ${open?.dirty ? "dirty" : ""}`}
            onClick={() => void openObject(inc.uri)}
          >
            {inc.label}
          </button>
        );
      })}
    </div>
  );
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const errors = [...tab.sapDiagnostics, ...tab.localDiagnostics].filter((d) => d.severity === "error").length;
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab ${active ? "active" : ""} ${errors ? "has-errors" : ""}`}
      title={`${tab.ref.name} — ${tab.ref.description ?? ""}${tab.version === "inactive" ? " (inativo)" : ""}`}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.key);
        }
      }}
      onClick={() => setState({ activeKey: tab.key })}
    >
      <TypeIcon type={tab.ref.type} size={14} />
      <span className={`tab-name ${tab.version === "inactive" ? "inactive" : ""}`}>{tab.ref.name}</span>
      {tab.include && tab.include !== "main" && <span className="tab-include">{INCLUDE_SHORT[tab.include] ?? tab.include}</span>}
      {tab.busy ? (
        <Loader2 size={13} className="spin tab-state" aria-label={tab.busy} />
      ) : (
        <button
          type="button"
          className={`tab-close ${tab.dirty ? "dirty" : ""}`}
          title={tab.dirty ? "Alterações por gravar (Alt+W fecha)" : "Fechar (Alt+W)"}
          aria-label={`Fechar ${tab.ref.name}`}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.key);
          }}
        >
          {tab.dirty ? <Circle size={9} fill="currentColor" className="dirty-dot" /> : null}
          <X size={13} className="close-x" />
        </button>
      )}
    </div>
  );
}

function EditorHost() {
  const container = useRef<HTMLDivElement>(null);
  const activeKey = useStore((s) => s.activeKey);
  const settings = useStore((s) => s.settings);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const editor = monaco.editor.create(container.current!, {
      model: null,
      automaticLayout: true,
      theme: currentTheme() === "dark" ? "alva-dark" : "alva-light",
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace",
      fontLigatures: true,
      fontSize: settings.fontSize,
      minimap: { enabled: settings.minimap },
      stickyScroll: { enabled: true },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: false, indentation: true },
      scrollBeyondLastLine: false,
      padding: { top: 6 },
      tabSize: 2,
      insertSpaces: true,
      wordBasedSuggestions: "off",
      quickSuggestions: { other: false, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      definitionLinkOpensInPeek: false,
      fixedOverflowWidgets: true,
    });
    setEditor(editor);
    const sub = editor.onDidChangeCursorPosition((e) => setState({ cursor: { line: e.position.lineNumber, column: e.position.column } }));
    return () => {
      sub.dispose();
      setEditor(null);
      editor.dispose();
    };
    // Created once; later option changes are applied by the effect below.
  }, []);

  useEffect(() => {
    getEditor()?.updateOptions({ fontSize: settings.fontSize, minimap: { enabled: settings.minimap } });
  }, [settings]);

  useEffect(() => {
    const editor = getEditor();
    if (!editor) return;
    if (shownKey.current && shownKey.current !== activeKey && editor.getModel()) {
      viewStates.current.set(shownKey.current, editor.saveViewState());
    }
    const model = activeKey ? getModel(activeKey) : null;
    if (editor.getModel() !== model) editor.setModel(model);
    shownKey.current = activeKey;
    if (!activeKey || !model) return;
    const state = viewStates.current.get(activeKey);
    if (state) editor.restoreViewState(state);
    const pending = takePendingReveal(activeKey);
    if (pending) reveal(pending.line, pending.column);
    else editor.focus();
    setState({ cursor: editor.getPosition() ? { line: editor.getPosition()!.lineNumber, column: editor.getPosition()!.column } : null });
  }, [activeKey]);

  return <div className="editor-host" ref={container} data-testid="editor" />;
}

function Welcome() {
  const session = useStore((s) => s.session);
  return (
    <div className="welcome">
      <h2>Alva</h2>
      <p>
        Ligado a <strong>{session?.systemId}</strong> como {session?.user}.
      </p>
      <dl className="welcome-keys">
        <dt>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>
        </dt>
        <dd>Abrir objeto ABAP</dd>
        <dt>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
        </dt>
        <dd>Todos os comandos</dd>
        <dt>
          <kbd>Ctrl</kbd>+<kbd>S</kbd> / <kbd>Ctrl</kbd>+<kbd>F3</kbd>
        </dt>
        <dd>Gravar / ativar</dd>
        <dt>
          <kbd>F3</kbd>
        </dt>
        <dd>Ir para a definição</dd>
        <dt>
          <kbd>Ctrl</kbd>+<kbd>K</kbd>
        </dt>
        <dd>Todos os atalhos</dd>
      </dl>
    </div>
  );
}

export function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const activeKey = useStore((s) => s.activeKey);
  const tabsRef = useRef<HTMLDivElement>(null);
  const active = tabs.find((t) => t.key === activeKey);

  useEffect(() => {
    tabsRef.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  return (
    <div className="editor-area">
      {tabs.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Objetos abertos" ref={tabsRef}>
          {tabs.map((t) => (
            <TabButton key={t.key} tab={t} active={t.key === activeKey} />
          ))}
        </div>
      )}
      {active && <IncludeBar tab={active} />}
      <div className="editor-stack">
        <EditorHost />
        {tabs.length === 0 && <Welcome />}
      </div>
    </div>
  );
}
