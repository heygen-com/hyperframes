import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  freezeRecipe,
  listRecipes,
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
  process.env.HOME = home;
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
