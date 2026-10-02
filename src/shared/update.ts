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
  /** True once, on the first start after an update. */
  justUpdated(): Promise<boolean>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  /** Remembered passwords, encrypted by the operating system. */
  canStorePasswords(): Promise<boolean>;
  getPassword(id: string): Promise<string | null>;
  setPassword(id: string, password: string): Promise<boolean>;
  deletePassword(id: string): Promise<void>;
}
