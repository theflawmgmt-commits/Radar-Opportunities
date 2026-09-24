import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { spawn } from "node:child_process";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  const testOutDir = path.resolve(artifactDir, "dist/test");
  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/__tests__/pipeline.test.ts"),
      path.resolve(artifactDir, "src/__tests__/intelligence.test.ts"),
      path.resolve(artifactDir, "src/__tests__/enrichment.test.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: testOutDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "inline",
    external: [
      "pg-native",
    ],
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  });

  const testFiles = [
    path.resolve(testOutDir, "pipeline.test.mjs"),
    path.resolve(testOutDir, "intelligence.test.mjs"),
    path.resolve(testOutDir, "enrichment.test.mjs"),
  ];
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
    cwd: artifactDir,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
