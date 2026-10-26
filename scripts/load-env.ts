import { existsSync } from "node:fs";

/**
 * Scripts run outside Next.js, so load .env files the same way Next does
 * (.env.local overrides .env). Uses Node's built-in loader — no dotenv.
 */
export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
