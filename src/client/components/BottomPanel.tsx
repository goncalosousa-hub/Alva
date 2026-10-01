import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Severity } from "../../shared/types";
import { allProblems, openObject, reveal } from "../ide";
import { setState, useStore, type PanelTab } from "../store";

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

function goTo(uri: string | undefined, line: number | undefined) {
  if (uri) void openObject(uri, line ? { line, column: 1 } : undefined);
}

function Tests() {
  const results = useStore((s) => s.unitResults);
  if (!results) return <div className="panel-empty">Corre os testes ABAP Unit do objeto aberto com Ctrl+Shift+F10.</div>;
  const methods = results.classes.flatMap((c) => c.methods);
  const failed = (alerts: { kind: string }[]) => alerts.some((a) => a.kind !== "warning");
  const failures = methods.filter((m) => failed(m.alerts)).length;
  return (
    <div className="tests" data-testid="unit-results">
      <div className={`tests-summary ${failures ? "failed" : "passed"}`}>
        {failures ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        {results.objectName}: {methods.length - failures} de {methods.length} teste(s) passaram
        <time>{results.at.toLocaleTimeString()}</time>
      </div>
      <ul>
        {results.classes.map((c) => (
          <li key={c.name}>
            <button type="button" className="test-row class" onClick={() => goTo(c.uri, c.line)}>
              {failed(c.alerts) || c.methods.some((m) => failed(m.alerts)) ? <XCircle size={14} className="fail" /> : <CheckCircle2 size={14} className="pass" />}
              <span>{c.name}</span>
            </button>
            {c.alerts.map((a, i) => (
              <Alert key={i} alert={a} indent={1} />
            ))}
            <ul>
              {c.methods.map((m) => (
                <li key={m.name}>
                  <button type="button" className="test-row method" onClick={() => goTo(m.uri, m.line)}>
                    {failed(m.alerts) ? <XCircle size={14} className="fail" /> : <CheckCircle2 size={14} className="pass" />}
                    <span>{m.name}</span>
                    <span className="test-time">{(m.time * 1000).toFixed(0)} ms</span>
                  </button>
                  {m.alerts.map((a, i) => (
                    <Alert key={i} alert={a} indent={2} />
                  ))}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Alert({ alert, indent }: { alert: { kind: string; title: string; details: string[]; uri?: string; line?: number }; indent: number }) {
  return (
    <button type="button" className={`test-alert kind-${alert.kind}`} style={{ paddingLeft: 16 + indent * 18 }} onClick={() => goTo(alert.uri, alert.line)}>
      <span className="test-alert-title">{alert.title}</span>
      {alert.details.map((d, i) => (
        <span key={i} className="test-alert-detail">
          {d}
        </span>
      ))}
    </button>
  );
}

function Console() {
  const runs = useStore((s) => s.consoleRuns);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [runs.length]);
  if (!runs.length) return <div className="panel-empty">F8 numa classe com IF_OO_ADT_CLASSRUN mostra aqui a saída.</div>;
  return (
    <div className="console" data-testid="console">
      {runs.map((r) => (
        <section key={r.id}>
          <header>
            {r.className} <time>{r.at.toLocaleTimeString()}</time>
          </header>
          <pre>{r.output || "(sem saída)"}</pre>
        </section>
      ))}
      <div ref={end} />
    </div>
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

const TABS: { id: PanelTab; label: string }[] = [
  { id: "problems", label: "Problemas" },
  { id: "tests", label: "Testes" },
  { id: "console", label: "Consola" },
  { id: "output", label: "Saída" },
];

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
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={panelTab === t.id} className={panelTab === t.id ? "active" : ""} onClick={() => setState({ panelTab: t.id })}>
            {t.label}
            {t.id === "problems" && (errors !== "0" || warnings !== "0") && <span className="badge">{errors !== "0" ? errors : warnings}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="icon-button" title="Fechar painel (Ctrl+J)" onClick={() => setState({ panelVisible: false })}>
          <X size={14} />
        </button>
      </div>
      <div className="panel-body">
        {panelTab === "problems" && <Problems />}
        {panelTab === "tests" && <Tests />}
        {panelTab === "console" && <Console />}
        {panelTab === "output" && <Output />}
      </div>
    </section>
  );
}
