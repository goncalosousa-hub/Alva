import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { RELEASES, type AbapRelease } from "../../shared/releases";
import { COMMANDS } from "../commands";
import { activate, relintAll, save } from "../ide";
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
    ["F8 / Shift+F8", "Problema seguinte / anterior"],
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
    </div>
  );
}
