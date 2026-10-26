import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const emptyModule = fileURLToPath(new URL("./tests/helpers/empty-module.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      // "server-only" throws outside a React Server environment; tests run server code directly.
      { find: /^server-only$/, replacement: emptyModule },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_SITE_URL: "https://karthikeyan.example",
      AUTH_SECRET: "test-secret-for-hmac-only",
    },
  },
});
