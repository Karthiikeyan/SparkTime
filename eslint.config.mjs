import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Raw HTML injection is banned. The audited exceptions (JSON-LD
      // serialisation, the static theme script) carry explicit overrides.
      "react/no-danger": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // Client code must never pull server modules (DB, secrets) into the bundle.
    // Type-only imports are erased at compile time and are allowed.
    files: ["src/components/**/*.{ts,tsx}", "src/editor/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/server/*", "@/server/**"], allowTypeImports: true, message: "Client/shared components may only import types from server modules." }] },
      ],
    },
  },
  {
    // Server-rendered components are allowed to call server code directly.
    files: ["src/components/pages/**/*.tsx", "src/components/content/renderer.tsx", "src/components/templates/**/*.tsx"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "exports/**", "drizzle/**"]),
]);
