import { Box, Braces, CircleDot, FunctionSquare, Hash, Puzzle, Type, Zap } from "lucide-react";
import type { OutlineItem } from "../../shared/abaplint";
import { reveal } from "../ide";
import { useStore } from "../store";

const ICONS: Record<OutlineItem["kind"], typeof Box> = {
  class: Box,
  interface: Puzzle,
  method: Braces,
  attribute: Hash,
  type: Type,
  form: FunctionSquare,
  function: FunctionSquare,
  module: FunctionSquare,
  event: Zap,
};

function contains(item: OutlineItem, line: number) {
  return line >= item.line && line <= item.endLine;
}

function Item({ item, depth, line }: { item: OutlineItem; depth: number; line: number | undefined }) {
  const Icon = ICONS[item.kind] ?? CircleDot;
  const current = line !== undefined && contains(item, line) && !item.children.some((c) => contains(c, line));
  return (
    <li>
      <button
        type="button"
        className={`outline-row kind-${item.kind} ${current ? "current" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => reveal(item.line)}
        title={`Linha ${item.line}`}
      >
        <Icon size={14} />
        <span className="outline-name">{item.name}</span>
        {item.detail && <span className="outline-detail">{item.detail}</span>}
      </button>
      {item.children.length > 0 && (
        <ul>
          {item.children.map((c, i) => (
            <Item key={`${c.name}-${c.line}-${i}`} item={c} depth={depth + 1} line={line} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OutlinePanel() {
  const outline = useStore((s) => s.tabs.find((t) => t.key === s.activeKey)?.outline);
  const line = useStore((s) => s.cursor?.line);
  const language = useStore((s) => s.tabs.find((t) => t.key === s.activeKey)?.language);
  return (
    <aside className="outline" aria-label="Outline">
      <div className="side-header">
        <span>Outline</span>
      </div>
      {outline && outline.length > 0 ? (
        <ul className="outline-tree">
          {outline.map((item, i) => (
            <Item key={`${item.name}-${item.line}-${i}`} item={item} depth={0} line={line} />
          ))}
        </ul>
      ) : (
        <div className="side-empty">
          <p>{language && language !== "abap" ? "Sem outline para este tipo de objeto." : "Abre um objeto ABAP para ver a sua estrutura."}</p>
        </div>
      )}
    </aside>
  );
}
