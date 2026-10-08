// Builds lib/shaders.iife.js, shared by every shader block: the driver plus only the shaders below. shaders/core's
// index imports every shader for side effects and the registry for media sizing and presets, which these never use.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { copyFile, readdir, readFile } from "node:fs/promises";

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
      let src = await readFile(path, "utf8");
      const before = src.length;
      src = src.replace(/^import "\.\/[A-Z][\w-]*\.js";\n/gm, "");
      src = src.replace(
        /import \{ n as getShaderByName, t as getAllShaders \} from "\.\/shaderRegistry-[\w-]+\.js";/,
        `${imports}
const __defs = [${SHADERS.join(", ")}].map((definition) => ({ definition }));
const getShaderByName = (n) => __defs.find((s) => s.definition.name === n);
const getAllShaders = () => __defs;`,
      );
      if (src.length === before)
        throw new Error("shaders/core index.js changed shape; this build needs a look");
      return { contents: src, loader: "js", resolveDir: path.replace(/\/[^/]+$/, "") };
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
    js: "/*! Shaders library (shaders@4.0.0), Copyright 2026 Shader Effects Inc., MIT. See shaders.THIRD-PARTY-LICENSES.txt */",
  },
  outfile: out,
  plugins: [shaderDefs, onlyTheseShaders],
  logLevel: "error",
});
// Every sibling block that ships the bundle gets the same bytes.
const blocks = [];
for (const block of await readdir("../..")) {
  const lib = `../../${block}/lib/shaders.iife.js`;
  if (block === "godrays" || !existsSync(lib)) continue;
  await copyFile(out, lib);
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
