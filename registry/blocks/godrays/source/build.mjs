// Builds lib/shaders.iife.js, shared by every shader block: the driver plus only the shaders below. shaders/core's
// index imports every shader for side effects and the registry for media sizing and presets, which these never use.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";

const SHADERS = [
  "Aurora",
  "Blob",
  "Chrome",
  "ColorWheel",
  "FallingLines",
  "FlowingGradient",
  "FractalNoise",
  "Frost",
  "GaborNoise",
  "Godrays",
  "Goo",
  "Heatmap",
  "Hologram",
  "Holographic",
  "LensFlare",
  "LightEdge",
  "LiquidMetal",
  "Marble",
  "MeshGradient",
  "Nebula",
  "Obsidian",
  "Plasma",
  "Plastic",
  "Prism",
  "Ripples",
  "SineWave",
  "Spiral",
  "Strands",
  "Stripes",
  "SunBurst",
  "Swirl",
  "ThinFilm",
  "Voronoi",
  "Water",
  "Waveform",
  "WorleyNoise",
];
const imports = SHADERS.map(
  (n) => `import { componentDefinition as ${n} } from "shaders/core/${n}";`,
).join("\n");

// The driver's `import SHADERS from "shader-defs"`: name -> component definition.
const shaderDefs = {
  name: "shader-defs",
  setup(b) {
    b.onResolve({ filter: /^shader-defs$/ }, () => ({
      path: "shader-defs",
      namespace: "shader-defs",
    }));
    b.onLoad({ filter: /.*/, namespace: "shader-defs" }, () => ({
      contents: `${imports}\nexport default { ${SHADERS.join(", ")} };`,
      resolveDir: process.cwd(),
    }));
  },
};

const onlyTheseShaders = {
  name: "only-these-shaders",
  setup(b) {
    b.onLoad({ filter: /node_modules\/shaders\/dist\/core\/index\.js$/ }, async ({ path }) => {
      const src = await readFile(path, "utf8");
      const patched = [
        [/^import "\.\/[A-Z][\w-]*\.js";\n/gm, ""],
        [
          /import \{ n as getShaderByName, t as getAllShaders \} from "\.\/shaderRegistry-[\w-]+\.js";/,
          `${imports}
const __defs = [${SHADERS.join(", ")}].map((definition) => ({ definition }));
const getShaderByName = (n) => __defs.find((s) => s.definition.name === n);
const getAllShaders = () => __defs;`,
        ],
      ].reduce((code, [pattern, replacement]) => {
        const next = code.replace(pattern, replacement);
        if (next === code)
          throw new Error("shaders/core index.js changed shape; this build needs a look");
        return next;
      }, src);
      return { contents: patched, loader: "js", resolveDir: path.replace(/\/[^/]+$/, "") };
    });
  },
};

const out = "../lib/shaders.iife.js";
await build({
  entryPoints: ["driver.js"],
  bundle: true,
  minify: true,
  format: "iife",
  legalComments: "eof",
  banner: {
    js: "/*! Shaders library (shaders@4.0.0), Copyright 2026 Shader Effects Inc., MIT. Full licence texts are in the licence file installed beside this bundle. */",
  },
  outfile: out,
  plugins: [shaderDefs, onlyTheseShaders],
  logLevel: "error",
});
// Every block whose registry-item.json installs the bundle gets the same lib/ files.
const LIB = ["shaders.iife.js", "shaders.THIRD-PARTY-LICENSES.txt"];
const blocks = [];
for (const block of await readdir("../..")) {
  const manifest = `../../${block}/registry-item.json`;
  if (block === "godrays" || !existsSync(manifest)) continue;
  const { files } = JSON.parse(await readFile(manifest, "utf8"));
  if (!files.some((f) => f.target === "compositions/lib/shaders.iife.js")) continue;
  await mkdir(`../../${block}/lib`, { recursive: true });
  for (const name of LIB) await copyFile(`../lib/${name}`, `../../${block}/lib/${name}`);
  blocks.push(block);
}
console.log(
  "lib/shaders.iife.js",
  (await readFile(out)).length,
  "bytes, copied to",
  blocks.length,
  "blocks:",
  blocks.join(" "),
);
