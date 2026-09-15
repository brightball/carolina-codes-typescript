import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts", "perf_test.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
      },
    },
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Record iteration (`out[key] = …`) is not attacker-controlled injection.
      "security/detect-object-injection": "off",
    },
  },
];
