import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // `supabase start` writes generated, minified runtime bundles here. ESLint's
    // flat config does not read .gitignore, so without this any contributor who
    // starts the local stack gets ~150 lint errors from vendored code they did
    // not write. Git already ignores it (supabase/.gitignore).
    "supabase/.temp/**",
    "supabase/.branches/**",
  ]),
]);

export default eslintConfig;
