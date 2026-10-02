/**
 * Desktop app: runs the Alva server inside Electron's main process (on a free local port)
 * and shows the IDE in a native window.
 */
import type { AddressInfo } from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { createApp } from "../server/app.js";
import { setUpSecrets } from "./secrets.js";
import { setUpUpdates } from "./updates.js";

// Tests point the app at a throwaway data folder (saved systems, remembered passwords).
if (process.env.ALVA_USER_DATA) app.setPath("userData", process.env.ALVA_USER_DATA);

// One window per user: a second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) app.quit();

const FIXED_PORT = 34717;

let window: BrowserWindow | null = null;
let baseUrl = "";

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const clientDir = path.join(app.getAppPath(), "dist", "client");
  const server = createApp({ clientDir });
  // A fixed port keeps the page's origin, and so its saved systems and preferences, the same
  // between launches; a random one only if something else already uses it.
  const listen = (port: number) =>
    new Promise<import("node:http").Server>((resolve, reject) => {
      const l = server.app.listen(port, "127.0.0.1");
      l.once("listening", () => resolve(l));
      l.once("error", reject);
    });
  const listener = await listen(FIXED_PORT).catch(() => listen(0));
  const { port } = listener.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      listener.close();
      await server.close();
    },
  };
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: "Alva",
    backgroundColor: "#0f1218",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(import.meta.dirname, "preload.cjs"),
    },
  });
  window.once("ready-to-show", () => window?.show());

  // Links to other sites open in the default browser, never inside the IDE.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  // The page refuses to unload while objects have unsaved changes: ask, as the browser would.
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window!, {
      type: "warning",
      buttons: ["Sair sem gravar", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      title: "Alterações por gravar",
      message: "Há objetos com alterações que não foram gravadas.",
      detail: "Se saíres agora, essas alterações perdem-se.",
    });
    if (choice === 0) event.preventDefault();
  });

  window.on("closed", () => {
    window = null;
  });
  void window.loadURL(baseUrl);
}

app.on("second-instance", () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.whenReady().then(async () => {
  // No application menu: its accelerators (Ctrl+W, Ctrl+R, F5...) would steal the IDE's shortcuts.
  Menu.setApplicationMenu(null);
  const server = await startServer();
  baseUrl = server.url;
  setUpUpdates(() => window);
  setUpSecrets();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("before-quit", () => {
    void server.close();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
