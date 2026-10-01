import { Folder } from "lucide-react";

const TYPES: Record<string, { letter: string; color: string; label: string }> = {
  CLAS: { letter: "C", color: "var(--t-class)", label: "Classe" },
  INTF: { letter: "I", color: "var(--t-intf)", label: "Interface" },
  PROG: { letter: "P", color: "var(--t-prog)", label: "Programa" },
  FUGR: { letter: "F", color: "var(--t-func)", label: "Grupo de funções" },
  DDLS: { letter: "V", color: "var(--t-cds)", label: "CDS view" },
  DCLS: { letter: "A", color: "var(--t-cds)", label: "Controlo de acesso CDS" },
  DDLX: { letter: "M", color: "var(--t-cds)", label: "Metadata extension" },
  BDEF: { letter: "B", color: "var(--t-cds)", label: "Behavior definition" },
  SRVD: { letter: "S", color: "var(--t-cds)", label: "Service definition" },
  TABL: { letter: "T", color: "var(--t-ddic)", label: "Tabela / estrutura" },
  DTEL: { letter: "E", color: "var(--t-ddic)", label: "Elemento de dados" },
  DOMA: { letter: "D", color: "var(--t-ddic)", label: "Domínio" },
  TTYP: { letter: "Y", color: "var(--t-ddic)", label: "Tipo de tabela" },
  MSAG: { letter: "M", color: "var(--t-other)", label: "Classe de mensagens" },
};

export function typeLabel(type: string): string {
  const main = type.split("/")[0];
  if (main === "DEVC") return "Pacote";
  if (type === "PROG/I") return "Include";
  if (type === "FUGR/FF") return "Módulo de função";
  return TYPES[main]?.label ?? type;
}

export function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const main = type.split("/")[0];
  if (main === "DEVC") return <Folder size={size} className="type-folder" aria-label="Pacote" />;
  const t = TYPES[main] ?? { letter: main.slice(0, 1) || "?", color: "var(--t-other)", label: type };
  const letter = type === "PROG/I" ? "i" : type === "FUGR/FF" ? "ƒ" : t.letter;
  return (
    <span className="type-icon" style={{ background: t.color, width: size, height: size, fontSize: size * 0.62 }} title={typeLabel(type)}>
      {letter}
    </span>
  );
}
