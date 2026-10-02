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
    await expect(page.getByText("A instalar 9.9.9")).toBeVisible();
  } finally {
    await app.close();
  }
});

