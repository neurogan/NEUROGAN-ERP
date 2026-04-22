import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "build/**", "FDA/**", "server/__tests__/**"],
    testTimeout: 10_000,
  },
});
