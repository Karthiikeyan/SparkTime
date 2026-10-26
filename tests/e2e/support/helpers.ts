import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * Integration helpers. The mutating tests refuse to run against anything but
 * an isolated local database: the connection string must point at 127.0.0.1
 * on a non-default port (the everyday dev database is 54329).
 */
export function stagingSql() {
  const url = process.env.E2E_DATABASE_URL ?? "";
  const u = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  if (!u || !["127.0.0.1", "localhost"].includes(u.hostname) || u.port === "54329" || !u.port) {
    throw new Error("E2E_DATABASE_URL must point at an isolated local staging database (127.0.0.1, not the dev port 54329).");
  }
  return postgres(url, { max: 1, prepare: false, idle_timeout: 1, onnotice: () => undefined });
}

export async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByRole("button", { name: "Local development sign-in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export function writeTree(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export const previewHeading = (page: Page) => page.getByRole("heading", { name: /^Preview/ });

/** The "Plan 1a2b3c4d" label in the preview: identical plans have identical hashes. */
export async function planHash(page: Page): Promise<string> {
  const text = await page.getByText(/Plan [0-9a-f]{8}/).first().innerText();
  return /Plan ([0-9a-f]{8})/.exec(text)![1]!;
}

export async function stat(page: Page, label: string): Promise<string> {
  return (await page.locator("dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]").innerText()).trim();
}

export async function approve(page: Page) {
  await page.getByRole("button", { name: "Approve and import" }).click();
  // "Import and publish" when the preview publishes anything.
  await page.getByRole("dialog").getByRole("button", { name: /^Import( and publish)?$/ }).click();
}
