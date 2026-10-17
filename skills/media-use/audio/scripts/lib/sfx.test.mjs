import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendRecord } from "../../../scripts/lib/manifest.mjs";
import { BUNDLED_SFX_DIR, findSoundEffect, resolveSfx } from "./sfx.mjs";

// No real network: each test serves Openverse's answers; by default it is unreachable.
const offline = async () => {
  throw new TypeError("fetch failed");
};
let serve = offline;
const UNREACHABLE =
  "Openverse unreachable (fetch failed): the remaining SFX cues use the bundled library";
globalThis.fetch = (url, init) => serve(String(url), init);

// Offline SFX resolution: the bundled library may ship manifest.json
// without the actual mp3s. The old code copied only when the source existed but
// pushed the sfx entry unconditionally — producing a dangling reference that
// silently dropped downstream ("not on disk"). These tests lock in the loud
// behavior: a present file is copied + referenced; a missing file yields an
// anomaly and NO dangling entry.

async function withDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), "hf-sfx-"));
  const libDir = join(root, "lib");
  const projDir = join(root, "proj");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(projDir, { recursive: true });
  try {
    // `await` is load-bearing: without it the finally cleanup runs before the
    // async test body resolves, deleting the temp dir mid-assertion.
    return await fn({ libDir, projDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("offline: copies and references a present bundled file", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    writeFileSync(
      join(libDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
    );
    writeFileSync(join(libDir, "whoosh.mp3"), "ID3-fake-bytes");
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "s1", name: "whoosh" }],
      hyperframesDir: projDir,
      sfxLibDir: libDir,
    });
    assert.equal(sfx.length, 1);
    assert.equal(sfx[0].file, "assets/sfx/whoosh.mp3");
    assert.equal(sfx[0].source, "local");
    assert.ok(existsSync(join(projDir, "assets/sfx/whoosh.mp3")), "mp3 copied into project");
    assert.deepEqual(anomalies, [UNREACHABLE]);
  });
});

test("offline: a matched-but-missing bundled file yields an anomaly and NO dangling entry", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    // Manifest names whoosh.mp3, but the mp3 was never shipped (the reported bug).
    writeFileSync(
      join(libDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
    );
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "s1", name: "whoosh" }],
      hyperframesDir: projDir,
      sfxLibDir: libDir,
    });
    assert.equal(sfx.length, 0, "no dangling entry for a file that was never copied");
    assert.equal(anomalies.length, 2);
    assert.match(anomalies[1], /missing from the offline library/);
    assert.ok(!existsSync(join(projDir, "assets/sfx/whoosh.mp3")), "nothing copied");
  });
});

const whooshLibrary = (libDir, withFile) => {
  writeFileSync(
    join(libDir, "manifest.json"),
    JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
  );
  if (withFile) writeFileSync(join(libDir, "whoosh.mp3"), "ID3-library-bytes");
};
const record = (projDir, source) =>
  appendRecord(projDir, { id: "sfx_001", type: "sfx", path: "assets/sfx/whoosh.mp3", source });
const bundledOnly = (libDir, projDir) =>
  resolveSfx({
    cues: [{ id: "s1", name: "whoosh" }],
    hyperframesDir: projDir,
    sfxLibDir: libDir,
  });

test("offline: the engine's earlier copy stands in for a library file this install lacks", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    whooshLibrary(libDir, false);
    mkdirSync(join(projDir, "assets/sfx"), { recursive: true });
    writeFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "engine copy");
    record(projDir, "bundled");

    const { sfx, anomalies } = await bundledOnly(libDir, projDir);

    assert.deepEqual(
      sfx.map(({ file }) => file),
      ["assets/sfx/whoosh.mp3"],
    );
    assert.deepEqual(anomalies, [UNREACHABLE]);
  });
});

test("offline: a person's file with the library's bytes stays theirs once recorded as their own", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    whooshLibrary(libDir, true);
    mkdirSync(join(projDir, "assets/sfx"), { recursive: true });
    writeFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "ID3-library-bytes");
    record(projDir, "existing");

    const { sfx } = await bundledOnly(libDir, projDir);

    assert.deepEqual(
      sfx.map(({ file }) => file),
      ["assets/sfx/whoosh-2.mp3"],
    );
    assert.equal(readFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "utf8"), "ID3-library-bytes");
  });
});

const libraryWith = (libDir, names) => {
  const manifest = {};
  for (const name of names) {
    manifest[name] = { file: `${name}.mp3`, duration: 0.5 };
    writeFileSync(join(libDir, `${name}.mp3`), `library ${name}`);
  }
  writeFileSync(join(libDir, "manifest.json"), JSON.stringify(manifest));
};
const sound = (overrides = {}) => ({
  id: "ov-1",
  title: "Swoosh",
  creator: "Ana",
  license: "by",
  foreign_landing_url: "https://freesound.org/s/1",
  url: "https://cdn.freesound.test/swoosh.mp3",
  filetype: "mp3",
  duration: 820,
  attribution: '"Swoosh" by Ana is licensed under CC BY 4.0.',
  ...overrides,
});
// Openverse stand-in: `answer(query)` gives a search response; any other URL is the sound file.
function openverse(answer) {
  const searches = [];
  serve = async (url) => {
    const query = new URL(url).searchParams.get("q");
    if (!url.startsWith("https://api.openverse.org/")) return new Response(`bytes of ${url}`);
    searches.push(query);
    return answer(query);
  };
  return searches;
}
const run = (libDir, projDir, names) =>
  resolveSfx({
    cues: names.map((name, index) => ({ id: String(index + 1), name })),
    hyperframesDir: projDir,
    sfxLibDir: libDir,
  });

test("openverse: each cue gets the best licensed sound, with its licence and credit", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    libraryWith(libDir, ["whoosh"]);
    openverse(() => Response.json({ results: [sound()] }));
    try {
      const { sfx, anomalies } = await run(libDir, projDir, ["whoosh"]);
      assert.deepEqual(sfx, [
        {
          id: "1",
          name: "whoosh",
          file: "assets/sfx/whoosh.mp3",
          source: "openverse",
          duration_s: 0.82,
          license: "by",
          credit: '"Swoosh" by Ana is licensed under CC BY 4.0.',
          offset_s: 0,
          volume: 0.35,
        },
      ]);
      assert.deepEqual(anomalies, []);
      assert.equal(
        readFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "utf8"),
        "bytes of https://cdn.freesound.test/swoosh.mp3",
      );
      assert.match(
        readFileSync(join(projDir, "assets/sfx/CREDITS.md"), "utf8"),
        /- `assets\/sfx\/whoosh\.mp3`: "Swoosh" by Ana is licensed under CC BY 4\.0\. Source: https:\/\/freesound\.org\/s\/1/,
      );
    } finally {
      serve = offline;
    }
  });
});

test("openverse: a rate limit sends this and every later cue to the bundled library, asking once", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    libraryWith(libDir, ["whoosh", "pop"]);
    const searches = openverse(() => new Response("slow down", { status: 429 }));
    try {
      const { sfx, anomalies } = await run(libDir, projDir, ["whoosh", "pop"]);
      assert.deepEqual(searches, ["whoosh"]);
      assert.deepEqual(
        sfx.map(({ file, source }) => [file, source]),
        [
          ["assets/sfx/whoosh.mp3", "local"],
          ["assets/sfx/pop.mp3", "local"],
        ],
      );
      assert.equal(readFileSync(join(projDir, "assets/sfx/pop.mp3"), "utf8"), "library pop");
      assert.deepEqual(anomalies, [
        "Openverse rate limit reached (HTTP 429): the remaining SFX cues use the bundled library",
      ]);
    } finally {
      serve = offline;
    }
  });
});

test("openverse: a cue with no licensed match falls back to the bundled library alone", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    libraryWith(libDir, ["pop"]);
    const searches = openverse((query) =>
      Response.json({ results: query === "pop" ? [sound({ license: "by-nc" })] : [sound()] }),
    );
    try {
      const { sfx } = await run(libDir, projDir, ["pop", "swoosh"]);
      assert.deepEqual(searches, ["pop", "swoosh"]);
      assert.deepEqual(
        sfx.map(({ file, source }) => [file, source]),
        [
          ["assets/sfx/pop.mp3", "local"],
          ["assets/sfx/swoosh.mp3", "openverse"],
        ],
      );
    } finally {
      serve = offline;
    }
  });
});

test("openverse: a failed download falls back to the bundled file with an anomaly", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    libraryWith(libDir, ["whoosh"]);
    serve = async (url) =>
      url.startsWith("https://api.openverse.org/")
        ? Response.json({ results: [sound()] })
        : new Response("gone", { status: 404 });
    try {
      const { sfx, anomalies } = await run(libDir, projDir, ["whoosh"]);
      assert.deepEqual(
        sfx.map(({ file, source }) => [file, source]),
        [["assets/sfx/whoosh.mp3", "local"]],
      );
      assert.match(anomalies[0], /Openverse download failed — download HTTP 404/);
    } finally {
      serve = offline;
    }
  });
});

test("openverse: one effect named in two lines is searched and downloaded once", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    libraryWith(libDir, []);
    const searches = openverse(() => Response.json({ results: [sound({ license: "cc0" })] }));
    try {
      const { sfx } = await run(libDir, projDir, ["whoosh", "whoosh"]);
      assert.deepEqual(searches, ["whoosh"]);
      assert.deepEqual(
        sfx.map(({ id, file }) => [id, file]),
        [
          ["1", "assets/sfx/whoosh.mp3"],
          ["2", "assets/sfx/whoosh.mp3"],
        ],
      );
      assert.equal(
        existsSync(join(projDir, "assets/sfx/CREDITS.md")),
        false,
        "CC0 needs no credit",
      );
    } finally {
      serve = offline;
    }
  });
});

test("findSoundEffect: a host gets the saved file, licence, credit and duration for one query", async () => {
  await withDirs(async ({ projDir }) => {
    const searches = openverse(() => Response.json({ results: [sound()] }));
    try {
      assert.deepEqual(await findSoundEffect("whoosh", { hyperframesDir: projDir }), {
        sound: {
          file: "assets/sfx/whoosh.mp3",
          source: "openverse",
          duration_s: 0.82,
          license: "by",
          credit: '"Swoosh" by Ana is licensed under CC BY 4.0.',
        },
        anomalies: [],
      });
      assert.deepEqual(searches, ["whoosh"]);
    } finally {
      serve = offline;
    }
  });
});

test("findSoundEffect: offline, the skill's own bundled library answers", async () => {
  await withDirs(async ({ projDir }) => {
    const { sound, anomalies } = await findSoundEffect("whoosh", { hyperframesDir: projDir });
    assert.deepEqual(sound, {
      file: "assets/sfx/whoosh.mp3",
      source: "local",
      duration_s: sound.duration_s,
    });
    assert.deepEqual(
      readFileSync(join(projDir, sound.file)),
      readFileSync(join(BUNDLED_SFX_DIR, "whoosh.mp3")),
    );
    assert.deepEqual(anomalies, [UNREACHABLE]);
    assert.equal(
      (await findSoundEffect("no such sound at all", { hyperframesDir: projDir })).sound,
      null,
    );
  });
});
