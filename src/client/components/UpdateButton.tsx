import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesktopBridge, UpdateStatus } from "../../shared/update";
import { setState, toast, useStore } from "../store";

declare global {
  interface Window {
    /** Present only in the desktop app (see src/electron/preload.cts). */
    alvaDesktop?: DesktopBridge;
  }
}

export const desktop = typeof window !== "undefined" ? window.alvaDesktop : undefined;

function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  useEffect(() => desktop?.onUpdateStatus(setStatus), []);
  return status;
}

function ProgressBar({ percent, label }: { percent?: number; label: string }) {
  const known = percent !== undefined;
  return (
    <div
      className={`progress-bar${known ? "" : " indeterminate"}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
    >
      <div className="progress-fill" style={known ? { width: `${percent}%` } : undefined} />
    </div>
  );
}

/** Shows the update state in the title bar: nothing while up to date, a button when a new version is ready. */
export function UpdateButton() {
  const status = useUpdateStatus();
  if (!desktop) return null;

  if (status.state === "downloading") {
    return (
      <span className="update-progress" title={`A descarregar o Alva ${status.version}`}>
        <Loader2 size={13} className="spin" /> A descarregar {status.version}
        <ProgressBar percent={status.percent} label={`A descarregar o Alva ${status.version}`} />
        {status.percent}%
      </span>
    );
  }
  if (status.state === "installing") {
    return (
      <span className="update-progress">
        <RefreshCw size={13} className="spin" /> A instalar {status.version}…
      </span>
    );
  }
  if (status.state !== "ready") return null;

  const install = () => {
    const dirty = useStore.getState().tabs.filter((t) => t.dirty);
    if (!dirty.length) return void desktop.installUpdate();
    setState({
      overlay: {
        kind: "confirm",
        title: "Atualizar o Alva",
        message: `${dirty.map((t) => t.ref.name).join(", ")} ${dirty.length === 1 ? "tem" : "têm"} alterações por gravar, que se perdem ao reiniciar. Atualizar mesmo assim?`,
        confirmLabel: "Atualizar",
        danger: true,
        onConfirm: () => void desktop.installUpdate(),
      },
    });
  };

  return (
    <button type="button" className="update-button" onClick={install} title="Reinicia o Alva com a nova versão">
      <Download size={14} /> Atualizar para {status.version}
    </button>
  );
}

/**
 * While an update installs, covers the app: Alva is about to close, and without this it would just
 * disappear. On Windows the installer then shows its own progress and opens the new version.
 */
export function UpdateOverlay() {
  const status = useUpdateStatus();
  if (status.state !== "installing") return null;
  return (
    <div className="overlay update-overlay">
      <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h2 id="update-title">
          <RefreshCw size={18} className="spin" /> A atualizar o Alva para {status.version}
        </h2>
        <ProgressBar label="A atualizar o Alva" />
        <ol className="update-steps">
          <li className="done">
            <Check size={14} /> Nova versão descarregada
          </li>
          <li className="active">
            <Loader2 size={14} className="spin" /> A fechar o Alva e a abrir o instalador
          </li>
          <li>
            <span className="step-dot" /> Instalar e abrir o Alva {status.version}
          </li>
        </ol>
        <p className="hint">
          O Alva vai fechar: a janela de instalação mostra o progresso e, no fim, o Alva abre sozinho na versão nova. Não é preciso fazer
          nada.
        </p>
      </div>
    </div>
  );
}

/** On the first start after an update, says so. */
export function announceUpdate() {
  const bridge = window.alvaDesktop;
  void bridge?.justUpdated().then(async (updated) => {
    if (updated) toast("success", `O Alva foi atualizado para a versão ${await bridge.version()}`);
  });
}

/** Manual check, with the outcome as a toast. */
export async function checkForUpdates() {
  const bridge = window.alvaDesktop;
  if (!bridge) return;
  const version = await bridge.version();
  toast("info", `A procurar atualizações (versão atual ${version})…`, { logIt: false });
  let started = false;
  const stop = bridge.onUpdateStatus((status) => {
    if (status.state === "checking") started = true;
    if (!started) return; // the state from before this check
    if (status.state === "none") toast("success", `O Alva está atualizado (${version})`);
    else if (status.state === "downloading") toast("info", `Nova versão ${status.version}: a descarregar…`);
    else if (status.state === "ready") toast("success", `O Alva ${status.version} está pronto: usa o botão Atualizar`);
    else if (status.state === "error") toast("error", `Não foi possível procurar atualizações: ${status.message}`);
    else return;
    stop();
  });
  await bridge.checkForUpdates();
}
