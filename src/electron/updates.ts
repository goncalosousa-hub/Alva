/**
 * Automatic updates from the GitHub releases of the project (electron-updater): checks on start
 * and every few hours, downloads in the background, and installs when the user clicks "Atualizar".
 */
import { app, ipcMain, type BrowserWindow } from "electron";
import updater from "electron-updater";
import type { UpdateStatus } from "../shared/update.js";

const { autoUpdater } = updater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** How long the page shows "a atualizar" before Alva closes for the installer. */
const INSTALL_DELAY_MS = 2_500;

let status: UpdateStatus = { state: "idle" };
let getWindow: () => BrowserWindow | null = () => null;

function publish(next: UpdateStatus) {
  status = next;
  getWindow()?.webContents.send("alva:update-status", status);
}

/** Updates work in the installed Windows app and in the Linux AppImage; not in a dev run. */
function updatesSupported(): boolean {
  if (process.env.ALVA_DISABLE_UPDATES) return false;
  return app.isPackaged && (process.platform === "win32" || !!process.env.APPIMAGE);
}

/** ALVA_FAKE_UPDATE=1.2.3 pretends that version was downloaded (to try the UI without a release). */
const fakeVersion = process.env.ALVA_FAKE_UPDATE;

async function check() {
  // Always announced first, so a manual check can tell its own result from an older state.
  publish({ state: "checking" });
  if (fakeVersion) {
    publish({ state: "ready", version: fakeVersion });
    return;
  }
  if (!updatesSupported()) {
    publish({ state: "none" });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    publish({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

export function setUpUpdates(window: () => BrowserWindow | null) {
  getWindow = window;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-not-available", () => publish({ state: "none" }));
  autoUpdater.on("update-available", (info) => publish({ state: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => {
    if (status.state === "downloading") publish({ ...status, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => publish({ state: "ready", version: info.version }));
  autoUpdater.on("error", (e) => publish({ state: "error", message: e?.message ?? String(e) }));

  ipcMain.handle("alva:version", () => app.getVersion());
  ipcMain.handle("alva:update-status", () => status);
  ipcMain.handle("alva:check-updates", () => check());
  ipcMain.handle("alva:install-update", () => {
    if (status.state !== "ready") return;
    publish({ state: "installing", version: status.version });
    if (fakeVersion) return;
    // The page first shows that the update starts; then Alva closes and, on Windows, the installer
    // shows its progress (not silent) and opens the new version when it is done (build/installer.nsh).
    setTimeout(() => autoUpdater.quitAndInstall(process.platform !== "win32", true), INSTALL_DELAY_MS);
  });
  // The installer starts the new version with --updated: the page then says it was updated.
  let updated = process.argv.includes("--updated");
  ipcMain.handle("alva:just-updated", () => {
    const answer = updated;
    updated = false;
    return answer;
  });

  setTimeout(() => void check(), 5_000);
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
}
