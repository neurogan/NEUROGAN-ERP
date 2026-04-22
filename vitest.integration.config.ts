import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests run against a real Postgres instance — either a disposable
// container (docker-compose, local postgres service in CI) or Railway's staging
// DB when explicitly authorised. They live under server/__tests__/.
//
// Per AGENTS.md §5.6: "Integration tests under `server/__tests__/`. Disposable
// Postgres per run. Transaction-per-test wrapper." The transaction wrapper
// lands with F-01 (first regulated endpoint with integration tests).
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["server/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "build/**"],
    testTimeout: 30_000,
    // Integration tests share a single Postgres connection — no fork pool.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
