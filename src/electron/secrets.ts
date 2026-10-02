/**
 * Passwords the user chose to remember, encrypted with the operating system's key
 * (Windows DPAPI, macOS Keychain, libsecret on Linux) and kept in the app's data folder.
 * The page only ever gets the password of the system it is logging on to.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, ipcMain, safeStorage } from "electron";

function file() {
  return path.join(app.getPath("userData"), "passwords.json");
}

function load(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function save(data: Record<string, string>) {
  writeFileSync(file(), JSON.stringify(data), { mode: 0o600 });
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id);

export function setUpSecrets() {
  // Tests on Linux without a keyring: let safeStorage work in plain text (never in the shipped app).
  if (process.env.ALVA_TEST_PLAINTEXT_SECRETS && process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
  ipcMain.handle("alva:can-store-passwords", () => safeStorage.isEncryptionAvailable());
  ipcMain.handle("alva:get-password", (_e, id: unknown) => {
    if (!validId(id) || !safeStorage.isEncryptionAvailable()) return null;
    const stored = load()[id];
    if (!stored) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      return null;
    }
  });
  ipcMain.handle("alva:set-password", (_e, id: unknown, password: unknown) => {
    if (!validId(id) || typeof password !== "string" || !safeStorage.isEncryptionAvailable()) return false;
    const data = load();
    data[id] = safeStorage.encryptString(password).toString("base64");
    save(data);
    return true;
  });
  ipcMain.handle("alva:delete-password", (_e, id: unknown) => {
    if (!validId(id)) return;
    const data = load();
    delete data[id];
    save(data);
  });
}
