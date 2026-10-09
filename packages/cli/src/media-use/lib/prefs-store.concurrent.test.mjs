import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectPrefsPath, recordPreference, userPrefsPath } from "./prefs-store.mjs";

async function inSandbox(task) {
  const root = mkdtempSync(join(tmpdir(), "mu-prefs-concurrent-"));
  const previousHome = process.env.HYPERFRAMES_MEDIA_HOME;
  process.env.HYPERFRAMES_MEDIA_HOME = join(root, "home");
  const project = join(root, "project");
  mkdirSync(project);
  try {
    await task({ root, project });
  } finally {
    if (previousHome === undefined) delete process.env.HYPERFRAMES_MEDIA_HOME;
    else process.env.HYPERFRAMES_MEDIA_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}

function worker(root, source, args = []) {
  const path = join(mkdtempSync(join(root, "worker-")), "worker.cjs");
  writeFileSync(path, source);
  const child = fork(path, args, { silent: true, execArgv: [] });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
  const ready = new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`worker exited before ready: ${stderr}`)));
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
  return { child, ready, closed };
}

for (const tier of ["project", "user"]) {
  test(`record re-reads the ${tier} tier after another process releases its lock`, async () => {
    await inSandbox(async ({ root, project }) => {
      const path = tier === "project" ? projectPrefsPath(project) : userPrefsPath();
      mkdirSync(dirname(path), { recursive: true });
      const held = worker(
        root,
        `const fs = require("node:fs");
         const path = process.argv[2];
         fs.writeFileSync(path + ".lock", "held", { flag: "wx" });
         process.send("locked");
         setTimeout(() => {
           fs.writeFileSync(path, JSON.stringify({version: 1,
             preferences: {aspect: {value: "1080x1920", confirmed_in: ["other"]}},
             sightings: {aspect: {"1080x1920": ["other"]}}}));
           fs.rmSync(path + ".lock");
           process.disconnect();
         }, 300);`,
        [path],
      );
      try {
        await held.ready;
        recordPreference({ projectDir: project, key: "destination", value: "youtube-shorts" });
        const result = await held.closed;
        assert.equal(result.code, 0, result.stderr);
        const file = JSON.parse(readFileSync(path, "utf8"));
        assert.equal(file.preferences.aspect?.value, "1080x1920");
        if (tier === "project") {
          assert.equal(file.preferences.destination?.value, "youtube-shorts");
        } else {
          assert.deepEqual(file.sightings.destination?.["youtube-shorts"], ["project"]);
          assert.deepEqual(file.sightings.aspect?.["1080x1920"], ["other"]);
        }
      } finally {
        held.child.kill();
        await held.closed;
      }
    });
  });
}

test("parallel records preserve every project key and promote every shared user sighting", async () => {
  await inSandbox(async ({ root, project }) => {
    const secondProject = join(root, "second-project");
    mkdirSync(secondProject);
    const modulePath = fileURLToPath(new URL("./prefs-store.mjs", import.meta.url));
    const choices = {
      destination: "youtube-shorts",
      aspect: "1080x1920",
      language: "en",
      flow: "automation",
    };
    const children = [project, secondProject].flatMap((projectDir) =>
      Object.entries(choices).map(([key, value]) =>
        worker(
          root,
          `const {pathToFileURL} = require("node:url");
           import(pathToFileURL(process.argv[2])).then(({recordPreference}) => {
             process.send("ready");
             process.once("message", () => {
               try {recordPreference(JSON.parse(process.argv[3]));}
               catch (error) {console.error(error.message); process.exitCode = 1;}
               process.disconnect();
             });
           });`,
          [modulePath, JSON.stringify({ projectDir, key, value })],
        ),
      ),
    );
    try {
      await Promise.all(children.map((child) => child.ready));
      for (const child of children) child.child.send("record");
      const results = await Promise.all(children.map((child) => child.closed));
      for (const result of results) assert.equal(result.code, 0, result.stderr);
      for (const projectDir of [project, secondProject]) {
        const file = JSON.parse(readFileSync(projectPrefsPath(projectDir), "utf8"));
        assert.deepEqual(Object.keys(file.preferences).sort(), Object.keys(choices).sort());
        for (const [key, value] of Object.entries(choices))
          assert.equal(file.preferences[key].value, value);
        assert.deepEqual(readdirSync(dirname(projectPrefsPath(projectDir))), ["preferences.json"]);
      }
      const user = JSON.parse(readFileSync(userPrefsPath(), "utf8"));
      for (const [key, value] of Object.entries(choices)) {
        assert.equal(user.preferences[key].value, value);
        assert.deepEqual(user.sightings[key][value].sort(), ["project", "second-project"]);
      }
      assert.deepEqual(readdirSync(dirname(userPrefsPath())), ["preferences.json"]);
    } finally {
      for (const child of children) child.child.kill();
      await Promise.all(children.map((child) => child.closed));
    }
  });
});

for (const tier of ["project", "user"]) {
  test(`an abandoned ${tier} lock never permits an unlocked preference write`, async () => {
    await inSandbox(async ({ project }) => {
      const path = tier === "project" ? projectPrefsPath(project) : userPrefsPath();
      mkdirSync(dirname(path), { recursive: true });
      const original = JSON.stringify({ version: 1, preferences: {}, sightings: {} });
      writeFileSync(path, original);
      const lock = `${path}.lock`;
      writeFileSync(lock, "abandoned");
      const past = new Date(Date.now() - 60_000);
      utimesSync(lock, past, past);
      const record = () => recordPreference({ projectDir: project, key: "language", value: "en" });
      if (tier === "project") {
        assert.throws(record, (error) => error.code === "HF_SETTINGS_LOCKED");
        assert.equal(existsSync(userPrefsPath()), false);
      } else {
        assert.equal(record().promoted, false);
        assert.equal(
          JSON.parse(readFileSync(projectPrefsPath(project), "utf8")).preferences.language.value,
          "en",
        );
      }
      assert.equal(readFileSync(path, "utf8"), original);
      assert.equal(readFileSync(lock, "utf8"), "abandoned");
      assert.equal(existsSync(`${path}.${process.pid}.tmp`), false);
    });
  });
}
