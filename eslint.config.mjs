import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // NF-R7: no randomness or real clock in application logic, so every run gives the same ids and results.
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Application logic must be deterministic (NF-R7)." },
        { object: "Date", property: "now", message: "Use the demo clock, never the real clock (NF-R7)." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use the demo clock, never the real clock (NF-R7)." },
      ],
    },
  },
  {
    files: ["lib/testing.ts", "**/*.test.ts", "tests/**", "scripts/**"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "design/**", "components/ui/**"]),
]);

export default eslintConfig;
