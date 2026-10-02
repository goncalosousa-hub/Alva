import { AlertCircle, AlertTriangle, Database, GitBranch } from "lucide-react";
import { RELEASES } from "../../shared/releases";
import { setState, useStore } from "../store";
import { typeLabel } from "./TypeIcon";

export function StatusBar() {
  const session = useStore((s) => s.session)!;
  const profile = useStore((s) => s.profile);
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeKey));
  const cursor = useStore((s) => s.cursor);
  const release = useStore((s) => s.settings.release);
  const totals = useStore((s) => {
    let e = 0;
    let w = 0;
    for (const t of s.tabs)
      for (const d of [...t.sapDiagnostics, ...t.localDiagnostics]) {
        if (d.severity === "error") e++;
        else if (d.severity === "warning") w++;
      }
    return [e, w].join(",");
  });
  const [errors, warnings] = totals.split(",").map(Number);
  const busyLabel = { saving: "A gravar…", activating: "A ativar…", checking: "A verificar…", formatting: "A formatar…", running: "A executar…", testing: "A correr testes…" } as const;

  return (
    <footer className="statusbar">
      <span className={`status-system ${session.demo ? "demo" : `env-${(profile?.environment ?? "OUTRO").toLowerCase()}`}`} title={session.url}>
        <Database size={12} /> {profile?.environment && profile.environment !== "OUTRO" ? `${profile.environment} · ` : ""}
        {profile?.name ?? session.systemId}
        {session.client && ` · ${session.client}`} · {session.user}
      </span>
      <button type="button" className="status-item" onClick={() => setState((s) => ({ panelVisible: !s.panelVisible, panelTab: "problems" }))} title="Problemas (Ctrl+J)">
        <AlertCircle size={12} /> {errors} <AlertTriangle size={12} /> {warnings}
      </button>
      {tab?.busy && <span className="status-item busy">{busyLabel[tab.busy]}</span>}
      <span className="spacer" />
      {tab && (
        <>
          {tab.transport && (
            <span className="status-item" title="Ordem de transporte">
              <GitBranch size={12} /> {tab.transport}
            </span>
          )}
          <span className="status-item">{typeLabel(tab.ref.type)}</span>
          <span className={`status-item version-${tab.version}`}>{tab.version === "active" ? "Ativo" : "Inativo"}</span>
          {cursor && (
            <span className="status-item">
              Ln {cursor.line}, Col {cursor.column}
            </span>
          )}
          {tab.language === "abap" && (
            <button type="button" className="status-item" title="Versão ABAP usada na análise local" onClick={() => setState({ overlay: { kind: "settings" } })}>
              {RELEASES.find((r) => r.id === release)?.label.split(" / ")[0] ?? release}
            </button>
          )}
        </>
      )}
    </footer>
  );
}
