import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { carveSources, groupSourceRefusal, loadCore } from "./carve.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** A voice as `detectTracks` yields it: an id plus its raw opening tag. */
function voice(id, group) {
  const attr = group === undefined ? "" : ` data-audio-group="${group}"`;
  return { id, tag: `<audio id="${id}"${attr} src="${id}.wav"></audio>` };
}

/** An audio member as `main` describes it for the source decision. */
function member(id, group, nameKind) {
  return { id, group, nameKind };
}

/** A bed as `mediaElements` yields it: `kind` is what decides group membership. */
function bed(id, group, kind = "audio") {
  const attr = group === undefined ? "" : ` data-audio-group="${group}"`;
  return { id, kind, tag: `<${kind} id="${id}"${attr} src="${id}.mp3"></${kind}>` };
}

async function inTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "carve-test-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("voices sharing one group carve against the group, not their ids", () => {
  // SKILL.md's invariant: "A carve against more than one clip id is wrong.
  // Group the clips and carve against the group." Naming the group lets
  // membership resolve at analysis time, so a voice added later is covered.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover"), voice("vo3", "voiceover")];
  assert.deepEqual(carveSources(voices, undefined, []), ["voiceover"]);
});

test("a single grouped voice still records the group", () => {
  assert.deepEqual(carveSources([voice("vo1", "voiceover")], undefined, []), ["voiceover"]);
});

test("ungrouped voices keep their ids, so the lint rule can still say so", () => {
  // Not silently inventing a group: `audio_carve_ungrouped_sources` is the
  // right signal here, and it needs the ids to fire on.
  assert.deepEqual(carveSources([voice("vo1"), voice("vo2")], undefined, []), ["vo1", "vo2"]);
});

test("voices in DIFFERENT groups keep their ids", () => {
  // One carve cannot name two groups, and picking either would silently drop
  // the other's members from the analysis.
  const voices = [voice("vo1", "narration"), voice("vo2", "interview")];
  assert.deepEqual(carveSources(voices, undefined, []), ["vo1", "vo2"]);
});

test("a partially grouped set keeps its ids", () => {
  const voices = [voice("vo1", "voiceover"), voice("vo2")];
  assert.deepEqual(carveSources(voices, undefined, []), ["vo1", "vo2"]);
});

test("an empty group attribute is not a group", () => {
  assert.deepEqual(carveSources([voice("vo1", ""), voice("vo2", "")], undefined, []), [
    "vo1",
    "vo2",
  ]);
});

// The nine cases above pass `[]` explicitly because they predate the membership
// check and are about the bed and the group attributes alone. `members` is a
// required argument: with `[]` the `mixed` refusal cannot fire, so a default
// would let a call that forgot it return the group form and silently undo the
// widening fix — see the wiring test at the bottom of this file.

test("a bed inside the voices' group keeps clip ids, so it is never its own source", () => {
  // `resolveCarveSourceIds` expands a group to every CURRENT member, and it gets
  // no host element to exclude — so naming a group the bed belongs to puts the
  // bed in its own voice list on the next analysis, and it is carved against
  // itself. This run cannot see it (main sums the detected voices directly), so
  // the check has to happen here.
  const voices = [voice("vo1", "mix"), voice("vo2", "mix")];
  assert.deepEqual(carveSources(voices, bed("bgm", "mix"), []), ["vo1", "vo2"]);
});

test("a bed in a DIFFERENT group leaves the group form alone", () => {
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover")];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), []), ["voiceover"]);
});

test("an ungrouped bed leaves the group form alone", () => {
  assert.deepEqual(carveSources([voice("vo1", "voiceover")], bed("bgm"), []), ["voiceover"]);
});

test("a VIDEO bed is immune — group membership is audio-only", () => {
  // `data-audio-group` on a <video> is ignored by core, so expanding the group
  // can never pull this bed in and declining would be a false positive.
  const voices = [voice("vo1", "mix"), voice("vo2", "mix")];
  assert.deepEqual(carveSources(voices, bed("clip", "mix", "video"), []), ["mix"]);
});

test("an sfx member of the voices' group blocks the group form", () => {
  // The group resolves wider than the analysis: `resolveCarveSourceIds` expands
  // it to every current member and `resolveCarveVoices` keeps any audio with a
  // src, so an sfx clip sharing the voice group enters the sidechain on the next
  // analysis and ducks the bed under a whoosh. This run cannot see it — it sums
  // the voices `detectTracks` returned, which correctly excluded the sfx.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover")];
  const members = [
    member("vo1", "voiceover", "voice"),
    member("vo2", "voiceover", "voice"),
    member("whoosh", "voiceover", "sfx"),
    member("bgm", "music", "music"),
  ];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), members), ["vo1", "vo2"]);
});

test("a music member of the voices' group blocks it too", () => {
  const voices = [voice("vo1", "voiceover")];
  const members = [member("vo1", "voiceover", "voice"), member("pad", "voiceover", "music")];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), members), ["vo1"]);
});

test("a voice member this run did NOT analyse keeps the group form", () => {
  // The designed case, and the one a membership check must not break: a voice
  // that does not overlap the bed is left out of the analysis on purpose, and
  // covering it on a later analysis without editing `sources` is the entire
  // reason SKILL.md says to name the group. Refusing here would collapse the
  // group form into clip ids for every ordinary narration sequence.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover")];
  const members = [
    member("vo1", "voiceover", "voice"),
    member("vo2", "voiceover", "voice"),
    member("vo-outro", "voiceover", "voice"),
  ];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), members), ["voiceover"]);
});

test("an unclassifiable member keeps the group form", () => {
  // `unknown` is what `detectTracks` itself treats as a possible voice, so it is
  // not evidence of a non-voice member — loose in the safe direction, same as
  // detection.
  const voices = [voice("vo1", "voiceover")];
  const members = [member("vo1", "voiceover", "voice"), member("track7", "voiceover", "unknown")];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), members), ["voiceover"]);
});

test("an sfx member of a DIFFERENT group is irrelevant", () => {
  const voices = [voice("vo1", "voiceover")];
  const members = [member("vo1", "voiceover", "voice"), member("whoosh", "sfx", "sfx")];
  assert.deepEqual(carveSources(voices, bed("bgm", "music"), members), ["voiceover"]);
});

test("groupSourceRefusal names which member blocked the group, and why", () => {
  // The stderr note is built from this, so it has to carry the ids: "sources are
  // clip ids" plus `audio_carve_ungrouped_sources` reads as nonsense to an author
  // who did group their clips.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover")];
  assert.deepEqual(
    groupSourceRefusal(voices, bed("bgm", "music"), [member("whoosh", "voiceover", "sfx")]),
    { group: "voiceover", reason: "mixed", ids: ["whoosh"] },
  );
  assert.deepEqual(groupSourceRefusal(voices, bed("bgm", "voiceover"), []), {
    group: "voiceover",
    reason: "bed",
    ids: ["bgm"],
  });
  assert.equal(groupSourceRefusal(voices, bed("bgm", "music"), []), null);
});

test("the CLI still runs when invoked through a symlinked path", () => {
  // argv[1] keeps the invoked spelling while import.meta.url is the realpath, so
  // a raw compare in the entry guard skips main() and the CLI exits 0 having
  // written nothing. macOS /tmp -> /private/tmp reaches this with no symlink of
  // one's own; so does any skill install placed behind a link.
  return inTempDir((dir) => {
    const link = join(dir, "scripts-link");
    symlinkSync(SCRIPTS_DIR, link, "junction");
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [join(link, "carve.mjs")], { encoding: "utf-8" });
    } catch (error) {
      status = error.status;
      stderr = String(error.stderr);
    }
    // Reaching parseArgs is the proof main() ran at all: no args is an error, and
    // the broken guard's symptom is a silent exit 0 with no output.
    assert.equal(status, 1, `expected the usage error, got status ${status}`);
    assert.match(stderr, /--comp is required/);
  });
});

test("loadCore honours an import-only export map, as the published core has", () => {
  // The published manifest carries only `import` + `types` for these subpaths, so
  // `require.resolve` cannot resolve them at all and the fallback has to read the
  // export map itself. A fixture pins that without depending on npm.
  return inTempDir(async (dir) => {
    const pkgDir = join(dir, "node_modules", "@hyperframes", "core");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-project" }));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@hyperframes/core",
        version: "0.0.0-fixture",
        type: "module",
        exports: {
          "./package.json": "./package.json",
          "./audio-carve": { import: "./dist/audioCarve.js" },
          "./audio-fx": { import: "./dist/audioFx.js" },
        },
      }),
    );
    writeFileSync(join(pkgDir, "dist", "audioCarve.js"), 'export const marker = "carve";\n');
    writeFileSync(join(pkgDir, "dist", "audioFx.js"), 'export const marker = "fx";\n');

    const core = await loadCore(dir);
    assert.equal(core.carve.marker, "carve");
    assert.equal(core.fx.marker, "fx");
  });
});

test("members is required, so dropping it cannot silently restore the group form", () => {
  // The gap this closes: `main()` is the only code that BUILDS `members`, and no
  // test runs `main()` (the symlink test stops at the usage error, a real run
  // needs ffmpeg). With `members = []` defaulted, a refactor that dropped the
  // third argument would return the group form again with the whole suite green
  // — the same signature as the bug itself: first pass correct, persisted
  // attribute wrong, nothing red. Omitting it now throws instead.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover")];
  assert.throws(() => carveSources(voices, bed("bgm", "music")), TypeError);
  assert.throws(() => groupSourceRefusal(voices, bed("bgm", "music")), TypeError);
});
