// Bundles each entry point (and the shared/ + src/lib code it imports) into dist/*.js.
// nodePaths lets code under ../src/lib resolve zod and papaparse from server/node_modules inside Docker.
import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: {
    main: "src/main.ts", migrate: "src/cli/migrate.ts", token: "src/cli/token.ts",
    "import-csv": "src/cli/import-csv.ts", replay: "src/cli/replay.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  nodePaths: [resolve("node_modules")],
  external: ["pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
