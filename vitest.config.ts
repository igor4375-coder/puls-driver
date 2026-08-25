import { defineConfig } from "vitest/config";

export default defineConfig({
  // Expo modules read __DEV__ at import time; without it any test that pulls
  // in an expo package fails to load at all.
  define: { __DEV__: "true" },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
