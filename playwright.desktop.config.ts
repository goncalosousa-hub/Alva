import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/desktop",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
});
