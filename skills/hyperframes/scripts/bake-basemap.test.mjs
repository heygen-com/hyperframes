import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { npmGlobalFolder } from "./lib/trusted-package.mjs";

const scripts = fileURLToPath(new URL(".", import.meta.url));
// A machine with its own global puppeteer-core loads that one, which is allowed; the message checks need it absent.
const globalCopy = existsSync(join(npmGlobalFolder(), "puppeteer-core"));

/** A package named puppeteer-core whose top-level code records that it ran, then stops the bake. */
function stubPackage(folder, marker, label) {
  const dir = join(folder, "puppeteer-core");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "puppeteer-core", main: "index.js" }),
  );
  writeFileSync(
    join(dir, "index.js"),
    `require("node:fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${label}\n`)});\n` +
      `exports.launch = () => { throw new Error("stub launch"); };\n`,
  );
  return dir;
}

function setup(t, skillsDir) {
  const base = mkdtempSync(join(tmpdir(), "basemap-trust-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const project = join(base, "project");
  const marker = join(base, "loaded.txt");
  mkdirSync(home);
  const skill = join(project, skillsDir, "hyperframes", "scripts");
  cpSync(scripts, skill, { recursive: true, filter: (path) => !path.endsWith(".test.mjs") });
  // Every node_modules a project-scoped skill sits below.
  for (const folder of ["node_modules", ".agents/node_modules", `${skillsDir}/node_modules`]) {
    stubPackage(join(project, folder), marker, `project:${folder}`);
  }
  const run = (env = {}) =>
    spawnSync(process.execPath, [join(skill, "bake-basemap.mjs")], {
      cwd: project,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(base, "appdata"),
        ...env,
      },
    });
  const loaded = () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : []);
  return { base, home, marker, run, loaded };
}

for (const skillsDir of [".agents/skills", ".claude/skills", "skills"]) {
  test(`a skill in <project>/${skillsDir} never loads the project's puppeteer-core`, (t) => {
    const { home, run, loaded } = setup(t, skillsDir);
    const result = run();
    assert.deepEqual(loaded(), []);
    if (globalCopy) return;
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /never from the project folder/);
    assert.match(result.stderr, /cd ~ && npm install --global puppeteer-core/);
    assert.ok(result.stderr.includes(join(home, "node_modules")), result.stderr);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  });
}

test("puppeteer-core in the person's home folder is the one a project-scoped skill loads", (t) => {
  const { home, marker, run, loaded } = setup(t, ".agents/skills");
  stubPackage(join(home, "node_modules"), marker, "home");
  run();
  assert.deepEqual(loaded(), ["home"]);
});

test("HYPERFRAMES_PUPPETEER_CORE loads the folder it names, and must be absolute", (t) => {
  const { base, marker, run, loaded } = setup(t, ".agents/skills");
  const own = stubPackage(join(base, "tools"), marker, "override");
  run({ HYPERFRAMES_PUPPETEER_CORE: own });
  assert.deepEqual(loaded(), ["override"]);
  const relative = run({ HYPERFRAMES_PUPPETEER_CORE: "node_modules/puppeteer-core" });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /must be an absolute path/);
  assert.deepEqual(loaded(), ["override"]);
});

/** A stand-in npm on PATH that records the folder it runs in and answers `root --global` with `answer`. */
function fakeNpm(base, answer, status = 0) {
  const bin = join(base, "bin");
  mkdirSync(bin, { recursive: true });
  const ranIn = join(base, "npm-ran-in.txt");
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/sh\npwd >> ${JSON.stringify(ranIn)}\necho ${JSON.stringify(answer)}\nexit ${status}\n`,
    { mode: 0o755 },
  );
  return { PATH: `${bin}${delimiter}${process.env.PATH}`, ranIn };
}

test(
  "the folder npm root --global names is read, with npm asked from the home folder",
  { skip: process.platform === "win32" && "the stand-in npm is a shell script" },
  (t) => {
    const { base, home, marker, run, loaded } = setup(t, ".agents/skills");
    const globalFolder = join(base, "custom-prefix", "lib", "node_modules");
    stubPackage(globalFolder, marker, "npm global");
    const npm = fakeNpm(base, globalFolder);
    run({ PATH: npm.PATH });
    assert.deepEqual(loaded(), ["npm global"]);
    const [ranIn] = readFileSync(npm.ranIn, "utf8").trim().split("\n");
    assert.equal(realpathSync(ranIn), realpathSync(home));
  },
);

test(
  "when npm cannot answer, npm's default folder for this Node is read instead",
  { skip: process.platform === "win32" && "the stand-in npm is a shell script" },
  (t) => {
    const base = mkdtempSync(join(tmpdir(), "basemap-npm-"));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const npm = fakeNpm(base, "", 1);
    const path = process.env.PATH;
    process.env.PATH = npm.PATH;
    t.after(() => (process.env.PATH = path));
    assert.equal(
      npmGlobalFolder({ home: base }),
      join(dirname(dirname(process.execPath)), "lib", "node_modules"),
    );
  },
);

const npmSkip = { skip: process.platform === "win32" && "the stand-in npm is a shell script" };

test("an npm answer that is not an absolute path is not used", npmSkip, (t) => {
  const base = mkdtempSync(join(tmpdir(), "basemap-npm-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const npm = fakeNpm(base, "node_modules");
  const path = process.env.PATH;
  process.env.PATH = npm.PATH;
  t.after(() => (process.env.PATH = path));
  assert.equal(
    npmGlobalFolder({ home: base }),
    join(dirname(dirname(process.execPath)), "lib", "node_modules"),
  );
});

test("a bake with no puppeteer-core anywhere asks npm once", npmSkip, (t) => {
  const { base, run } = setup(t, ".agents/skills");
  const npm = fakeNpm(base, join(base, "empty-global"));
  const result = run({ PATH: npm.PATH });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(readFileSync(npm.ranIn, "utf8").trim().split("\n").length, 1);
});

test(
  "puppeteer-core installed globally under Volta is read when VOLTA_HOME is set",
  npmSkip,
  (t) => {
    const { base, marker, run, loaded } = setup(t, ".agents/skills");
    const volta = join(base, "volta");
    const packages = join(
      volta,
      "tools",
      "image",
      "packages",
      "puppeteer-core",
      "lib",
      "node_modules",
    );
    const npm = fakeNpm(base, join(base, "empty-global"));
    const missing = run({ PATH: npm.PATH, VOLTA_HOME: volta });
    assert.ok(missing.stderr.includes(packages), missing.stderr);
    stubPackage(packages, marker, "volta");
    run({ PATH: npm.PATH, VOLTA_HOME: volta });
    assert.deepEqual(loaded(), ["volta"]);
  },
);
