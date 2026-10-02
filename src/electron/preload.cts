/**
 * Bridge between the page and the desktop app (sandboxed preload, hence CommonJS): only the
 * update calls below, nothing else of Node or Electron reaches the page.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopBridge, UpdateStatus } from "../shared/update.js";

const bridge: DesktopBridge = {
  version: () => ipcRenderer.invoke("alva:version"),
  checkForUpdates: () => ipcRenderer.invoke("alva:check-updates"),
  installUpdate: () => ipcRenderer.invoke("alva:install-update"),
  justUpdated: () => ipcRenderer.invoke("alva:just-updated"),
  onUpdateStatus(listener) {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on("alva:update-status", handler);
    // Ask for the current state, in case it changed before the page subscribed.
    void ipcRenderer.invoke("alva:update-status").then(listener);
    return () => ipcRenderer.removeListener("alva:update-status", handler);
  },
  canStorePasswords: () => ipcRenderer.invoke("alva:can-store-passwords"),
  getPassword: (id) => ipcRenderer.invoke("alva:get-password", id),
  setPassword: (id, password) => ipcRenderer.invoke("alva:set-password", id, password),
  deletePassword: (id) => ipcRenderer.invoke("alva:delete-password", id),
};

contextBridge.exposeInMainWorld("alvaDesktop", bridge);
