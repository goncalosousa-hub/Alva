/** Auto-update state the desktop app sends to the page. */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "none" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "installing"; version: string }
  | { state: "error"; message: string };

/** What the desktop preload exposes as window.alvaDesktop (absent in the browser). */
export interface DesktopBridge {
  version(): Promise<string>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
}
