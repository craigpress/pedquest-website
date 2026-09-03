// Flat ESLint config. `next lint` was removed in Next 16, so `npm run lint`
// calls eslint directly with Next's own flat configs (core-web-vitals plus the
// TypeScript rules) — the rule set the build's checks already assume.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // generated from Supabase by scripts/generate-members.ts
      "src/data/members.generated.ts",
      // plain Node dev helpers, not part of the app bundle
      "dev-server.js",
      "start-dev.js",
      "supabase/**",
      "backups/**",
      "design-assets/**",
      "es-report.json",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // react-hooks 7 added this rule (React Compiler era). It fires on the
      // "read a value once on mount, then setState" pattern used throughout
      // this codebase — theme colour probes, localStorage restores, auth
      // bootstraps. Those are deliberate and correct here, so it reports as a
      // warning rather than failing the build. Revisit if the app adopts the
      // React Compiler.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
