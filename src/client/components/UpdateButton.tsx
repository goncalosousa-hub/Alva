import { Download, Loader2, RefreshCw } from "lucide-react";
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

/** Shows the update state in the title bar: nothing while up to date, a button when a new version is ready. */
export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  useEffect(() => desktop?.onUpdateStatus(setStatus), []);
  if (!desktop) return null;

  if (status.state === "downloading") {
    return (
      <span className="update-progress" title={`A descarregar o Alva ${status.version}`}>
        <Loader2 size={13} className="spin" /> {status.version} · {status.percent}%
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
