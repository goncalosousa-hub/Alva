import { Clock, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ObjectRef } from "../../shared/types";
import { api } from "../api";
import { openObject } from "../ide";
import { prefs } from "../prefs";
import { setState, systemKey, useStore } from "../store";
import { TypeIcon, typeLabel } from "./TypeIcon";

const FILTERS: { type: string; label: string }[] = [
  { type: "", label: "Todos" },
  { type: "CLAS", label: "Classes" },
  { type: "INTF", label: "Interfaces" },
  { type: "PROG", label: "Programas" },
  { type: "FUGR", label: "Funções" },
  { type: "DDLS", label: "CDS" },
  { type: "TABL", label: "Tabelas" },
  { type: "DEVC", label: "Pacotes" },
];

export function QuickOpen() {
  const session = useStore((s) => s.session)!;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<ObjectRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const recent = prefs.recent(systemKey(session)).filter((r) => !filter || r.type.startsWith(filter));

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await api.search(q, filter || undefined, controller.signal);
        setResults(found);
        setError(null);
        setSelected(0);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, filter]);

  const items = results ?? recent;

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function choose(ref: ObjectRef | undefined) {
    if (!ref) return;
    setState({ overlay: null });
    if (ref.type.startsWith("DEVC")) {
      setState({ sidebar: "explorer" });
      window.dispatchEvent(new CustomEvent("alva:addPackage", { detail: ref.name }));
      return;
    }
    void openObject(ref.uri);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[selected]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const i = FILTERS.findIndex((f) => f.type === filter);
      setFilter(FILTERS[(i + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length].type);
    }
  }

  return (
    <div className="palette" role="dialog" aria-label="Abrir objeto ABAP">
      <div className="palette-input">
        {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
        <input
          autoFocus
          placeholder="Nome do objeto: ZCL_*, Z*FLIGHT*, ZR_…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label="Pesquisar objetos"
        />
      </div>
      <div className="palette-filters" role="radiogroup" aria-label="Tipo de objeto">
        {FILTERS.map((f) => (
          <button key={f.type} type="button" role="radio" aria-checked={filter === f.type} className={filter === f.type ? "active" : ""} onClick={() => setFilter(f.type)}>
            {f.label}
          </button>
        ))}
        <span className="palette-hint">Tab muda o filtro</span>
      </div>
      {error && <div className="palette-error">{error}</div>}
      <ul className="palette-list" ref={listRef} role="listbox">
        {!results && recent.length > 0 && (
          <li className="palette-section">
            <Clock size={12} /> Recentes
          </li>
        )}
        {items.map((r, i) => (
          <li key={r.uri} role="option" aria-selected={i === selected}>
            <button type="button" className={`palette-item ${i === selected ? "selected" : ""}`} onMouseMove={() => setSelected(i)} onClick={() => choose(r)}>
              <TypeIcon type={r.type} />
              <span className="palette-name">{r.name}</span>
              <span className="palette-desc">{r.description}</span>
              <span className="palette-meta">
                {typeLabel(r.type)}
                {r.packageName ? ` · ${r.packageName}` : ""}
              </span>
            </button>
          </li>
        ))}
        {results && results.length === 0 && !loading && <li className="palette-empty">Nenhum objeto encontrado</li>}
        {!results && recent.length === 0 && <li className="palette-empty">Escreve parte do nome; * funciona como wildcard.</li>}
      </ul>
    </div>
  );
}
