// Rebuilds ../assets/vendor/three-path-tracer.min.js and its licence files from the versions
// pinned in package.json and package-lock.json. Run `npm ci && npm run build` in this folder.
import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

const out = new URL("../assets/vendor/", import.meta.url);

await build({
  entryPoints: [new URL("vendor-entry.js", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  outfile: new URL("three-path-tracer.min.js", out).pathname,
});

for (const pkg of ["three", "three-gpu-pathtracer", "three-mesh-bvh"]) {
  await copyFile(
    new URL(`node_modules/${pkg}/LICENSE`, import.meta.url),
    new URL(`${pkg}.LICENSE.txt`, out),
  );
}
console.log("built assets/vendor/three-path-tracer.min.js");
