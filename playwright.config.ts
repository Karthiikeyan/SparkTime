import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error("The mutating Studio tests may only run against an isolated local server.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".data/e2e-results",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL, channel: process.env.E2E_BROWSER, viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});