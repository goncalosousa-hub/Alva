import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Smoke test of the packaged desktop app (run `npx electron-builder --dir` first and point
 * ALVA_EXECUTABLE at the binary): the embedded server starts and the IDE works in the window.
 */
const executablePath = process.env.ALVA_EXECUTABLE;

test.skip(!executablePath, "ALVA_EXECUTABLE not set");

test("the desktop app starts, logs on to the demo system and edits an object", async () => {
  const app = await electron.launch({ executablePath: executablePath!, args: ["--no-sandbox"] });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("Alva");
    await page.getByRole("button", { name: /sistema demo/i }).click();
    await expect(page.getByText("Sistema demo")).toBeVisible();

    await page.getByText("ZHELLO_ALVA").first().click();
    await expect(page.locator(".view-lines")).toContainText("REPORT zhello_alva");
    await page.locator(".view-lines").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n* from the desktop app");
    await page.keyboard.press("Control+S");
    await expect(page.locator(".statusbar")).toContainText("Inativo");
    await page.keyboard.press("Control+F3");
    await expect(page.locator(".toast")).toContainText("ZHELLO_ALVA ativado");

    // Ctrl+W closes the object tab (in a browser it would close the browser tab).
    await page.keyboard.press("Control+W");
    await expect(page.getByRole("tablist", { name: "Objetos abertos" })).toHaveCount(0);
    await expect(page).toHaveTitle("Alva");
  } finally {
    await app.close();
  }
});

test("shows the update button when a new version was downloaded", async () => {
  const app = await electron.launch({
    executablePath: executablePath!,
    args: ["--no-sandbox"],
    env: { ...process.env, ALVA_FAKE_UPDATE: "9.9.9" },
  });
  try {
    const page = await app.firstWindow();
    // Offered already on the logon screen (a system may be unreachable until updated)...
    await expect(page.getByRole("button", { name: "Atualizar para 9.9.9" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^Alva \d+\.\d+\.\d+$/)).toBeVisible();
    // ...and in the IDE.
    await page.getByRole("button", { name: /sistema demo/i }).click();
    const button = page.getByRole("button", { name: "Atualizar para 9.9.9" });
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    // Covers the app until it closes for the installer, so it does not just disappear.
    const dialog = page.getByRole("dialog", { name: "A atualizar o Alva para 9.9.9" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toBeVisible();
    await expect(dialog).toContainText("o Alva abre sozinho");
  } finally {
    await app.close();
  }
});

test("says the app was updated on the first start after an update", async () => {
  // The installer starts the new version with --updated.
  const app = await electron.launch({
    executablePath: executablePath!,
    args: ["--no-sandbox", "--updated"],
    env: { ...process.env, ALVA_DISABLE_UPDATES: "1" },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".toast")).toContainText(/O Alva foi atualizado para a versão \d+\.\d+\.\d+/, { timeout: 20_000 });
  } finally {
    await app.close();
  }
});

test("remembers a system's password, encrypted, across restarts", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "alva-test-"));
  const launch = () =>
    // Linux CI has no keyring: plain-text storage stands in for the OS encryption (Windows uses DPAPI).
    electron.launch({
      executablePath: executablePath!,
      args: ["--no-sandbox"],
      env: { ...process.env, ALVA_USER_DATA: userData, ALVA_DISABLE_UPDATES: "1", ALVA_TEST_PLAINTEXT_SECRETS: "1" },
    });

  let app = await launch();
  let page = await app.firstWindow();
  const remember = page.getByLabel(/Memorizar a palavra-passe/);
  if (!(await remember.waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
    await app.close();
    test.skip(true, "no OS encryption available here (e.g. no keyring in CI)");
  }
  await page.getByLabel("Nome").fill("S4 QAS");
  await page.getByLabel("Ambiente").selectOption("QAS");
  await page.getByLabel("URL do sistema").fill("10.10.98.24");
  await page.getByLabel("Utilizador").fill("GONCA.SOUSA");
  await page.getByLabel("Palavra-passe", { exact: true }).fill("s3gredo!");
  await remember.check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast", { hasText: "guardado" })).toBeVisible();
  await app.close();

  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByLabel("URL do sistema")).toHaveValue("10.10.98.24");
  await expect(page.getByLabel("Palavra-passe", { exact: true })).toHaveValue("s3gredo!");
  await app.close();
});

