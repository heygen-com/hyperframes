// Builds lib/shaders.iife.js, shared by the six shader blocks: the driver plus only their six shaders. shaders/core's
// index imports every shader for side effects and the registry for media sizing and presets, which these never use.
import { build } from "esbuild";
import { copyFile, readFile } from "node:fs/promises";

const SHADERS = ["FlowingGradient", "Godrays", "LiquidMetal", "Marble", "MeshGradient", "Nebula"];
const BLOCKS = ["flowing-gradient", "godrays", "liquid-metal", "marble", "mesh-gradient", "nebula"];

const onlyTheseShaders = {
  name: "only-these-shaders",
  setup(b) {
    b.onLoad({ filter: /node_modules\/shaders\/dist\/core\/index\.js$/ }, async ({ path }) => {
      let src = await readFile(path, "utf8");
      const before = src.length;
      src = src.replace(/^import "\.\/[A-Z][\w-]*\.js";\n/gm, "");
      src = src.replace(
        /import \{ n as getShaderByName, t as getAllShaders \} from "\.\/shaderRegistry-[\w-]+\.js";/,
        `${SHADERS.map((n) => `import { componentDefinition as ${n} } from "shaders/core/${n}";`).join("\n")}
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
  outfile: out,
  plugins: [onlyTheseShaders],
  logLevel: "error",
});
for (const block of BLOCKS.filter((b) => b !== "godrays")) {
  await copyFile(out, `../../${block}/lib/shaders.iife.js`);
}
console.log(
  "lib/shaders.iife.js",
  (await readFile(out)).length,
  "bytes, copied to",
  BLOCKS.length - 1,
  "blocks",
);
