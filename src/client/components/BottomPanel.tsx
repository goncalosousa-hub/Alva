import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Severity } from "../../shared/types";
import { allProblems, reveal } from "../ide";
import { setState, useStore } from "../store";

const SEVERITY_ICON: Record<Severity, typeof Info> = { error: AlertCircle, warning: AlertTriangle, info: Info };
const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function Problems() {
  const tabs = useStore((s) => s.tabs);
  const problems = allProblems(tabs).sort(
    (a, b) =>
      a.tab.ref.name.localeCompare(b.tab.ref.name) ||
      ORDER[a.diagnostic.severity] - ORDER[b.diagnostic.severity] ||
      a.diagnostic.line - b.diagnostic.line,
  );
  if (!problems.length) return <div className="panel-empty">Sem problemas nos objetos abertos.</div>;
  return (
    <ul className="problems" data-testid="problems">
      {problems.map(({ tab, diagnostic: d }, i) => {
        const Icon = SEVERITY_ICON[d.severity];
        return (
          <li key={`${tab.key}-${d.source}-${d.line}-${d.column}-${i}`}>
            <button
              type="button"
              className={`problem sev-${d.severity}`}
              onClick={() => {
                setState({ activeKey: tab.key });
                // Let the editor switch to the tab's model first.
                requestAnimationFrame(() => reveal(d.line, d.column));
              }}
            >
              <Icon size={14} className="problem-icon" />
              <span className="problem-text">{d.text}</span>
              <span className="problem-source">{d.source === "sap" ? "SAP" : `abaplint${d.code ? `(${d.code})` : ""}`}</span>
              <span className="problem-loc">
                {tab.ref.name}
                {tab.include && tab.include !== "main" ? ` (${tab.includes?.find((i) => i.kind === tab.include)?.label ?? tab.include})` : ""} [{d.line}, {d.column}]
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Output() {
  const log = useStore((s) => s.log);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [log.length]);
  if (!log.length) return <div className="panel-empty">Sem mensagens.</div>;
  return (
    <ul className="output">
      {log.map((l) => (
        <li key={l.id} className={`log-${l.level}`}>
          <time>{l.time.toLocaleTimeString()}</time> {l.text}
        </li>
      ))}
      <li ref={end} aria-hidden />
    </ul>
  );
}

export function BottomPanel() {
  const panelTab = useStore((s) => s.panelTab);
  const counts = useStore((s) => {
    let errors = 0;
    let warnings = 0;
    for (const t of s.tabs)
      for (const d of [...t.sapDiagnostics, ...t.localDiagnostics]) {
        if (d.severity === "error") errors++;
        else if (d.severity === "warning") warnings++;
      }
    return `${errors}/${warnings}`;
  });
  const [errors, warnings] = counts.split("/");
  return (
    <section className="panel" aria-label="Painel inferior">
      <div className="panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={panelTab === "problems"} className={panelTab === "problems" ? "active" : ""} onClick={() => setState({ panelTab: "problems" })}>
          Problemas
          {(errors !== "0" || warnings !== "0") && (
            <span className="badge">
              {errors !== "0" ? errors : warnings}
            </span>
          )}
        </button>
        <button type="button" role="tab" aria-selected={panelTab === "output"} className={panelTab === "output" ? "active" : ""} onClick={() => setState({ panelTab: "output" })}>
          Saída
        </button>
        <span className="spacer" />
        <button type="button" className="icon-button" title="Fechar painel (Ctrl+J)" onClick={() => setState({ panelVisible: false })}>
          <X size={14} />
        </button>
      </div>
      <div className="panel-body">{panelTab === "problems" ? <Problems /> : <Output />}</div>
    </section>
  );
}
