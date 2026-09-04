import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptsDir, "..");
const fixturesDir = join(scriptsDir, "fixtures", "heroless");
const makeTheme = join(scriptsDir, "make-theme.cjs");
const themeNames = readdirSync(join(skillDir, "themes"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -5))
  .sort();
const expectedThemes = [
  "anchor",
  "arcade",
  "aurora",
  "biolume",
  "brush",
  "chalkboard",
  "dossier",
  "graffiti",
  "hologram",
  "inkwater",
  "laser",
  "lastpage",
  "neonsign",
  "ordnance",
  "papercut",
  "popup",
  "ransom",
  "scoreboard",
  "spectrum",
  "stardust",
  "stomp",
  "terminal",
  "thunder",
  "transit",
  "vhs",
];
const fixtureTheme = JSON.parse(readFileSync(join(fixturesDir, "theme.json"), "utf8"));
const fixtureWords = fixtureTheme.lines.flat();

test("every embedded-caption theme compiles a sane heroless body timeline", async (t) => {
  assert.deepEqual(themeNames, expectedThemes);
  assert.equal(Object.hasOwn(fixtureTheme, "hero"), false);

  const workspace = mkdtempSync(join(tmpdir(), "embedded-captions-heroless-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  for (const themeName of themeNames) {
    await t.test(themeName, () => {
      const project = join(workspace, themeName);
      cpSync(fixturesDir, project, { recursive: true });
      writeFileSync(
        join(project, "theme.json"),
        JSON.stringify({ ...fixtureTheme, dna: themeName }),
      );

      const result = spawnSync(process.execPath, [makeTheme, project], {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

      const dna = JSON.parse(readFileSync(join(skillDir, "themes", `${themeName}.json`), "utf8"));
      const bodyPage = dna.body.layer === "bg" ? "index.html" : "rail.html";
      const generated = readFileSync(join(project, bodyPage), "utf8");
      const generatedPages = readdirSync(project)
        .filter((name) => name.endsWith(".html"))
        .map((name) => readFileSync(join(project, name), "utf8"));

      assert.match(generated, /data-composition-id="main"[^>]+data-duration="6"/s);
      assert.match(generated, /window\.__timelines\["main"\] = tl;/);
      for (const word of fixtureWords) assert.match(generated, new RegExp(`\\b${word}\\b`, "i"));
      for (const page of generatedPages) assert.doesNotMatch(page, /-99\d(?:\.\d+)?/);
    });
  }
});
