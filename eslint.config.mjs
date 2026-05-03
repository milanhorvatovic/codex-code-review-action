import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage/",
      "dist/",
      "node_modules/",
      "scripts/*.mjs",
      "skills/codex-review/__fixtures__/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
);
