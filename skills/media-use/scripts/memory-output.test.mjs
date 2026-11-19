import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scriptsDir = new URL(".", import.meta.url).pathname;
const HOSTILE = "x\x1b]52;c;aGk=\x07\x1b[2J";
const SHOWN = "x\\x1b]52;c;aGk=\\x07\\x1b[2J";

function run(script, args, home) {
  return execFileSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HYPERFRAMES_MEDIA_HOME: home },
  });
}

function assertEscaped(output) {
  assert.ok(output.includes(SHOWN), output);
  for (const raw of ["\x1b", "\x07"]) assert.ok(!output.includes(raw), JSON.stringify(output));
}

function withProject(fn) {
  const root = mkdtempSync(join(tmpdir(), "media-use-memory-output-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, ".media/recipes/promo"), { recursive: true });
  writeFileSync(join(project, "frame.md"), "# Frame spec\n");
  writeFileSync(
    join(project, ".media/recipes/promo/recipe.json"),
    JSON.stringify({
      name: "promo",
      version: 1,
      workflow: `launch-${HOSTILE}`,
      approved_at: "2026-11-18T00:00:00Z",
      destination: `feed-${HOSTILE}`,
    }),
  );
  writeFileSync(join(project, ".media/recipes/promo/frame.md"), "# Frame spec\n");
  writeFileSync(join(project, ".media/recipes/promo/storyboard-skeleton.md"), "## Frame 1\n");
  writeFileSync(
    join(project, ".media/preferences.json"),
    JSON.stringify({
      version: 1,
      preferences: {
        destination: { value: `feed-${HOSTILE}`, confirmed_in: [`proj-${HOSTILE}`] },
      },
    }),
  );
  try {
    fn({ project, home });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("recipe list and use print recipe.json text with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    assertEscaped(run("recipe.mjs", ["list", "--hyperframes", project], home));
    const used = run("recipe.mjs", ["use", "--hyperframes", project, "--name", "promo"], home);
    assertEscaped(used);
    assert.match(used, /destination: feed-x\\x1b/);
  });
});

test("recipe --json output keeps the stored value as it is", () => {
  withProject(({ project, home }) => {
    const list = JSON.parse(run("recipe.mjs", ["list", "--hyperframes", project, "--json"], home));
    assert.equal(list[0].workflow, `launch-${HOSTILE}`);
  });
});

test("prefs get prints remembered values with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const shown = run("prefs.mjs", ["get", "--hyperframes", project], home);
    assertEscaped(shown);
    assert.match(shown, /confirmed in proj-x\\x1b/);
  });
});

test("prefs record echoes the recorded value with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const shown = run(
      "prefs.mjs",
      ["record", "--hyperframes", project, "--key", "aspect", "--value", `16:9${HOSTILE}`],
      home,
    );
    assertEscaped(shown);
  });
});

test("a failing recipe command prints its error with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const other = join(project, ".media/recipes/other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "recipe.json"), JSON.stringify({ name: `other-${HOSTILE}` }));
    assert.throws(
      () => run("recipe.mjs", ["use", "--hyperframes", project, "--name", "nope"], home),
      (err) => {
        assertEscaped(String(err.stderr));
        return err.status === 1;
      },
    );
  });
});
