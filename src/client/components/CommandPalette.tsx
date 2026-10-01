import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { COMMANDS, type Command } from "../commands";
import { setState } from "../store";
import { Keys } from "./Keys";

/** Subsequence match ("atv" matches "Ativar"), scored so word starts and contiguous runs rank first. */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    if (found === prev + 1) score += 3;
    if (found === 0 || /[\s/(-]/.test(t[found - 1])) score += 2;
    score -= Math.min(found - ti, 5) * 0.1;
    prev = found;
    ti = found + 1;
  }
  return score;
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = COMMANDS.filter((c) => c.id !== "commands" && (!c.enabled || c.enabled()))
    .map((c) => ({ c, score: fuzzyScore(c.title, query) }))
    .filter((x): x is { c: Command; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function run(c: Command | undefined) {
    if (!c) return;
    setState({ overlay: null });
    // After the palette closed, so focus can go back to the editor.
    requestAnimationFrame(() => c.run());
  }

  return (
    <div className="palette" role="dialog" aria-label="Comandos">
      <div className="palette-input">
        <ChevronRight size={16} />
        <input
          autoFocus
          placeholder="Escreve um comando…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, commands.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(commands[selected]);
            }
          }}
          aria-label="Comando"
        />
      </div>
      <ul className="palette-list" ref={listRef} role="listbox">
        {commands.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === selected}>
            <button type="button" className={`palette-item ${i === selected ? "selected" : ""}`} onMouseMove={() => setSelected(i)} onClick={() => run(c)}>
              <span className="palette-name plain">{c.title}</span>
              <span className="spacer" />
              {c.shortcut && <Keys shortcut={c.shortcut} />}
            </button>
          </li>
        ))}
        {commands.length === 0 && <li className="palette-empty">Nenhum comando</li>}
      </ul>
    </div>
  );
}
