import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts", "src/client-worker.ts"], outdir: "dist", bundle: true,
  platform: "node", format: "esm", target: "node24", external: ["openclaw/plugin-sdk/*"],
  sourcemap: false
});
