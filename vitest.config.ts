import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.test.ts",
        "skills/codex-review/__fixtures__/**",
        "src/**/main.ts",
        "src/config/defaults.ts",
        "src/types/**",
      ],
      include: ["skills/codex-review/**/*.ts", "src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
