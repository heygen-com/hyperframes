/* Build assets/glass-main.js from assets/glass-main.mjs.
   The source uses top-level await (HDR + matcap + font loads), which esbuild
   cannot emit in the classic-IIFE format that HyperFrames sub-compositions
   require, so the body is wrapped in an async IIFE with the imports hoisted
   before bundling. Run `npm install esbuild three` first (three 0.185.1 or
   later — HDRLoader is not in older three.js releases). */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SRC = "assets/glass-main.mjs";
const TMP = "assets/.glass-main.entry.mjs";
const OUT = "assets/glass-main.js";

const src = readFileSync(SRC, "utf8");
const lines = src.split("\n");
const imports = [];
const body = [];
for (const line of lines) {
  if (/^\s*import\s/.test(line)) imports.push(line.trim());
  else body.push(line);
}
writeFileSync(TMP, `${imports.join("\n")}\n(async () => {\n${body.join("\n")}\n})();\n`);
try {
  execFileSync(
    "npx",
    [
      "esbuild",
      TMP,
      "--bundle",
      "--format=iife",
      "--minify",
      `--outfile=${OUT}`,
      "--alias:three/addons=three/examples/jsm",
    ],
    { stdio: "inherit" },
  );
} finally {
  unlinkSync(TMP);
}
console.log("built", OUT);
