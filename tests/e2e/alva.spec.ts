import { expect, test, type Page } from "@playwright/test";

/** The tab strip of open objects (not the class include switcher). */
const openTabs = (page: Page) => page.getByRole("tablist", { name: "Objetos abertos" });
const activeTab = (page: Page) => openTabs(page).getByRole("tab", { selected: true });

/** Logs on to the in-memory demo system. Each test gets a fresh server-side session. */
async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sistema demo/i }).click();
  await expect(page.getByText("Sistema demo")).toBeVisible();
}

async function openObject(page: Page, name: string) {
  await page.keyboard.press("Control+Shift+A");
  const dialog = page.getByRole("dialog", { name: "Abrir objeto ABAP" });
  await dialog.getByLabel("Pesquisar objetos").fill(name);
  await expect(dialog.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(activeTab(page)).toContainText(name);
  // Monaco is ready when the source lines are rendered.
  await expect(page.locator(".view-lines")).toContainText(/REPORT|CLASS|INTERFACE/i);
}

/** Moves the cursor with Monaco's "go to line" (line:column). */
async function goTo(page: Page, line: number, column = 1) {
  await page.keyboard.press("Control+L");
  await page.keyboard.type(`${line}:${column}`);
  await page.keyboard.press("Enter");
}

async function typeAtEnd(page: Page, text: string) {
  await page.locator(".view-lines").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("edit, lint locally, save and activate a local object", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZHELLO_ALVA");

  // A statement without its period: abaplint reports it while typing, no system round trip.
  await typeAtEnd(page, "\nWRITE / lv_name");
  await page.keyboard.press("Control+J");
  const problems = page.getByTestId("problems");
  await expect(problems).toContainText("abaplint(parser_error)");
  await expect(activeTab(page).locator(".tab-close.dirty")).toBeVisible();

  await page.keyboard.type(".");
  await expect(page.locator(".panel-empty")).toHaveText("Sem problemas nos objetos abertos.");

  // Local package: no transport needed.
  await page.keyboard.press("Control+S");
  await expect(activeTab(page).locator(".tab-name")).toHaveClass(/inactive/);
  await expect(page.locator(".statusbar")).toContainText("Inativo");
  await expect(activeTab(page).locator(".tab-close.dirty")).toHaveCount(0);

  await page.keyboard.press("Control+F3");
  await expect(page.locator(".toast")).toContainText("ZHELLO_ALVA ativado");
  await expect(page.locator(".statusbar")).toContainText("Ativo");
});

test("saving in a transportable package asks for a transport request", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZR_FLIGHT_REPORT");
  await typeAtEnd(page, '\n* changed by the e2e test');
  await page.keyboard.press("Control+S");

  const dialog = page.getByRole("dialog", { name: "Ordem de transporte" });
  await expect(dialog).toContainText("ZALVA_DEMO");
  await dialog.getByText("DEVK900131").click();
  await dialog.getByRole("button", { name: "Gravar" }).click();

  await expect(page.locator(".statusbar")).toContainText("DEVK900131");
  await expect(page.locator(".statusbar")).toContainText("Inativo");

  // The request is remembered for the next save.
  await typeAtEnd(page, "\n* again");
  await page.keyboard.press("Control+S");
  await expect(activeTab(page).locator(".tab-close.dirty")).toHaveCount(0);
  await expect(dialog).toHaveCount(0);

  // Inactive objects view lists it and activates everything.
  await page.keyboard.press("Control+Shift+F3");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toContainText("ZR_FLIGHT_REPORT");
  await sidebar.getByRole("button", { name: /Ativar objeto/ }).click();
  await expect(sidebar).toContainText("Tudo ativado");
});

test("F3 navigates to the definition in another object", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZR_FLIGHT_REPORT");
  // Line 22: "  DATA(lo_service) = NEW zcl_flight_service( lo_repository )."
  await goTo(page, 22, 30);
  await page.keyboard.press("F3");
  await expect(activeTab(page)).toContainText("ZCL_FLIGHT_SERVICE");
  await expect(openTabs(page).getByRole("tab")).toHaveCount(2);
});

test("syntax check on the system and code completion", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZHELLO_ALVA");
  await typeAtEnd(page, "\nlv_unknown = 1.");
  await page.keyboard.press("Control+F2");
  await expect(page.getByTestId("problems")).toContainText(/lv_unknown/i);
  await expect(page.getByTestId("problems")).toContainText("SAP");

  await page.keyboard.press("Control+Z");
  await typeAtEnd(page, "\nzcl_s");
  await page.keyboard.press("Control+Space");
  const suggest = page.locator(".suggest-widget");
  await expect(suggest).toContainText("zcl_string_utils");
  await page.keyboard.press("Enter");
  await expect(page.locator(".view-lines")).toContainText("zcl_string_utils");
});

test("pretty printer, outline navigation and command palette", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZHELLO_ALVA");
  await typeAtEnd(page, "\nif lv_name is initial.\nwrite 'x'.\nendif.");
  await page.keyboard.press("Shift+F1");
  await expect(page.locator(".view-lines")).toContainText("IF lv_name IS INITIAL.");

  await openObject(page, "ZCL_FLIGHT_SERVICE");
  const outline = page.getByRole("complementary", { name: "Outline" });
  await outline.getByRole("button", { name: /occupation/ }).last().click();
  await expect(page.locator(".statusbar")).toContainText("Ln 45");

  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("tema claro");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("closing a tab with unsaved changes asks first", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZHELLO_ALVA");
  await typeAtEnd(page, "\n* draft");
  await page.keyboard.press("Alt+W");
  const dialog = page.getByRole("dialog", { name: "Alterações por gravar" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(openTabs(page).getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Alt+W");
  await dialog.getByRole("button", { name: "Fechar sem gravar" }).click();
  await expect(openTabs(page).getByRole("tab")).toHaveCount(0);
});

test("switches between the includes of a class", async ({ page }) => {
  await startDemo(page);
  await openObject(page, "ZCL_FLIGHT_SERVICE");
  const includes = page.getByRole("tablist", { name: "Includes da classe" });
  await includes.getByRole("tab", { name: "Classes de teste" }).click();
  await expect(page.locator(".view-lines")).toContainText("ltc_flight_service");
  await expect(activeTab(page)).toContainText("testes");
  // The outline follows the include.
  await expect(page.getByRole("complementary", { name: "Outline" })).toContainText("full_flights_are_skipped");

  await includes.getByRole("tab", { name: "Classe global" }).click();
  await expect(page.locator(".view-lines")).toContainText("CLASS zcl_flight_service DEFINITION");
  await expect(openTabs(page).getByRole("tab")).toHaveCount(2);
});

test("creates a class, runs a console class and the ABAP Unit tests", async ({ page }) => {
  await startDemo(page);

  // New object (Alt+N in the browser, Ctrl+N in the desktop app).
  await page.keyboard.press("Alt+N");
  const dialog = page.getByRole("dialog", { name: "Novo objeto ABAP" });
  await dialog.getByLabel("Nome").fill("ZCL_E2E_NEW");
  await dialog.getByLabel("Descrição").fill("Criada no teste");
  await dialog.getByLabel("Pacote").fill("$ZALVA_LOCAL");
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(activeTab(page)).toContainText("ZCL_E2E_NEW");
  await expect(page.locator(".statusbar")).toContainText("Inativo");
  await expect(page.locator(".sidebar")).toContainText("ZCL_E2E_NEW");
  await page.keyboard.press("Control+F3");
  await expect(page.locator(".statusbar")).toContainText("Ativo");

  // F8 on a console class shows its output.
  await openObject(page, "ZCL_ALVA_HELLO");
  await page.keyboard.press("F8");
  await expect(page.getByTestId("console")).toContainText("Olá do Alva!");

  // F8 on a program opens SAP GUI for HTML (the demo system says it has none).
  await openObject(page, "ZR_FLIGHT_REPORT");
  await page.keyboard.press("F8");
  await expect(page.locator(".toast", { hasText: "não tem SAP GUI" })).toBeVisible();

  // ABAP Unit.
  await openObject(page, "ZCL_FLIGHT_SERVICE");
  page.on("console", (m) => m.type() === "error" && console.log("browser console:", m.text()));
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.keyboard.press("Control+Shift+F10");
  const results = page.getByTestId("unit-results");
  try {
    await expect(results).toContainText("2 de 2 teste(s) passaram");
  } catch (e) {
    // Diagnostics for CI, where this has failed with a newer Chromium.
    console.log("toasts:", await page.locator(".toast").allTextContents());
    console.log("status bar:", await page.locator(".statusbar").textContent());
    console.log("active element:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200)));
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("Correr testes ABAP Unit");
    await page.keyboard.press("Enter");
    console.log("via palette:", await results.textContent({ timeout: 10_000 }).catch((err) => `not shown: ${err.message.split("\n")[0]}`));
    throw e;
  }
  await results.getByRole("button", { name: /FULL_FLIGHTS_ARE_SKIPPED/ }).click();
  await expect(activeTab(page)).toContainText("testes");
});

test("a new object in a transportable package asks for the transport in the dialog", async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press("Alt+N");
  const dialog = page.getByRole("dialog", { name: "Novo objeto ABAP" });
  await dialog.getByRole("radio", { name: "Programa" }).click();
  await dialog.getByLabel("Nome").fill("ZR_E2E_REPORT");
  await dialog.getByLabel("Descrição").fill("Relatório");
  await dialog.getByLabel("Pacote").fill("ZALVA_DEMO");
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(dialog).toContainText("regista alterações");
  await dialog.getByText("DEVK900131").click();
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(activeTab(page)).toContainText("ZR_E2E_REPORT");
  await expect(page.locator(".view-lines")).toContainText("REPORT zr_e2e_report.");
});
