import { RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ObjectRef } from "../../shared/types";
import { api } from "../api";
import { activateRefs, openObject } from "../ide";
import { useStore } from "../store";
import { TypeIcon } from "./TypeIcon";

export function InactiveView() {
  const repositoryVersion = useStore((s) => s.repositoryVersion);
  const [objects, setObjects] = useState<ObjectRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setObjects(await api.inactive());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, repositoryVersion]);

  async function activateAll() {
    if (!objects?.length) return;
    setBusy(true);
    await activateRefs(objects);
    setBusy(false);
  }

  return (
    <div className="side-view">
      <div className="side-header">
        <span>Objetos inativos</span>
        <div className="side-actions">
          <button type="button" className="icon-button" title="Ativar todos" onClick={activateAll} disabled={busy || !objects?.length}>
            <Zap size={14} />
          </button>
          <button type="button" className="icon-button" title="Atualizar" onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {error && <div className="tree-error">{error}</div>}
      <ul className="tree">
        {objects?.map((o) => (
          <li key={o.uri}>
            <div className="tree-row leaf" title={o.description}>
              <button type="button" className="tree-toggle" onClick={() => void openObject(o.uri)}>
                <TypeIcon type={o.type} size={15} />
                <span className="tree-name">{o.name}</span>
                {o.description && <span className="tree-desc">{o.description}</span>}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {objects?.length === 0 && (
        <div className="side-empty">
          <p>Sem objetos inativos. Tudo ativado.</p>
        </div>
      )}
      {!!objects?.length && (
        <div className="side-footer">
          <button type="button" className="primary small" onClick={activateAll} disabled={busy}>
            <Zap size={14} /> {busy ? "A ativar…" : `Ativar ${objects.length === 1 ? "objeto" : `${objects.length} objetos`}`}
          </button>
        </div>
      )}
    </div>
  );
}
