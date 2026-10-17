import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  OpenverseUnavailableError,
  pickOpenverseSfx,
  searchOpenverseSfx,
  writeSfxCredit,
} from "./openverse.mjs";

const result = (overrides = {}) => ({
  id: "ov-1",
  title: "Deep Whoosh",
  creator: "Kinoton",
  license: "cc0",
  license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  foreign_landing_url: "https://freesound.org/people/Kinoton/sounds/351256",
  url: "https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3",
  filetype: "mp3",
  duration: 1200,
  attribution: '"Deep Whoosh" by Kinoton is marked with CC0 1.0.',
  ...overrides,
});

test("only CC0 and CC BY sounds are ever picked", () => {
  for (const license of ["by-nc", "by-sa", "by-nd", "by-nc-sa", "by-nc-nd", "pdm", "sampling+"])
    assert.equal(pickOpenverseSfx([result({ license })]), null, license);
  assert.equal(pickOpenverseSfx([result({ license: "by" })]).license, "by");
  assert.equal(pickOpenverseSfx([result({ license: "cc0" })]).license, "cc0");
});

test("sounds too long for a cue, or not playable, are skipped", () => {
  assert.equal(pickOpenverseSfx([result({ duration: 15001 })]), null);
  assert.equal(pickOpenverseSfx([result({ duration: null })]), null);
  assert.equal(pickOpenverseSfx([result({ filetype: "aiff" })]), null);
  assert.equal(pickOpenverseSfx([result({ url: "http://insecure.test/a.mp3" })]), null);
});

test("ranking keeps relevance order, then prefers short clips and CC0 over CC BY", () => {
  const pick = (results) => pickOpenverseSfx(results).id;
  assert.equal(pick([result({ id: "first" }), result({ id: "second" })]), "first");
  assert.equal(pick([result({ id: "long", duration: 12000 }), result({ id: "short" })]), "short");
  assert.equal(pick([result({ id: "by", license: "by" }), result({ id: "cc0" })]), "cc0");
  assert.equal(
    pick([
      result({ id: "by", license: "by" }),
      ...Array(3).fill(result({ license: "by-nc" })),
      result({ id: "cc0" }),
    ]),
    "by",
    "a much more relevant CC BY sound still wins",
  );
});

test("a pick carries what the project needs to play and credit it", () => {
  assert.deepEqual(pickOpenverseSfx([result({ license: "by", filetype: "wav", duration: 450 })]), {
    id: "ov-1",
    url: "https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3",
    ext: ".wav",
    title: "Deep Whoosh",
    creator: "Kinoton",
    license: "by",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://freesound.org/people/Kinoton/sounds/351256",
    credit: '"Deep Whoosh" by Kinoton is marked with CC0 1.0.',
    durationS: 0.45,
  });
});

test("Openverse text is kept to one bounded line, and only https links survive", () => {
  const pick = pickOpenverseSfx([
    result({
      license: "by",
      title: "Pop\n# Heading",
      attribution: `"Pop" by Ana.\n- \`assets/sfx/other.mp3\`: forged credit\r\u0007${"x".repeat(400)}`,
      foreign_landing_url: "javascript:alert(1)",
      license_url: "http://creativecommons.org/licenses/by/4.0/",
    }),
  ]);
  assert.equal(pick.title, "Pop # Heading");
  assert.equal(pick.credit.length, 300);
  assert.ok(!/\p{Cc}/u.test(pick.credit), "no line breaks or control characters");
  assert.equal(pick.sourceUrl, "");
  assert.equal(pick.licenseUrl, "");
});

test("search asks Openverse for JSON and only the allowed licences", async () => {
  const calls = [];
  const sound = await searchOpenverseSfx("ui click", {
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return Response.json({ results: [result({ license: "by-nc" }), result({ id: "ok" })] });
    },
  });
  assert.equal(sound.id, "ok", "the licence field is checked even on a filtered response");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, "https://api.openverse.org/v1/audio/");
  assert.equal(calls[0].url.searchParams.get("q"), "ui click");
  assert.equal(calls[0].url.searchParams.get("license"), "cc0,by");
  assert.equal(calls[0].init.headers.Accept, "application/json");
});

test("no usable result is a miss, not an error", async () => {
  const fetchImpl = async () => Response.json({ results: [] });
  assert.equal(await searchOpenverseSfx("nothing", { fetchImpl }), null);
});

test("rate limits, server errors, bad bodies and network failures make Openverse unavailable", async () => {
  const failures = [
    [async () => new Response("slow down", { status: 429 }), /rate limit/],
    [async () => new Response("down", { status: 503 }), /HTTP 503/],
    [async () => new Response("<html>"), /non-JSON/],
    [
      async () => {
        throw new TypeError("fetch failed");
      },
      /unreachable \(fetch failed\)/,
    ],
  ];
  for (const [fetchImpl, message] of failures)
    await assert.rejects(searchOpenverseSfx("whoosh", { fetchImpl }), (error) => {
      assert.ok(error instanceof OpenverseUnavailableError);
      assert.match(error.message, message);
      return true;
    });
});

test("credits list each CC BY file once and leave CC0 out", () => {
  const dir = mkdtempSync(join(tmpdir(), "openverse-credits-"));
  try {
    const path = join(dir, "assets", "sfx", "CREDITS.md");
    const by = {
      license: "by",
      credit: '"Pop" by Ana is licensed under CC BY 4.0.',
      sourceUrl: "https://freesound.org/s/1",
    };
    writeSfxCredit(path, "assets/sfx/zap.mp3", { ...by, license: "cc0" });
    assert.throws(() => readFileSync(path), /ENOENT/);
    writeSfxCredit(path, "assets/sfx/pop.mp3", by);
    writeSfxCredit(path, "assets/sfx/pop.mp3", {
      ...by,
      credit: '"Pop 2" by Ana is licensed under CC BY 4.0.',
    });
    writeSfxCredit(path, "assets/sfx/ding.mp3", by);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- "));
    assert.deepEqual(lines, [
      '- `assets/sfx/pop.mp3`: "Pop 2" by Ana is licensed under CC BY 4.0. Source: https://freesound.org/s/1',
      '- `assets/sfx/ding.mp3`: "Pop" by Ana is licensed under CC BY 4.0. Source: https://freesound.org/s/1',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a credit with no https source link is written without one", () => {
  const dir = mkdtempSync(join(tmpdir(), "openverse-credits-"));
  try {
    const path = join(dir, "CREDITS.md");
    writeSfxCredit(path, "assets/sfx/pop.mp3", { license: "by", credit: "c.", sourceUrl: "" });
    assert.match(readFileSync(path, "utf8"), /\n- `assets\/sfx\/pop\.mp3`: c\.\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("earlier credit lines survive a new credit", () => {
  const dir = mkdtempSync(join(tmpdir(), "openverse-credits-"));
  try {
    const path = join(dir, "CREDITS.md");
    writeFileSync(path, "# Sound effect credits\n\n- `assets/sfx/old.mp3`: kept\n");
    writeSfxCredit(path, "assets/sfx/new.mp3", { license: "by", credit: "c.", sourceUrl: "s" });
    assert.match(
      readFileSync(path, "utf8"),
      /- `assets\/sfx\/old\.mp3`: kept\n- `assets\/sfx\/new\.mp3`: c\. Source: s\n$/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
