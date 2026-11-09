import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { discoverItems, lintStagedItem, stageItem } from "./lint-registry-items.mjs";

// A 1x1 PNG, so the fixture assets are real images rather than placeholder bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const BLOCK_HTML = `<!doctype html>
<html>
  <body>
    <div
      data-composition-id="demo-card"
      data-start="0"
      data-duration="2"
      data-width="1920"
      data-height="1080"
      data-no-timeline
      style="position: relative; width: 1920px; height: 1080px"
    >
      <img src="assets/avatar.png" alt="" width="64" height="64" />
      <img src="assets/hosted.png" alt="" width="64" height="64" />
    </div>
  </body>
</html>
`;

const COMPONENT_HTML = `<div class="demo-glow"><img src="glow.png" alt="" width="64" height="64" /></div>
`;

let sandbox;
let registry;
let project;
let projects = 0;

function writeItem(kind, name, files, manifestFiles) {
  const dir = join(registry, kind, name);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  if (manifestFiles) {
    writeFileSync(join(dir, "registry-item.json"), JSON.stringify({ name, files: manifestFiles }));
  }
}

const item = (name) => discoverItems(registry).find((i) => i.name === name);

before(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "hf-lint-registry-items-")));
  registry = join(sandbox, "registry");
  writeFileSync(join(sandbox, "secret.txt"), "runner secret\n");
  writeItem("blocks", "demo-card", { "demo-card.html": BLOCK_HTML, "assets/avatar.png": PNG }, [
    { path: "demo-card.html", target: "compositions/demo-card.html" },
    { path: "assets/avatar.png", target: "assets/avatar.png" },
    { path: "assets/hosted.png", target: "assets/hosted.png", url: "https://example.com/a.png" },
    { path: "assets/missing.png", target: "assets/missing.png" },
    { path: "../../../secret.txt", target: "assets/secret.txt" },
    { path: "assets/avatar.png", target: "../escaped.png" },
    { path: "assets/gone.png", target: "../hosted-escape.png", url: "https://example.com/b.png" },
  ]);
  writeItem("components", "demo-glow", { "demo-glow.html": COMPONENT_HTML, "glow.png": PNG }, [
    { path: "demo-glow.html", target: "compositions/components/demo-glow.html" },
    { path: "glow.png", target: "compositions/components/glow.png" },
  ]);
  writeItem("blocks", "bare", { "bare.html": BLOCK_HTML });
});

beforeEach(() => {
  project = join(sandbox, `project-${++projects}`);
  mkdirSync(project);
});

after(() => rmSync(sandbox, { recursive: true, force: true }));

test("every file the manifest lists is staged at its target", () => {
  const staged = stageItem(item("demo-card"), project);
  assert.deepEqual([...staged].sort(), [
    join(project, "assets/avatar.png"),
    join(project, "compositions/demo-card.html"),
  ]);
  assert.ok(existsSync(join(project, "index.html")));
});

test("a manifest entry that leaves the item or the project is skipped", () => {
  stageItem(item("demo-card"), project);
  assert.equal(existsSync(join(project, "assets/secret.txt")), false);
  assert.equal(existsSync(join(sandbox, "escaped.png")), false);
  assert.equal(existsSync(join(sandbox, "hosted-escape.png")), false);
});

test("a hosted file gets an empty stand-in; a missing file without a url is left out", () => {
  const staged = stageItem(item("demo-card"), project);
  const standIn = join(project, "assets/hosted.png");
  assert.equal(readFileSync(standIn, "utf-8"), "");
  assert.equal(staged.has(standIn), false);
  assert.equal(existsSync(join(project, "assets/missing.png")), false);
});

test("a component is staged next to compositions/components/, at the same depth", () => {
  const staged = stageItem(item("demo-glow"), project);
  assert.ok(staged.has(join(project, "compositions/registry-components/demo-glow.html")));
  assert.ok(staged.has(join(project, "compositions/registry-components/glow.png")));
  assert.equal(existsSync(join(project, "compositions/components")), false);
});

test("an item without a manifest is staged at compositions/<name>.html", () => {
  assert.deepEqual(
    [...stageItem(item("bare"), project)],
    [join(project, "compositions/bare.html")],
  );
});

const report = (body) => () => ({ status: 1, stderr: "", stdout: JSON.stringify(body) });

test("only error findings in the item's own files are returned", () => {
  const html = join(project, "compositions/demo-card.html");
  const script = join(project, "assets/main.js");
  const findings = [
    { code: "missing_local_asset", severity: "error", file: html },
    { code: "non_deterministic_code", severity: "error", file: script },
    { code: "missing_local_asset", severity: "error", file: join(project, "index.html") },
    { code: "font_family_without_font_face", severity: "warning", file: html },
    { code: "root_missing_composition_id", severity: "error", file: html },
  ];
  const errors = lintStagedItem(
    project,
    new Set([html, script]),
    report({ ok: false, filesScanned: 2, findings }),
  );
  assert.deepEqual(
    errors.map((e) => e.code),
    ["missing_local_asset", "non_deterministic_code"],
  );
});

test("a run that proves nothing is a failure, not a pass", () => {
  const staged = new Set([join(project, "compositions/demo-card.html")]);
  const crash = () => ({ status: 1, stdout: "", stderr: "Cannot find package 'ignore'" });
  assert.throws(() => lintStagedItem(project, staged, crash), /did not return a JSON report/);
  assert.throws(
    () => lintStagedItem(project, staged, report({ ok: false, error: { message: "boom" } })),
    /lint failed: boom/,
  );
  assert.throws(
    () => lintStagedItem(project, staged, report({ ok: true, filesScanned: 1, findings: [] })),
    /did not scan the item/,
  );
});

test("the linter passes an item that ships its assets and fails it once one is gone", () => {
  const staged = {};
  for (const name of ["demo-card", "demo-glow"]) {
    const dir = join(sandbox, `real-${name}`);
    mkdirSync(dir);
    staged[name] = stageItem(item(name), dir);
    assert.deepEqual(lintStagedItem(dir, staged[name]), [], `${name} should lint clean`);
  }
  rmSync(join(sandbox, "real-demo-card/assets/avatar.png"));
  assert.deepEqual(
    lintStagedItem(join(sandbox, "real-demo-card"), staged["demo-card"]).map((e) => e.code),
    ["missing_local_asset"],
  );
});
