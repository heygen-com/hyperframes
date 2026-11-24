import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STRENGTH,
  carveSources,
  groupSourceRefusal,
  mediaSource,
  parseArgs,
} from "./carve.mjs";

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

test("carve never loads @hyperframes/core from the composition's project", () => {
  // A received project is untrusted: a core planted in its node_modules must not run.
  return inTempDir(async (dir) => {
    const pkgDir = join(dir, "node_modules", "@hyperframes", "core");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "received-project" }));
    const planted =
      'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./RAN", import.meta.url), "");\n';
    writeFileSync(join(pkgDir, "planted.mjs"), planted);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@hyperframes/core",
        type: "module",
        exports: {
          "./package.json": "./package.json",
          "./audio-carve": "./planted.mjs",
          "./audio-fx": "./planted.mjs",
        },
      }),
    );
    writeFileSync(join(dir, "index.html"), "<html><body></body></html>");

    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [join(SCRIPTS_DIR, "carve.mjs"), "--comp", "index.html", "--dry-run"],
        {
          cwd: dir,
          stdio: "pipe",
        },
      );
    } catch (error) {
      stderr = String(error.stderr);
    }
    assert.equal(existsSync(join(pkgDir, "RAN")), false, "the project's @hyperframes/core ran");
    assert.match(
      stderr,
      /media in the composition/,
      "carve stopped before it read the composition",
    );
  });
});

test("the bundled core exports every function carve.mjs calls", async () => {
  const source = readFileSync(join(SCRIPTS_DIR, "carve.mjs"), "utf-8");
  const called = new Set([...source.matchAll(/carveApi\s*\.\s*(\w+)/g)].map((m) => m[1]));
  const bundle = await import("./lib/audio-carve.mjs");
  assert.ok(called.size > 0);
  assert.deepEqual(
    [...called].filter((name) => typeof bundle[name] !== "function"),
    [],
  );
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

test("the default strength is 0.8, and --strength still overrides it", () => {
  // 0.25 left the bed audibly fighting the voice on narrated builds; a carve at
  // the default has to already be a finished mix. Pinned so it cannot drift back
  // unnoticed — core pins its own DEFAULT_CARVE the same way.
  assert.equal(DEFAULT_STRENGTH, 0.8);
  assert.equal(parseArgs(["--comp", "x.html"]).strength, 0.8);
  assert.equal(parseArgs(["--comp", "x.html", "--strength", "0.25"]).strength, 0.25);
});

test("mediaSource accepts a regular file inside the composition's folder, by its real path", () =>
  inTempDir((dir) => {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "vo.wav"), "x");
    writeFileSync(join(dir, "bed.mp3"), "x");
    const real = realpathSync(dir);
    assert.equal(mediaSource(dir, "assets/vo.wav"), join(real, "assets", "vo.wav"));
    assert.equal(mediaSource(dir, "./bed.mp3"), join(real, "bed.mp3"));
    assert.equal(mediaSource(dir, "assets/../bed.mp3"), join(real, "bed.mp3"));
  }));

test("mediaSource refuses every name that leaves the folder, before opening it", () =>
  inTempDir((dir) => {
    const project = join(dir, "project");
    mkdirSync(project);
    const outside = join(dir, "secret.wav");
    writeFileSync(outside, "x");
    symlinkSync(outside, join(project, "linked.wav"));
    for (const src of [
      outside,
      "../secret.wav",
      "//attacker.example/share/x.mp3",
      "\\\\attacker.example\\share\\x.mp3",
      "C:secret.wav",
      "C:\\secret.wav",
      "file:///etc/hosts",
      "http://attacker.example/x.mp3",
      "linked.wav",
    ]) {
      assert.throws(() => mediaSource(project, src), /outside the composition's folder/, src);
    }
  }));

test("mediaSource refuses private files, folders, missing files and ffmpeg patterns", () =>
  inTempDir((dir) => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "folder.wav"));
    for (const name of [".env", ".git/config", "id_rsa.wav", "take%d.png"]) {
      writeFileSync(join(dir, name), "x");
    }
    assert.throws(() => mediaSource(dir, ".env"), /private project file/);
    assert.throws(() => mediaSource(dir, ".git/config"), /private project file/);
    assert.throws(() => mediaSource(dir, "folder.wav"), /not a file in the project/);
    assert.throws(() => mediaSource(dir, "missing.wav"), /not a file in the project/);
    assert.throws(() => mediaSource(dir, "take%d.png"), /pattern of other files/);
  }));

/** A composition with a music bed and one narration track, both named by `src`. */
function writeComposition(dir, voiceSrc, bedSrc = "bed.wav") {
  writeFileSync(
    join(dir, "index.html"),
    `<audio id="music-bed" src="${bedSrc}" data-start="0"></audio>\n` +
      `<audio id="narration" src="${voiceSrc}" data-start="0"></audio>\n`,
  );
}

const runCarve = (cwd, env = process.env) =>
  spawnSync(process.execPath, [join(SCRIPTS_DIR, "carve.mjs"), "--comp", "index.html"], {
    cwd,
    env,
    encoding: "utf8",
  });

test(
  "a composition naming an outside file or a UNC host stops before any ffmpeg process starts",
  { skip: process.platform === "win32" && "the stand-in ffmpeg is a shell script" },
  () =>
    inTempDir((dir) => {
      const bin = join(dir, "bin");
      const ran = join(dir, "ffmpeg-ran");
      mkdirSync(bin);
      for (const tool of ["ffmpeg", "ffprobe"]) {
        writeFileSync(join(bin, tool), `#!/bin/sh\necho "$0 $*" >> "${ran}"\nexit 1\n`, {
          mode: 0o755,
        });
      }
      const project = join(dir, "project");
      mkdirSync(project);
      writeFileSync(join(project, "bed.wav"), "x");
      writeFileSync(join(dir, "secret.wav"), "x");
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
      for (const src of ["../secret.wav", "//attacker.example/share/x.mp3"]) {
        writeComposition(project, src);
        const before = readFileSync(join(project, "index.html"), "utf8");
        const run = runCarve(project, env);
        assert.equal(run.status, 1, run.stderr);
        assert.match(run.stderr, /outside the composition's folder/);
        assert.equal(existsSync(ran), false, `ffmpeg ran for ${src}`);
        assert.equal(readFileSync(join(project, "index.html"), "utf8"), before);
      }
    }),
);

const tone = (path, seconds = 2, frequency = 440) =>
  spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=${seconds}`,
    ].concat([path]),
    { encoding: "utf8" },
  );

test("a playlist saved under a media name inside the project is refused and opens nothing it names", () =>
  inTempDir((dir) => {
    const project = join(dir, "project");
    mkdirSync(project);
    const outside = join(dir, "outside.ts");
    const made = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", outside],
      { encoding: "utf8" },
    );
    assert.equal(made.status, 0, made.stderr);
    assert.equal(tone(join(project, "bed.wav")).status, 0);
    writeFileSync(
      join(project, "narration.m3u8"),
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${outside}\n#EXT-X-ENDLIST\n`,
    );
    writeComposition(project, "narration.m3u8");
    const before = readFileSync(join(project, "index.html"), "utf8");
    const run = runCarve(project);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /list that points at other files|cannot read it as media/);
    assert.equal(readFileSync(join(project, "index.html"), "utf8"), before);
  }));

test("a composition whose media are files in its folder still carves", () =>
  inTempDir((dir) => {
    mkdirSync(join(dir, "assets"));
    assert.equal(tone(join(dir, "bed.wav"), 3, 220).status, 0);
    assert.equal(tone(join(dir, "assets", "narration.m4a"), 3, 1000).status, 0);
    writeComposition(dir, "assets/narration.m4a");
    const run = runCarve(dir);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /wrote index.html/);
    assert.match(readFileSync(join(dir, "index.html"), "utf8"), /data-fx-chain=/);
  }));
