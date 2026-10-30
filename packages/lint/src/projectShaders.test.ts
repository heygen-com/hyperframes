import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lintProject } from "./project";

const dirs: string[] = [];
const unsafe = "pow(1.0-max(dot(vN,vV),0.0),1.6)";
const code = (expression = unsafe) => `const fragmentShader=\`varying vec3 vN,vV;
void main(){
float f=${expression};
gl_FragColor=vec4(vec3(f),1.0);
}\`;`;

function project(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hf-shader-lint-")));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

async function warnings(root: string) {
  const report = await lintProject(root);
  return report.results
    .flatMap(({ result }) => result.findings)
    .filter((finding) => finding.code === "shader_unbounded_cosine_pow");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

it("finds the external orb shader at its original line once across compositions", async () => {
  const root = project({
    "index.html": '<script src="assets/world-glsl.js?build=1"></script>',
    "compositions/world.html": '<script src="../assets/world-glsl.js"></script>',
    "assets/world-glsl.js": "// authored\n" + code(),
  });
  expect(await warnings(root)).toMatchObject([
    {
      file: join(root, "assets/world-glsl.js"),
      line: 4,
      column: 9,
      severity: "warning",
    },
  ]);
  writeFileSync(join(root, "assets/world-glsl.js"), code("pow(1.0-clamp(dot(vN,vV),0.0,1.0),1.6)"));
  expect(await warnings(root)).toEqual([]);
});

it("resolves nested, root-relative and URL-encoded local scripts", async () => {
  const root = project({
    "index.html": '<script src="/assets/glow%20one.mjs"></script>',
    "assets/glow one.mjs": code(),
    "compositions/world.html": '<script src="glow.cjs"></script>',
    "compositions/glow.cjs": code(),
  });
  expect((await warnings(root)).map((finding) => finding.file)).toEqual([
    join(root, "assets/glow one.mjs"),
    join(root, "compositions/glow.cjs"),
  ]);
});

it("skips remote, missing, vendor and commented-out scripts without fetching", async () => {
  const root = project({
    "index.html": `<!-- <script src="unused.js"></script> -->
      <script src="https://example.invalid/shader.js"></script>
      <script src="missing.js"></script><script src="vendor/lib.js"></script>
      <script src="lib.min.js"></script><script type="application/json" src="data.js"></script>`,
    "unused.js": code(),
    "vendor/lib.js": code(),
    "lib.min.js": code(),
    "data.js": code(),
  });
  expect(await warnings(root)).toEqual([]);
});

it("does not read a linked shader outside the project through a symlink", async () => {
  const outside = project({ "secret.js": code() });
  const root = project({ "index.html": '<script src="outside.js"></script>' });
  symlinkSync(join(outside, "secret.js"), join(root, "outside.js"));
  expect(await warnings(root)).toEqual([]);
});
