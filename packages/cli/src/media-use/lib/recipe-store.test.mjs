import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  freezeRecipe,
  listRecipes,
  readRegularFile,
  skeletonizeBrief,
  skeletonizeStoryboard,
  slugifyRecipeName,
  useRecipe,
} from "./recipe-store.mjs";
import { recordPreference } from "./prefs-store.mjs";

const STORYBOARD = `---
format: 1080x1080
message: "Ship a launch video in an afternoon"
arc: Hook → Problem → Solution
audience: indie devs on X
mode: collaborative
music: upbeat tech
---

## Frame 1 — Hook

- scene: Big type punches in
- duration: 3s
- transition_in: cut
- status: animated
- voiceover: "Ship a launch video in an afternoon."
- src: compositions/frames/01-hook.html

Open cold on the promise. This is the thesis.

## Frame 2 — Proof

- duration: 4s
- transition_in: crossfade
- status: animated
- asset_candidates: dashboard.png
- src: compositions/frames/02-proof.html

Real dashboard, real numbers.
Second prose line to collapse.

## Video direction

Punchy, one accent color, hard cuts on the beat.
`;

const BRIEF = `---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Ship a launch video in an afternoon"
audience: indie devs on X
destination: x-feed
aspect: 1080x1080
language: en
length: 60s
angle: feature-reveal
---

## Intent

Sell the afternoon-launch promise to indie devs.

## Assets

- public/dashboard.png — the real dashboard, proof beat.

## Notes

- No stock-photo aesthetics.
`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "mu-recipes-"));
  const home = join(root, "home");
  const project = join(root, "my-launch");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "frame.md"), "# Frame spec\nbackground: #101014\n");
  writeFileSync(join(project, "STORYBOARD.md"), STORYBOARD);
  process.env.HYPERFRAMES_MEDIA_HOME = home;
  return { root, home, project };
}

function restoreEnv(saved) {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

function withSandbox(fn) {
  const savedEnv = { ...process.env };
  const box = sandbox();
  try {
    fn(box);
  } finally {
    restoreEnv(savedEnv);
    rmSync(box.root, { recursive: true, force: true });
  }
}

test("slugifyRecipeName normalizes and rejects empty", () => {
  assert.equal(slugifyRecipeName("Weekly Changelog!"), "weekly-changelog");
  assert.equal(slugifyRecipeName("  pr_reveal  "), "pr-reveal");
  assert.throws(() => slugifyRecipeName("!!!"));
});

test("skeletonize keeps structure, resets status, blanks content", () => {
  const skeleton = skeletonizeStoryboard(STORYBOARD);
  // Structure kept.
  assert.match(skeleton, /format: 1080x1080/);
  assert.match(skeleton, /arc: Hook → Problem → Solution/);
  assert.match(skeleton, /music: upbeat tech/);
  assert.match(skeleton, /- duration: 3s/);
  assert.match(skeleton, /- src: compositions\/frames\/01-hook\.html/);
  assert.match(skeleton, /## Video direction/);
  assert.match(skeleton, /hard cuts on the beat/);
  // Statuses reset.
  assert.equal((skeleton.match(/- status: outline/g) ?? []).length, 2);
  assert.doesNotMatch(skeleton, /animated/);
  // Content blanked.
  assert.doesNotMatch(skeleton, /message:/);
  assert.doesNotMatch(skeleton, /audience:/);
  assert.doesNotMatch(skeleton, /mode:/);
  assert.doesNotMatch(skeleton, /voiceover/);
  assert.doesNotMatch(skeleton, /asset_candidates/);
  assert.doesNotMatch(skeleton, /thesis/);
  assert.doesNotMatch(skeleton, /Real dashboard/);
  assert.match(skeleton, /<fill in: this video's content for the "Hook" beat/);
  assert.match(skeleton, /<fill in: this video's content for the "Proof" beat/);
});

test("skeletonizeBrief keeps reusable keys, drops run-shape, blanks body sections", () => {
  const skeleton = skeletonizeBrief(BRIEF);
  // Reusable frontmatter kept.
  assert.match(skeleton, /workflow: product-launch-video/);
  assert.match(skeleton, /destination: x-feed/);
  assert.match(skeleton, /aspect: 1080x1080/);
  assert.match(skeleton, /length: 60s/);
  assert.match(skeleton, /angle: feature-reveal/);
  // Run-shape and content keys dropped.
  assert.doesNotMatch(skeleton, /^flow:/m);
  assert.doesNotMatch(skeleton, /^storyboard:/m);
  assert.doesNotMatch(skeleton, /^message:/m);
  assert.doesNotMatch(skeleton, /^audience:/m);
  // Body sections kept as headings, prose blanked to placeholders.
  assert.match(skeleton, /## Intent/);
  assert.match(skeleton, /## Assets/);
  assert.match(skeleton, /<fill in: this video's intent/);
  assert.match(skeleton, /<fill in: this video's assets/);
  assert.doesNotMatch(skeleton, /afternoon-launch promise/);
  assert.doesNotMatch(skeleton, /dashboard\.png/);
});

test("freeze writes the folder, manifest record, and user-tier copy", () => {
  withSandbox(({ project, home }) => {
    recordPreference({ projectDir: project, key: "destination", value: "x-feed" });
    recordPreference({
      projectDir: project,
      key: "style_preset",
      value: "pin-and-paper",
      workflow: "product-launch-video",
    });
    const frozen = freezeRecipe({
      projectDir: project,
      name: "Weekly Launch",
      workflow: "product-launch-video",
      blocks: ["data-chart"],
    });
    assert.equal(frozen.slug, "weekly-launch");
    assert.equal(frozen.version, 1);

    const dir = join(project, ".media/recipes/weekly-launch");
    const recipe = JSON.parse(readFileSync(join(dir, "recipe.json"), "utf8"));
    assert.equal(recipe.workflow, "product-launch-video");
    assert.equal(recipe.destination, "x-feed");
    assert.equal(recipe.style_preset, "pin-and-paper");
    assert.deepEqual(recipe.blocks, ["data-chart"]);
    assert.ok(existsSync(join(dir, "frame.md")));
    assert.match(readFileSync(join(dir, "storyboard-skeleton.md"), "utf8"), /- status: outline/);

    const manifest = readFileSync(join(project, ".media/manifest.jsonl"), "utf8");
    assert.match(manifest, /"type":"recipe"/);
    assert.match(manifest, /"entity":"weekly-launch"/);

    assert.ok(existsSync(join(home, ".media/recipes/weekly-launch/recipe.json")));
  });
});

test("freeze with a BRIEF.md carries the brief skeleton; use hands its path back", () => {
  withSandbox(({ project, root }) => {
    writeFileSync(join(project, "BRIEF.md"), BRIEF);
    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });
    assert.equal(frozen.briefSkeleton, true);
    const skeleton = readFileSync(join(project, ".media/recipes/promo/brief-skeleton.md"), "utf8");
    assert.match(skeleton, /destination: x-feed/);
    assert.doesNotMatch(skeleton, /^flow:/m);

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const used = useRecipe({ projectDir: fresh, name: "promo" });
    assert.equal(used.briefSkeletonPath, ".media/recipes/promo/brief-skeleton.md");
    assert.ok(existsSync(join(fresh, ".media/recipes/promo/brief-skeleton.md")));
  });
});

test("freeze without a BRIEF.md degrades: no skeleton, use returns no path", () => {
  withSandbox(({ project, root }) => {
    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });
    assert.equal(frozen.briefSkeleton, false);
    assert.ok(!existsSync(join(project, ".media/recipes/promo/brief-skeleton.md")));

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const used = useRecipe({ projectDir: fresh, name: "promo" });
    assert.equal(used.briefSkeletonPath, undefined);
  });
});

test("freeze takes the workflow from BRIEF.md over a contradicting flag", () => {
  withSandbox(({ project }) => {
    writeFileSync(
      join(project, "BRIEF.md"),
      BRIEF.replace("workflow: product-launch-video", "workflow: general-video"),
    );
    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "faceless-explainer",
    });
    assert.equal(frozen.workflow, "general-video");
    assert.equal(frozen.workflowOverridden, true);
    const recipe = JSON.parse(
      readFileSync(join(project, ".media/recipes/promo/recipe.json"), "utf8"),
    );
    assert.equal(recipe.workflow, "general-video");
  });
});

test("freeze without BRIEF.md falls back to --workflow; with neither it refuses", () => {
  withSandbox(({ project }) => {
    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });
    assert.equal(frozen.workflow, "product-launch-video");
    assert.equal(frozen.workflowOverridden, false);
    assert.throws(() => freezeRecipe({ projectDir: project, name: "other" }), /no workflow found/);
  });
});

test("freeze finds a legacy bare style_preset record; the scoped key wins over it", () => {
  withSandbox(({ project }) => {
    writeFileSync(join(project, "BRIEF.md"), BRIEF);
    // A record made before the store required workflow scoping.
    mkdirSync(join(project, ".media"), { recursive: true });
    writeFileSync(
      join(project, ".media/preferences.json"),
      JSON.stringify({
        version: 1,
        preferences: {
          style_preset: {
            value: "source-paper-flowchart",
            confirmed_in: ["my-launch"],
            updated_at: "2026-07-15T00:00:00.000Z",
          },
        },
        sightings: {},
      }),
    );
    freezeRecipe({ projectDir: project, name: "promo" });
    const legacy = JSON.parse(
      readFileSync(join(project, ".media/recipes/promo/recipe.json"), "utf8"),
    );
    assert.equal(legacy.style_preset, "source-paper-flowchart");

    recordPreference({
      projectDir: project,
      key: "style_preset",
      value: "pin-and-paper",
      workflow: "product-launch-video",
    });
    freezeRecipe({ projectDir: project, name: "promo" });
    const scoped = JSON.parse(
      readFileSync(join(project, ".media/recipes/promo/recipe.json"), "utf8"),
    );
    assert.equal(scoped.style_preset, "pin-and-paper");
  });
});

test("re-freezing bumps the version and archives the old folder", () => {
  withSandbox(({ project }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    const again = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });
    assert.equal(again.version, 2);
    assert.ok(existsSync(join(project, ".media/recipes/promo@v1/recipe.json")));
    const current = JSON.parse(
      readFileSync(join(project, ".media/recipes/promo/recipe.json"), "utf8"),
    );
    assert.equal(current.version, 2);
  });
});

test("re-freezing never builds the archive path from a non-integer recipe.json version", () => {
  for (const version of ["1/../../../../victim", "/../../../../victim", 1.5, -3, null]) {
    withSandbox(({ project, root }) => {
      const victim = join(root, "victim");
      mkdirSync(victim, { recursive: true });
      writeFileSync(join(victim, "keep.txt"), "outside the project");
      const recipes = join(project, ".media/recipes");
      mkdirSync(join(recipes, "promo"), { recursive: true });
      // A received project can ship the folder the crafted path walks through, and the real
      // v1 archive a fallback to version 1 would otherwise have replaced.
      mkdirSync(join(recipes, "promo@v1"), { recursive: true });
      writeFileSync(join(recipes, "promo@v1/recipe.json"), '{"name":"promo","version":1}');
      mkdirSync(join(recipes, "promo@v"), { recursive: true });
      writeFileSync(
        join(recipes, "promo/recipe.json"),
        JSON.stringify({ name: "promo", version, workflow: "product-launch-video" }),
      );

      const frozen = freezeRecipe({
        projectDir: project,
        name: "promo",
        workflow: "product-launch-video",
      });

      assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "outside the project");
      assert.ok(!existsSync(join(victim, "recipe.json")), `version ${JSON.stringify(version)}`);
      assert.equal(
        readFileSync(join(recipes, "promo@v1/recipe.json"), "utf8"),
        '{"name":"promo","version":1}',
      );
      assert.equal(frozen.version, 3);
      const archived = JSON.parse(readFileSync(join(recipes, "promo@v2/recipe.json"), "utf8"));
      assert.deepEqual(archived.version, version);
    });
  }
});

test("re-freezing never replaces an archive already on disk", () => {
  withSandbox(({ project }) => {
    const recipes = join(project, ".media/recipes");
    mkdirSync(join(recipes, "promo"), { recursive: true });
    mkdirSync(join(recipes, "promo@v1"), { recursive: true });
    mkdirSync(join(recipes, "promo@v4"), { recursive: true });
    writeFileSync(join(recipes, "promo@v1/keep.txt"), "first approval");
    writeFileSync(join(recipes, "promo@v4/keep.txt"), "fourth approval");
    writeFileSync(
      join(recipes, "promo/recipe.json"),
      JSON.stringify({ name: "promo", version: 1, workflow: "product-launch-video" }),
    );

    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });

    assert.equal(readFileSync(join(recipes, "promo@v1/keep.txt"), "utf8"), "first approval");
    assert.equal(readFileSync(join(recipes, "promo@v4/keep.txt"), "utf8"), "fourth approval");
    assert.equal(
      JSON.parse(readFileSync(join(recipes, "promo@v5/recipe.json"), "utf8")).version,
      1,
    );
    assert.equal(frozen.version, 6);
  });
});

test("re-freezing refuses, before moving anything, when no safe version number is left", () => {
  for (const [version, archive] of [
    [Number.MAX_SAFE_INTEGER, undefined],
    ["1/../victim", `promo@v${Number.MAX_SAFE_INTEGER}`],
  ]) {
    withSandbox(({ project }) => {
      const recipes = join(project, ".media/recipes");
      mkdirSync(join(recipes, "promo"), { recursive: true });
      if (archive) mkdirSync(join(recipes, archive), { recursive: true });
      const current = JSON.stringify({ name: "promo", version, workflow: "product-launch-video" });
      writeFileSync(join(recipes, "promo/recipe.json"), current);
      const before = readdirSync(recipes).sort();

      assert.throws(
        () =>
          freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" }),
        /no version number left/,
      );
      assert.equal(readFileSync(join(recipes, "promo/recipe.json"), "utf8"), current);
      assert.deepEqual(readdirSync(recipes).sort(), before);
    });
  }
});

test("re-freezing without a brief does not import the previous version's brief", () => {
  withSandbox(({ project, root }) => {
    writeFileSync(join(project, "BRIEF.md"), BRIEF);
    freezeRecipe({ projectDir: project, name: "promo" });

    rmSync(join(project, "BRIEF.md"));
    const frozen = freezeRecipe({
      projectDir: project,
      name: "promo",
      workflow: "product-launch-video",
    });
    assert.equal(frozen.version, 2);
    assert.equal(frozen.briefSkeleton, false);
    assert.ok(existsSync(join(project, ".media/recipes/promo@v1/brief-skeleton.md")));

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const used = useRecipe({ projectDir: fresh, name: "promo" });
    assert.equal(used.recipe.version, 2);
    assert.equal(used.briefSkeletonPath, undefined);
    assert.ok(!existsSync(join(fresh, ".media/recipes/promo/brief-skeleton.md")));
  });
});

test("list merges tiers (project wins), filters by workflow, skips archives", () => {
  withSandbox(({ project, root }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    freezeRecipe({ projectDir: project, name: "explainer", workflow: "faceless-explainer" });

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const all = listRecipes({ projectDir: fresh });
    assert.deepEqual(all.map((r) => r.source).sort(), ["user", "user"]);
    assert.equal(all.find((r) => r.name === "promo").version, 2);

    const filtered = listRecipes({ projectDir: fresh, workflow: "faceless-explainer" });
    assert.deepEqual(
      filtered.map((r) => r.name),
      ["explainer"],
    );
  });
});

test("use imports from the user tier into a fresh project and copies frame.md", () => {
  withSandbox(({ project, root }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const used = useRecipe({ projectDir: fresh, name: "Promo" });
    assert.equal(used.recipe.name, "promo");
    assert.equal(used.skeletonPath, ".media/recipes/promo/storyboard-skeleton.md");
    assert.ok(existsSync(join(fresh, "frame.md")));
    assert.ok(existsSync(join(fresh, ".media/recipes/promo/storyboard-skeleton.md")));
    assert.match(
      readFileSync(join(fresh, ".media/manifest.jsonl"), "utf8"),
      /"imported_from":"user-tier"/,
    );
  });
});

test("use with an unknown name lists what exists", () => {
  withSandbox(({ project }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    assert.throws(
      () => useRecipe({ projectDir: project, name: "nope" }),
      /no recipe named "nope" \(known: promo\)/,
    );
  });
});

const RECIPE_FILE_NAMES = [
  "recipe.json",
  "frame.md",
  "storyboard-skeleton.md",
  "brief-skeleton.md",
];

/** A file outside the project with known content, and a link to it under each recipe file name. */
function plantRecipeLinks(root, dir) {
  const target = join(root, "outside.txt");
  writeFileSync(target, "keep me\n");
  mkdirSync(dir, { recursive: true });
  for (const name of RECIPE_FILE_NAMES) symlinkSync(target, join(dir, name));
  return target;
}

for (const recipeJson of ["missing", "unparseable"]) {
  test(`freeze replaces links in a recipe folder whose recipe.json is ${recipeJson}`, () => {
    withSandbox(({ project, root, home }) => {
      writeFileSync(join(project, "BRIEF.md"), BRIEF);
      const dir = join(project, ".media/recipes/promo");
      const target = plantRecipeLinks(root, dir);
      if (recipeJson === "missing") rmSync(join(dir, "recipe.json"));
      writeFileSync(join(dir, "leftover.sh"), "echo planted\n");

      const frozen = freezeRecipe({ projectDir: project, name: "promo" });
      assert.equal(frozen.version, 1);
      assert.equal(readFileSync(target, "utf8"), "keep me\n");
      for (const name of RECIPE_FILE_NAMES) {
        assert.ok(lstatSync(join(dir, name)).isFile(), `${name} is a regular file`);
        assert.ok(lstatSync(join(home, ".media/recipes/promo", name)).isFile());
      }
      assert.equal(JSON.parse(readFileSync(join(dir, "recipe.json"), "utf8")).name, "promo");
      assert.deepEqual(
        readdirSync(join(home, ".media/recipes/promo")).sort(),
        [...RECIPE_FILE_NAMES].sort(),
      );
    });
  });
}

test("freeze without a BRIEF.md removes a planted brief-skeleton link instead of keeping it", () => {
  withSandbox(({ project, root, home }) => {
    const dir = join(project, ".media/recipes/promo");
    const target = plantRecipeLinks(root, dir);
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    assert.equal(readFileSync(target, "utf8"), "keep me\n");
    assert.equal(lstatSync(join(dir, "brief-skeleton.md"), { throwIfNoEntry: false }), undefined);
    assert.ok(!existsSync(join(home, ".media/recipes/promo/brief-skeleton.md")));
  });
});

for (const linked of [".media", ".media/recipes", ".media/recipes/promo"]) {
  test(`freeze refuses, with nothing written, when ${linked} is a link`, () => {
    withSandbox(({ project, root, home }) => {
      const outside = join(root, "outside-dir");
      mkdirSync(outside);
      const parent = join(project, linked, "..");
      mkdirSync(parent, { recursive: true });
      symlinkSync(outside, join(project, linked));
      assert.throws(
        () =>
          freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" }),
        /is a link; nothing was written through it/,
      );
      assert.deepEqual(readdirSync(outside), []);
      assert.ok(!existsSync(join(home, ".media/recipes/promo")));
    });
  });
}

/** Every file under `dir`, read as text; an empty list when `dir` is missing. */
function textsUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((path) => lstatSync(path).isFile())
    .map((path) => readFileSync(path, "utf8"));
}

for (const source of ["frame.md", "STORYBOARD.md", "BRIEF.md"]) {
  test(`freeze refuses a ${source} that links outside the project, copying nothing`, () => {
    withSandbox(({ project, root, home }) => {
      freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
      const secret = join(root, "secret.txt");
      writeFileSync(secret, "---\nworkflow: product-launch-video\n---\nTOP-SECRET-TOKEN\n");
      rmSync(join(project, source), { force: true });
      symlinkSync(secret, join(project, source));

      assert.throws(
        () =>
          freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" }),
        /is a link or not a regular file; nothing was frozen/,
      );
      const recipes = [join(project, ".media/recipes"), join(home, ".media/recipes")];
      for (const text of recipes.flatMap(textsUnder)) assert.doesNotMatch(text, /TOP-SECRET/);
      assert.deepEqual(readdirSync(join(project, ".media/recipes")), ["promo"]);
    });
  });
}

test("freeze refuses a frame.md that is not a regular file", () => {
  withSandbox(({ project, home }) => {
    rmSync(join(project, "frame.md"));
    mkdirSync(join(project, "frame.md"));
    assert.throws(
      () => freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" }),
      /is a link or not a regular file; nothing was frozen/,
    );
    assert.ok(!existsSync(join(project, ".media/recipes/promo")));
    assert.ok(!existsSync(join(home, ".media/recipes/promo")));
  });
});

test("use imports only regular recipe files from the user tier, never links or leftovers", () => {
  withSandbox(({ project, root, home }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    const userDir = join(home, ".media/recipes/promo");
    const target = join(root, "secret.txt");
    writeFileSync(target, "secret\n");
    symlinkSync(target, join(userDir, "brief-skeleton.md"));
    writeFileSync(join(userDir, "leftover.sh"), "echo planted\n");

    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const used = useRecipe({ projectDir: fresh, name: "promo" });
    assert.equal(used.briefSkeletonPath, undefined);
    assert.deepEqual(readdirSync(join(fresh, ".media/recipes/promo")).sort(), [
      "frame.md",
      "recipe.json",
      "storyboard-skeleton.md",
    ]);
  });
});

test("use replaces a frame.md link in the project instead of writing through it", () => {
  withSandbox(({ project, root }) => {
    freezeRecipe({ projectDir: project, name: "promo", workflow: "product-launch-video" });
    const fresh = join(root, "fresh-project");
    mkdirSync(fresh, { recursive: true });
    const target = join(root, "outside.txt");
    writeFileSync(target, "keep me\n");
    symlinkSync(target, join(fresh, "frame.md"));

    useRecipe({ projectDir: fresh, name: "promo" });
    assert.equal(readFileSync(target, "utf8"), "keep me\n");
    assert.ok(lstatSync(join(fresh, "frame.md")).isFile());
    assert.match(readFileSync(join(fresh, "frame.md"), "utf8"), /background: #101014/);
  });
});

test("use refuses a recipe whose frame.md is a link, so no file is read through it", () => {
  withSandbox(({ project, root }) => {
    const dir = join(project, ".media/recipes/promo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "recipe.json"), JSON.stringify({ name: "promo", version: 1 }));
    const target = join(root, "secret.txt");
    writeFileSync(target, "secret\n");
    symlinkSync(target, join(dir, "frame.md"));

    assert.throws(
      () => useRecipe({ projectDir: project, name: "promo" }),
      /a link or not a regular file/,
    );
    assert.equal(
      readFileSync(join(project, "frame.md"), "utf8"),
      "# Frame spec\nbackground: #101014\n",
    );
  });
});

test("readRegularFile refuses a link even without O_NOFOLLOW, as on Windows", () => {
  withSandbox(({ root }) => {
    const target = join(root, "secret.txt");
    writeFileSync(target, "secret\n");
    const link = join(root, "frame.md");
    symlinkSync(target, link);
    assert.equal(readRegularFile(link, 0), undefined);
    assert.equal(readRegularFile(link), undefined);
    assert.equal(readRegularFile(target, 0).toString(), "secret\n");
    assert.equal(readRegularFile(join(root, "missing.md"), 0), undefined);
  });
});

test(
  "readRegularFile refuses a FIFO without blocking on it",
  { skip: process.platform === "win32" },
  () => {
    withSandbox(({ root }) => {
      const fifo = join(root, "frame.md");
      execFileSync("mkfifo", [fifo]);
      assert.equal(readRegularFile(fifo), undefined);
    });
  },
);
