import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { TreeNode } from "../../shared/types";
import { api } from "../api";
import { openObject } from "../ide";
import { prefs } from "../prefs";
import { systemKey, useStore } from "../store";
import { TypeIcon } from "./TypeIcon";

interface Loaded {
  nodes?: TreeNode[];
  error?: string;
  loading?: boolean;
}

function PackageNode({ name, description, depth, onRemove, refreshToken }: { name: string; description?: string; depth: number; onRemove?: () => void; refreshToken: number }) {
  const [open, setOpen] = useState(depth === 0);
  const [state, setLoaded] = useState<Loaded>({});

  const load = useCallback(async () => {
    setLoaded((s) => ({ ...s, loading: true, error: undefined }));
    try {
      setLoaded({ nodes: await api.packageContents(name) });
    } catch (e) {
      setLoaded({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [name]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshToken]);

  const packages = state.nodes?.filter((n) => n.type.startsWith("DEVC")) ?? [];
  const objects = state.nodes?.filter((n) => !n.type.startsWith("DEVC")) ?? [];
  const groups = new Map<string, TreeNode[]>();
  for (const o of objects) {
    const g = o.category ?? o.type;
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }

  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: 6 + depth * 14 }} title={description}>
        <button type="button" className="tree-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Fechar" : "Abrir"} ${name}`}>
          {state.loading ? <Loader2 size={14} className="spin" /> : open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <TypeIcon type="DEVC/K" size={15} />
          <span className="tree-name">{name}</span>
          {description && <span className="tree-desc">{description}</span>}
        </button>
        {onRemove && (
          <button type="button" className="icon-button tree-action" title="Remover dos favoritos" onClick={onRemove}>
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <ul>
          {state.error && (
            <li className="tree-error" style={{ paddingLeft: 26 + depth * 14 }}>
              {state.error}
            </li>
          )}
          {packages.map((p) => (
            <PackageNode key={p.uri} name={p.name} description={p.description} depth={depth + 1} refreshToken={refreshToken} />
          ))}
          {[...groups.entries()].map(([group, nodes]) => (
            <ObjectGroup key={group} label={group} nodes={nodes} depth={depth + 1} />
          ))}
          {state.nodes && state.nodes.length === 0 && (
            <li className="tree-empty" style={{ paddingLeft: 26 + depth * 14 }}>
              Pacote vazio
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ObjectGroup({ label, nodes, depth }: { label: string; nodes: TreeNode[]; depth: number }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: 6 + depth * 14 }}>
        <button type="button" className="tree-toggle group" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="tree-group">{label}</span>
          <span className="tree-count">{nodes.length}</span>
        </button>
      </div>
      {open && (
        <ul>
          {nodes.map((n) => (
            <li key={n.uri}>
              <div className="tree-row leaf" style={{ paddingLeft: 26 + depth * 14 }} title={n.description}>
                <button type="button" className="tree-toggle" onClick={() => void openObject(n.uri)}>
                  <TypeIcon type={n.type} size={15} />
                  <span className="tree-name">{n.name}</span>
                  {n.description && <span className="tree-desc">{n.description}</span>}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Explorer() {
  const session = useStore((s) => s.session)!;
  const key = systemKey(session);
  const [favorites, setFavorites] = useState(() => prefs.favorites(key, session.demo ? ["ZALVA_DEMO", "$ZALVA_LOCAL"] : []));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const name = (e as CustomEvent<string>).detail.toUpperCase();
      setFavorites((f) => {
        const next = f.includes(name) ? f : [...f, name];
        prefs.saveFavorites(key, next);
        return next;
      });
    };
    window.addEventListener("alva:addPackage", onAdd);
    return () => window.removeEventListener("alva:addPackage", onAdd);
  }, [key]);

  function update(next: string[]) {
    setFavorites(next);
    prefs.saveFavorites(key, next);
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim().toUpperCase();
    if (name && !favorites.includes(name)) update([...favorites, name]);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="side-view">
      <div className="side-header">
        <span>Pacotes</span>
        <div className="side-actions">
          <button type="button" className="icon-button" title="Adicionar pacote" onClick={() => setAdding(true)}>
            <Plus size={15} />
          </button>
          <button type="button" className="icon-button" title="Atualizar" onClick={() => setRefreshToken((t) => t + 1)}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {adding && (
        <form className="side-form" onSubmit={add}>
          <input
            autoFocus
            placeholder="Nome do pacote, ex. ZFI_REPORTING"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !draft && setAdding(false)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
          />
        </form>
      )}
      <ul className="tree">
        {favorites.map((name) => (
          <PackageNode key={name} name={name} depth={0} refreshToken={refreshToken} onRemove={() => update(favorites.filter((f) => f !== name))} />
        ))}
      </ul>
      {favorites.length === 0 && !adding && (
        <div className="side-empty">
          <p>Adiciona os pacotes em que trabalhas para os teres sempre à mão.</p>
          <button type="button" className="ghost small" onClick={() => setAdding(true)}>
            <Plus size={14} /> Adicionar pacote
          </button>
          <p className="hint">
            Ou abre qualquer objeto com <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>.
          </p>
        </div>
      )}
    </div>
  );
}
