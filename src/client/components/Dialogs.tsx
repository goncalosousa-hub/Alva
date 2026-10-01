import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { RELEASES, type AbapRelease } from "../../shared/releases";
import { COMMANDS } from "../commands";
import type { CreatableType } from "../../shared/types";
import { activate, createObject, openTransaction, relintAll, save } from "../ide";
import type { ThemeChoice } from "../prefs";
import { getState, setState, updateSettings, useStore, type Overlay } from "../store";
import { CommandPalette } from "./CommandPalette";
import { Keys } from "./Keys";
import { QuickOpen } from "./QuickOpen";

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function TransportDialog({ overlay }: { overlay: Extract<Overlay, { kind: "transport" }> }) {
  const tab = useStore((s) => s.tabs.find((t) => t.key === overlay.tabKey));
  const [choice, setChoice] = useState(overlay.transports[0]?.number ?? "");
  const [manual, setManual] = useState("");
  const close = () => setState({ overlay: null });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const transport = (manual.trim() || choice).toUpperCase();
    if (!transport) return;
    close();
    const result = await save(overlay.tabKey, { transport, then: overlay.then });
    if (result === "saved" && overlay.then === "activate") await activate(overlay.tabKey);
  }

  return (
    <Modal title="Ordem de transporte" onClose={close}>
      <p className="muted">
        {tab?.ref.name} pertence ao pacote <strong>{overlay.packageName ?? "?"}</strong>, que regista alterações. Escolhe a ordem onde gravar.
      </p>
      <form onSubmit={submit}>
        {overlay.transports.length > 0 ? (
          <ul className="choice-list">
            {overlay.transports.map((t) => (
              <li key={t.number}>
                <label className={choice === t.number && !manual ? "checked" : ""}>
                  <input type="radio" name="transport" value={t.number} checked={choice === t.number && !manual} onChange={() => (setChoice(t.number), setManual(""))} />
                  <span className="mono">{t.number}</span>
                  <span className="grow">{t.text}</span>
                  <span className="muted">{t.owner}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Não tens ordens modificáveis neste sistema.</p>
        )}
        <label className="field">
          Outra ordem
          <input className="mono" placeholder="DEVK900123" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={20} autoFocus={!overlay.transports.length} />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!manual.trim() && !choice} autoFocus={overlay.transports.length > 0}>
            {overlay.then === "activate" ? "Gravar e ativar" : "Gravar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ overlay }: { overlay: Extract<Overlay, { kind: "confirm" }> }) {
  const close = () => setState({ overlay: null });
  return (
    <Modal title={overlay.title} onClose={close}>
      <p>{overlay.message}</p>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={close} autoFocus>
          Cancelar
        </button>
        <button
          type="button"
          className={overlay.danger ? "danger" : "primary"}
          onClick={() => {
            close();
            overlay.onConfirm();
          }}
        >
          {overlay.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const close = () => setState({ overlay: null });
  return (
    <Modal title="Preferências" onClose={close}>
      <div className="settings">
        <label className="field">
          Tema
          <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemeChoice })}>
            <option value="dark">Escuro</option>
            <option value="light">Claro</option>
            <option value="system">Igual ao sistema</option>
          </select>
        </label>
        <label className="field">
          Versão ABAP (análise local)
          <select
            value={settings.release}
            onChange={(e) => {
              updateSettings({ release: e.target.value as AbapRelease });
              relintAll();
            }}
          >
            {RELEASES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Tamanho da letra
          <input type="number" min={10} max={24} value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Math.min(24, Math.max(10, Number(e.target.value) || 14)) })} />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.liveLint}
            onChange={(e) => {
              updateSettings({ liveLint: e.target.checked });
              relintAll();
            }}
          />
          Análise enquanto escreves (abaplint, sem ir ao sistema)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.checkOnSave} onChange={(e) => updateSettings({ checkOnSave: e.target.checked })} />
          Verificar sintaxe no SAP ao gravar
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.minimap} onChange={(e) => updateSettings({ minimap: e.target.checked })} />
          Mostrar minimapa
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={close} autoFocus>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

function ShortcutsDialog() {
  const close = () => setState({ overlay: null });
  const extra: [string, string][] = [
    ["Ctrl+Space", "Completar código (sistema SAP)"],
    ["Ctrl+Click", "Ir para a definição"],
    ["Alt+F12", "Espreitar definição (peek)"],
    ["Ctrl+/", "Comentar / descomentar linhas"],
    ["Ctrl+F / Ctrl+H", "Procurar / substituir"],
    ["Ctrl+D", "Selecionar a próxima ocorrência"],
    ["Alt+↑ / Alt+↓", "Mover linhas"],
    ["Alt+F8", "Problema seguinte"],
  ];
  return (
    <Modal title="Atalhos de teclado" onClose={close} wide>
      <div className="shortcuts">
        {COMMANDS.filter((c) => c.shortcut).map((c) => (
          <div key={c.id} className="shortcut-row">
            <span>{c.title}</span>
            <Keys shortcut={c.shortcut!} />
          </div>
        ))}
        {extra.map(([k, t]) => (
          <div key={k} className="shortcut-row">
            <span>{t}</span>
            <span className="keys">
              <kbd>{k}</kbd>
            </span>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={close} autoFocus>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

const NEW_TYPES: { type: CreatableType; label: string; prefix: string; max: number }[] = [
  { type: "CLAS/OC", label: "Classe", prefix: "ZCL_", max: 30 },
  { type: "PROG/P", label: "Programa", prefix: "Z", max: 40 },
  { type: "INTF/OI", label: "Interface", prefix: "ZIF_", max: 30 },
];

function NewObjectDialog({ overlay }: { overlay: Extract<Overlay, { kind: "newObject" }> }) {
  const [type, setType] = useState<CreatableType>("CLAS/OC");
  const [name, setName] = useState("ZCL_");
  const [description, setDescription] = useState("");
  const [packageName, setPackageName] = useState(overlay.packageName ?? "$TMP");
  const [transports, setTransports] = useState<{ number: string; text: string; owner: string }[] | null>(null);
  const [transport, setTransport] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setState({ overlay: null });
  const spec = NEW_TYPES.find((t) => t.type === type)!;

  function changeType(next: CreatableType) {
    const old = NEW_TYPES.find((t) => t.type === type)!;
    const nextSpec = NEW_TYPES.find((t) => t.type === next)!;
    if (!name || name === old.prefix) setName(nextSpec.prefix);
    setType(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createObject({ type, name: name.trim(), description: description.trim(), packageName: packageName.trim(), transport: transport.trim() || undefined });
    setBusy(false);
    if (result.status === "created") close();
    else if (result.status === "needsTransport") {
      setTransports(result.transports);
      setTransport(result.transports[0]?.number ?? "");
    } else setError(result.error);
  }

  return (
    <Modal title="Novo objeto ABAP" onClose={close}>
      <form onSubmit={submit}>
        <div className="segmented" role="radiogroup" aria-label="Tipo">
          {NEW_TYPES.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={type === t.type} className={type === t.type ? "active" : ""} onClick={() => changeType(t.type)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="field">
          Nome
          <input className="mono" autoFocus required maxLength={spec.max} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} spellCheck={false} />
        </label>
        <label className="field">
          Descrição
          <input required maxLength={60} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Pacote
          <input className="mono" required value={packageName} onChange={(e) => setPackageName(e.target.value.toUpperCase())} spellCheck={false} />
        </label>
        {transports && (
          <>
            <p className="muted">O pacote {packageName.toUpperCase()} regista alterações: escolhe a ordem de transporte.</p>
            {transports.length > 0 && (
              <ul className="choice-list">
                {transports.map((t) => (
                  <li key={t.number}>
                    <label className={transport === t.number ? "checked" : ""}>
                      <input type="radio" name="transport" checked={transport === t.number} onChange={() => setTransport(t.number)} />
                      <span className="mono">{t.number}</span>
                      <span className="grow">{t.text}</span>
                      <span className="muted">{t.owner}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="field">
              Ordem de transporte
              <input className="mono" placeholder="DEVK900123" value={transport} onChange={(e) => setTransport(e.target.value.toUpperCase())} />
            </label>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy || (!!transports && !transport.trim())}>
            {busy ? "A criar…" : "Criar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TransactionDialog() {
  const [tcode, setTcode] = useState("");
  const close = () => setState({ overlay: null });
  return (
    <Modal title="Abrir transação no SAP GUI" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!tcode.trim()) return;
          close();
          openTransaction(tcode.trim().toUpperCase());
        }}
      >
        <label className="field">
          Transação
          <input className="mono" autoFocus placeholder="SE16N, SM30, ST22…" value={tcode} onChange={(e) => setTcode(e.target.value)} spellCheck={false} />
        </label>
        <p className="muted">Abre no SAP GUI para HTML, no browser. Da primeira vez o SAP pede login.</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!tcode.trim()}>
            Abrir
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Overlays() {
  const overlay = useStore((s) => s.overlay);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setState({ overlay: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  if (!overlay) return null;
  const close = () => {
    setState({ overlay: null });
    // The editor gets the keyboard back once the dialog is gone.
    requestAnimationFrame(() => getState().activeKey && document.querySelector<HTMLTextAreaElement>(".editor-host textarea")?.focus());
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {overlay.kind === "quickOpen" && <QuickOpen />}
      {overlay.kind === "commands" && <CommandPalette />}
      {overlay.kind === "transport" && <TransportDialog overlay={overlay} />}
      {overlay.kind === "confirm" && <ConfirmDialog overlay={overlay} />}
      {overlay.kind === "settings" && <SettingsDialog />}
      {overlay.kind === "shortcuts" && <ShortcutsDialog />}
      {overlay.kind === "newObject" && <NewObjectDialog overlay={overlay} />}
      {overlay.kind === "transaction" && <TransactionDialog />}
    </div>
  );
}
