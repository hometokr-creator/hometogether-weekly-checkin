import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { defineConfig } from "vitest/config";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: projectRoot },
      {
        find: /^server-only$/,
        replacement: resolve(projectRoot, "tests/setup/server-only.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/test-env.ts"],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    fileParallelism: false,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/checkin/supabase-repository.ts"],
    },
  },
});
