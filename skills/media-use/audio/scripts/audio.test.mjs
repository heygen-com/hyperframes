import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSfx } from "./lib/sfx.mjs";

// Proves the relocated engine (skills/media-use/audio/) still resolves its
// bundled SFX library from the moved location — the path most likely to break
// on a subtree move. Offline (heygenOK:false), no network.

const HERE = dirname(fileURLToPath(import.meta.url));
const sfxLibDir = join(HERE, "..", "assets", "sfx"); // same offset the engine uses

test("bundled SFX library resolves from the relocated path", async () => {
  assert.ok(existsSync(join(sfxLibDir, "manifest.json")), "moved manifest is present");
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "whoosh" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 1, `expected 1 resolved cue, got anomalies: ${anomalies.join("; ")}`);
    assert.equal(sfx[0].source, "local");
    assert.match(sfx[0].file, /assets\/sfx\//);
    assert.ok(existsSync(join(dir, sfx[0].file)), "matched SFX copied into the project");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown cue is reported, not fatal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "definitely-not-a-real-sfx" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 0);
    assert.ok(anomalies.some((a) => /not in bundled library/.test(a)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a person's own file under a bundled name survives, and the cue gets the next free name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const own = join(dir, "assets", "sfx", "whoosh.mp3");
    mkdirSync(dirname(own), { recursive: true });
    writeFileSync(own, "the person's own whoosh");
    const resolve = () =>
      resolveSfx({
        cues: [{ id: "1", name: "whoosh" }],
        heygenOK: false,
        hyperframesDir: dir,
        sfxLibDir,
      });

    const first = await resolve();
    const second = await resolve();

    assert.equal(readFileSync(own, "utf8"), "the person's own whoosh");
    assert.deepEqual(
      [first, second].map(({ sfx }) => [sfx[0].file, sfx[0].source]),
      [
        ["assets/sfx/whoosh-2.mp3", "local"],
        ["assets/sfx/whoosh-2.mp3", "local"],
      ],
    );
    assert.deepEqual(
      readFileSync(join(dir, "assets/sfx/whoosh-2.mp3")),
      readFileSync(join(sfxLibDir, "whoosh.mp3")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two effects never share a file when one's name is taken by the person", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    mkdirSync(join(dir, "assets", "sfx"), { recursive: true });
    writeFileSync(join(dir, "assets", "sfx", "glitch.mp3"), "the person's own glitch");
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const query = new URL(url).searchParams.get("query");
      if (query)
        return Response.json({ data: [{ audio_url: `https://sound.test/${query}`, score: 0.6 }] });
      return new Response(`bytes of ${new URL(url).pathname}`);
    };
    try {
      const { sfx } = await resolveSfx({
        cues: [
          { id: "1", name: "glitch" },
          { id: "2", name: "glitch 2" },
          { id: "3", name: "glitch" },
        ],
        heygenOK: true,
        headers: {},
        hyperframesDir: dir,
        sfxLibDir,
      });
      assert.deepEqual(
        sfx.map(({ file }) => file),
        ["assets/sfx/glitch-2.mp3", "assets/sfx/glitch-2-2.mp3", "assets/sfx/glitch-2.mp3"],
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
