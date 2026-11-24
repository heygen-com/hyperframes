import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFfprobeBinary } from "./ffmpegBinaries.js";
import {
  assertMediaPayload,
  fingerprintElementId,
  isNotImagePayload,
  isNotMediaPayload,
  NotMediaPayloadError,
  playlistLeavesItsFolder,
} from "./notMediaPayload.js";

function writeFixture(name: string, contents: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, contents);
  return filePath;
}

function writeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-playlist-tree-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return join(dir, Object.keys(files)[0]!);
}

/** The list at `list`, with a media file at each name beside it. */
function withBeside(list: string, ...names: string[]): string {
  for (const name of names) {
    mkdirSync(join(list, "..", name, ".."), { recursive: true });
    writeFileSync(join(list, "..", name), "media");
  }
  return list;
}

describe("isNotMediaPayload", () => {
  it.each([
    ["doctype", "<!DOCTYPE html>\n<html><body></body></html>"],
    ["bare html tag, uppercase", "<HTML><body>hi</body></HTML>"],
    [
      "xml prolog",
      '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    // The prolog-less form is the common minified SVG shape, and the one a
    // `<!doctype|<html|<?xml` prefix allowlist misses.
    ["prolog-less svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
    // How a media URL most often downloads as XML in production: an expired
    // signed URL or an ACL change, served as a 200 with an S3 error body.
    ["s3 error document", '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'],
    ["comment first", "<!-- generated -->\n<!DOCTYPE html>"],
    // Replicate answers a dead asset this way, and a gateway in front of it can
    // relay the body with a 200 — the shape a `<` -only check misses.
    ["json object error body", '{"detail": "requested file not found"}'],
    ["json array body", '[{"error": "gone"}]'],
  ])("detects %s", async (_label, contents) => {
    expect(await isNotMediaPayload(writeFixture("payload", contents))).toBe(true);
  });

  it("detects a document behind a UTF-8 BOM and leading whitespace", async () => {
    const filePath = writeFixture(
      "bom.html",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("\n  \t<!doctype html><html></html>"),
      ]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects a document behind a leading NUL run", async () => {
    const filePath = writeFixture(
      "nul.html",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), Buffer.from("<html>x</html>")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it.each([
    ["little-endian", [0xff, 0xfe]],
    ["big-endian", [0xfe, 0xff]],
  ])("detects UTF-16 %s markup", async (_label, bom) => {
    // UTF-16 interleaves NULs between ASCII bytes, so a utf8-decoded prefix
    // comparison sees replacement characters and misses it entirely.
    const body = Buffer.from("<html>", "utf16le");
    const bytes = _label === "little-endian" ? body : body.swap16();
    const filePath = writeFixture("utf16.html", Buffer.concat([Buffer.from(bom), bytes]));
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects nothing when padding overruns the sniff window", async () => {
    const filePath = writeFixture("padded.html", `${" ".repeat(600)}<!doctype html>`);
    // 600 bytes of padding overruns the 512-byte sniff window, so the verdict
    // has to be "unknown" (false) rather than a misread — asserted here so the
    // window size is a deliberate, visible bound rather than an accident.
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it.each([
    ["mp4 / ftypmp42", [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]],
    ["matroska / webm EBML", [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]],
    ["ogg", [0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]],
    ["riff / wav", [0x52, 0x49, 0x46, 0x46, 0x24, 0x08]],
    ["mpeg-ts", [0x47, 0x40, 0x00, 0x10]],
    ["flac", [0x66, 0x4c, 0x61, 0x43, 0x00]],
    ["mp3 / ID3", [0x49, 0x44, 0x33, 0x03, 0x00]],
    ["adts aac", [0xff, 0xf1, 0x50, 0x80]],
    ["mpeg-ps", [0x00, 0x00, 0x01, 0xba]],
  ])("does not flag a %s container", async (_label, bytes) => {
    expect(await isNotMediaPayload(writeFixture("clip.bin", Buffer.from(bytes)))).toBe(false);
  });

  function box(type: string, size: number, body = Buffer.alloc(Math.max(size - 8, 0))): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(size, 0);
    header.write(type, 4, "latin1");
    return Buffer.concat([header, body]);
  }

  function largeBox(type: string, size: bigint, body: Buffer): Buffer {
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1, 0);
    header.write(type, 4, "latin1");
    header.writeBigUInt64BE(size, 8);
    return Buffer.concat([header, body]);
  }

  it.each([
    ["<", 0x3c, "ftyp"],
    ["#", 0x23, "ftyp"],
    ["{", 0x7b, "styp"],
    ["[", 0x5b, "ftyp"],
    ["space", 0x20, "ftyp"],
    ["newline", 0x0a, "styp"],
  ])("does not flag an mp4 whose box size reads as %s", async (_label, size, type) => {
    const mp4 = Buffer.concat([box(type, size), box("moov", 16)]);
    expect(await isNotMediaPayload(writeFixture("clip.mp4", mp4))).toBe(false);
  });

  it.each([
    ["leading padding", [box("free", 0x3c), box("ftyp", 0x3c), box("moov", 16)]],
    ["an extension box after ftyp", [box("ftyp", 0x3c), box("uuid", 24), box("moov", 16)]],
    ["a QuickTime movie opening with wide", [box("wide", 8), box("mdat", 0x3c), box("moov", 16)]],
    ["a QuickTime metadata box", [box("ftyp", 0x3c), box("\xa9nam", 12), box("moov", 16)]],
  ])("does not flag an mp4 with %s", async (_label, boxes) => {
    expect(await isNotMediaPayload(writeFixture("clip.mp4", Buffer.concat(boxes)))).toBe(false);
  });

  it("does not flag an mp4 whose second box runs to the end or has a 64-bit size", async () => {
    const toEnd = Buffer.concat([box("ftyp", 0x3c), box("mdat", 0), Buffer.from("<html>")]);
    const large = Buffer.concat([box("ftyp", 0x3c), largeBox("mdat", 24n, Buffer.alloc(8))]);
    expect(await isNotMediaPayload(writeFixture("to-end.mp4", toEnd))).toBe(false);
    expect(await isNotMediaPayload(writeFixture("large.mp4", large))).toBe(false);
  });

  it.each([
    ["a box larger than the file", box("ftyp", 0x3c, Buffer.from("<html><body>hi</body></html>"))],
    [
      "a box followed by text",
      Buffer.concat([box("ftyp", 0x3c), Buffer.from("<!doctype html><html></html>")]),
    ],
    [
      "a second box whose 64-bit size runs past the file",
      Buffer.concat([box("ftyp", 0x3c), largeBox("mdat", 1n << 40n, Buffer.from("<html>"))]),
    ],
    ["a box type no mp4 opens with", box("html", 0x3c, Buffer.from("<?xml?>".padEnd(52)))],
    ["an XML manifest behind NULs", Buffer.from('\0\0\0<?xml version="1.0"?><MPD/>', "latin1")],
  ])("still detects a document shaped like %s", async (_label, bytes) => {
    expect(await isNotMediaPayload(writeFixture("fake.mp4", bytes))).toBe(true);
  });

  it("does not flag a container that merely contains a document byte further in", async () => {
    const filePath = writeFixture(
      "not-html.bin",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0xba]), Buffer.from("<html later on")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it("does not flag an empty file", async () => {
    expect(await isNotMediaPayload(writeFixture("empty.bin", ""))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the path is a directory", async () => {
    // `existsSync` passes for a directory, so callers reach the sniff with one.
    // The read fails EISDIR; classifying rather than propagating keeps the real
    // probe's own error as the one the caller sees.
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-dir-"));
    mkdirSync(join(dir, "assets"));
    expect(await isNotMediaPayload(join(dir, "assets"))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-gone-"));
    expect(await isNotMediaPayload(join(dir, "evicted.mp4"))).toBe(false);
  });
});

const MPD = '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>';
// One ID3v2.4 tag with a 4-byte body, as ffmpeg skips it before it probes.
const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);

describe("a file behind an ID3 tag", () => {
  it("is refused as media when markup follows the tag", async () => {
    const file = writeFixture("tagged.mp3", Buffer.concat([id3, Buffer.from(MPD)]));
    expect(await isNotMediaPayload(file)).toBe(true);
    expect(await isNotImagePayload(file)).toBe(true);
  });

  it("is kept as media when an MPEG frame follows the tag", async () => {
    const file = writeFixture("song.mp3", Buffer.concat([id3, Buffer.from([0xff, 0xfb, 0x90, 0])]));
    expect(await isNotMediaPayload(file)).toBe(false);
  });
});

describe("isNotImagePayload", () => {
  it.each([
    ["a manifest", MPD, true],
    ["json", '{"error": "gone"}', true],
    [
      "an svg behind a prolog, comment and doctype",
      `<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [<!ENTITY a "b">]>\n<SVG viewBox="0 0 1 1"/>`,
      false,
    ],
    ["an svg whose comment outruns the sniff window", `<!--${"x".repeat(70_000)}--><svg/>`, false],
    [
      "a utf-16 svg",
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<svg/>", "utf16le")]),
      false,
    ],
    ["an svg with a long doctype subset", `<!DOCTYPE svg [${"][".repeat(30_000)}]><svg/>`, false],
    ["a png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), false],
  ])("for %s", async (_label, contents, refused) => {
    expect(await isNotImagePayload(writeFixture("image", contents))).toBe(refused);
  });
});

describe("assertMediaPayload", () => {
  it("throws NotMediaPayloadError carrying routing metadata and a hashed element key", async () => {
    const filePath = writeFixture("nested.html", "<!DOCTYPE html><html></html>");

    let caught: unknown;
    try {
      await assertMediaPayload(filePath, "aroll-scene-3");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotMediaPayloadError);
    const error = caught as NotMediaPayloadError;
    expect(error.code).toBe("NOT_MEDIA_PAYLOAD");
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(error.elementFingerprints).toEqual([fingerprintElementId("aroll-scene-3")]);
    expect(error.message).toContain(fingerprintElementId("aroll-scene-3"));
  });

  it("names both possible causes and leaks neither the src nor the payload bytes", async () => {
    // `error.message` is forwarded to API clients over SSE/JSON, so a
    // per-tenant CDN path or a token in the payload's first bytes must not
    // reach it — and an on-call engineer must not be pointed at the authoring
    // bug when a 403 error page is the actual cause.
    const filePath = writeFixture(
      "interstitial.html",
      '<!DOCTYPE html><html data-request-token="tok_9fA3xQ7pLz">',
    );

    const error = await assertMediaPayload(
      filePath,
      "https://cdn.example.com/tenants/acme-corp/projects/secret-q4/streamed-preview.html",
    ).catch((caught: unknown) => caught as NotMediaPayloadError);

    expect(error.message).not.toContain("acme-corp");
    expect(error.message).not.toContain("secret-q4");
    expect(error.message).not.toContain("cdn.example.com");
    expect(error.message).not.toContain("tok_9fA3xQ7pLz");
    expect(error.message).toContain("unresolved");
    expect(error.message).toContain("success status");
  });

  it("resolves for a real container", async () => {
    const filePath = writeFixture("clip.mp4", Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]));
    await expect(assertMediaPayload(filePath, "v1")).resolves.toBeUndefined();
  });

  it("caps the fingerprint list so the message stays bounded", async () => {
    const error = new NotMediaPayloadError(
      Array.from({ length: 12 }, (_unused, index) => fingerprintElementId(`el-${index}`)),
    );
    expect(error.message).toContain("+4");
    expect(error.message.length).toBeLessThan(500);
  });
});

describe("playlistLeavesItsFolder", () => {
  const hls = (...lines: string[]) =>
    ["#EXTM3U", "#EXT-X-TARGETDURATION:1", ...lines, "#EXT-X-ENDLIST"].join("\n");
  const concat = (entry: string) => `ffconcat version 1.0\nfile ${entry}\n`;

  it.each([
    ["an absolute segment", hls("#EXTINF:1,", "/var/renders/other/out.mp4")],
    ["a segment above its folder", hls("#EXTINF:1,", "../other/out.mp4")],
    ["an encoded escape", hls("#EXTINF:1,", "%2e%2e/other/out.mp4")],
    ["a file: segment", hls("#EXTINF:1,", "file:///var/renders/other/out.ts")],
    [
      "a key outside its folder",
      hls('#EXT-X-KEY:METHOD=AES-128,URI="/etc/key.bin"', "#EXTINF:1,", "seg.ts"),
    ],
    ["a Windows drive path", hls("#EXTINF:1,", "C:\\renders\\out.mp4")],
    ["an absolute concat entry", concat("'/var/renders/other/out.mp4'")],
    ["a concat entry above its folder", concat("../other/out.mp4")],
    ["a list too long to read whole", hls("#EXTINF:1,\nseg.ts\n".repeat(700_000))],
  ])("refuses %s", async (_name, contents) => {
    const file = writeFixture("clip.m3u8", contents);
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(await isNotMediaPayload(file)).toBe(true);
  });

  it.each([
    ["a git segment", hls("#EXTINF:1,", ".git/objects/seg.ts")],
    ["an encoded app record", hls("#EXTINF:1,", "%2ehyperframes/agent-handoff.ts")],
    ["a key file", hls('#EXT-X-KEY:METHOD=AES-128,URI="keys/id_rsa"', "#EXTINF:1,", "seg.ts")],
    ["a credential folder in a map", hls('#EXT-X-MAP:URI=".ssh/init.mp4"', "#EXTINF:1,", "seg.ts")],
    ["a concat entry in agent state", concat("'.claude/part.mp4'")],
    ["an env file", concat(".env")],
  ])("refuses %s that stays in its folder", async (_name, contents) => {
    const file = writeFixture("clip.m3u8", contents);
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(await isNotMediaPayload(file)).toBe(true);
  });

  it("refuses a list whose nested entry is a manifest or is not there", async () => {
    const list = "ffconcat version 1.0\nfile manifest.mpd\n";
    expect(
      await playlistLeavesItsFolder(writeTree({ "clip.mp4": list, "manifest.mpd": MPD })),
    ).toBe(true);
    expect(await playlistLeavesItsFolder(writeTree({ "clip.mp4": list }))).toBe(true);
    const encrypted = hls('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', "#EXTINF:1,", "seg.ts");
    expect(
      await playlistLeavesItsFolder(
        writeTree({ "clip.m3u8": encrypted, "key.bin": "<\x01\x02", "seg.ts": "{\x00" }),
      ),
    ).toBe(false);
  });

  it("refuses a nested list naming a private file from its own folder", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", ".git/seg.ts"),
    });
    expect(await playlistLeavesItsFolder(master)).toBe(true);
  });

  it("refuses a list whose nested list names a file outside the top folder", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "/var/renders/other/out.mp4"),
    });
    expect(await playlistLeavesItsFolder(master)).toBe(true);
  });

  it("refuses a nested list that steps above the top folder from its own", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "../../other/out.mp4"),
    });
    expect(await playlistLeavesItsFolder(master)).toBe(true);
  });

  it("refuses lists nested deeper than it reads", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      files[`l${i}.m3u8`] = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nl${i + 1}.m3u8\n`;
    files["l12.m3u8"] = hls("#EXTINF:1,", "seg.ts");
    expect(await playlistLeavesItsFolder(writeTree(files))).toBe(true);
  });

  it("keeps nested lists that stay in the top folder, cycles included", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "../seg.ts", "#EXTINF:1,", "../master.m3u8"),
      "seg.ts": "segment",
    });
    expect(await playlistLeavesItsFolder(master)).toBe(false);
  });

  it.each([
    [
      "segments beside it",
      hls("#EXTINF:1,", "seg0.ts", "#EXTINF:1,", "parts/seg1.ts"),
      ["seg0.ts", "parts/seg1.ts"],
    ],
    ["https segments", hls("#EXTINF:1,", "https://cdn.example.com/seg0.ts"), []],
    ["a concat entry beside it", concat("'part 1.mp4'"), ["part 1.mp4"]],
    ["a media file", Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]), []],
  ])("keeps %s", async (_name, contents, beside) => {
    const list = withBeside(writeFixture("clip.m3u8", contents), ...beside);
    expect(await playlistLeavesItsFolder(list)).toBe(false);
  });
});

describe("playlistLeavesItsFolder takes time linear in the list, and bounds the walk", () => {
  // Just under the size the walk reads whole, so the list is parsed rather than refused for its size.
  const FILL = 8 * 1024 * 1024 - 64;
  const segments = (...names: string[]) =>
    `#EXTM3U\n${names.map((n) => `#EXTINF:1,\n${n}\n`).join("")}`;

  it.each([
    ["an HLS line of blanks ending in one other character", `#EXTM3U\n${" ".repeat(FILL)}x\n`],
    [
      "an ffconcat file line of blanks with a lone carriage return inside",
      `ffconcat version 1.0\nfile${" ".repeat(FILL)}x\ry\n`,
    ],
  ])("refuses %s in milliseconds", async (_name, contents) => {
    const file = writeFixture("photo.png", contents);
    const started = performance.now();
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads a line as long as ffmpeg reads, and refuses one byte longer", async () => {
    // 4095 bytes is ffmpeg's line limit. A name is at most 255 bytes, so the line walks into folders that exist.
    const name = `${"./".repeat(2044)}abcd.ts`;
    const atLimit = withBeside(writeFixture("clip.m3u8", segments(name)), "abcd.ts");
    expect(await playlistLeavesItsFolder(atLimit)).toBe(false);
    const over = writeFixture("clip.m3u8", segments(`${"a".repeat(4093)}.ts`));
    expect(await playlistLeavesItsFolder(over)).toBe(true);
    const concatOver = writeFixture(
      "clip.ffconcat",
      `ffconcat version 1.0\nfile ${"a".repeat(4091)}\n`,
    );
    expect(await playlistLeavesItsFolder(concatOver)).toBe(true);
  });

  it("refuses a walk past its entry budget, before it opens any entry", async () => {
    const names = Array.from({ length: 50_001 }, (_, i) => `s${i}.ts`);
    expect(await playlistLeavesItsFolder(writeFixture("clip.m3u8", segments(...names)))).toBe(true);
    const under = names.slice(0, 100);
    const list = withBeside(writeFixture("clip.m3u8", segments(...under)), ...under);
    expect(await playlistLeavesItsFolder(list)).toBe(false);
  });

  it("refuses a walk past its byte budget across nested lists", async () => {
    // Three nested lists of 6 MiB each: every one is readable alone, together they pass 16 MiB.
    const padding = `#${"x".repeat(4000)}\n`.repeat(Math.ceil((6 * 1024 * 1024) / 4002));
    const files: Record<string, string> = {
      "master.m3u8":
        "#EXTM3U\n" +
        ["a", "b", "c"].map((n) => `#EXT-X-STREAM-INF:BANDWIDTH=1\n${n}.m3u8\n`).join(""),
    };
    for (const n of ["a", "b", "c"]) files[`${n}.m3u8`] = `#EXTM3U\n${padding}#EXTINF:1,\nseg.ts\n`;
    files["seg.ts"] = "segment";
    expect(await playlistLeavesItsFolder(writeTree(files))).toBe(true);
    delete files["c.m3u8"];
    files["master.m3u8"] =
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1\nb.m3u8\n";
    expect(await playlistLeavesItsFolder(writeTree(files))).toBe(false);
  });
});

describe("playlistLeavesItsFolder reads an ffconcat list only as ffmpeg reads it", () => {
  const list = (body: string, ...beside: string[]) =>
    withBeside(writeFixture("clip.ffconcat", `ffconcat version 1.0\n${body}`), ...beside);

  it.each([
    ["a file line after a comment and a lone carriage return", "#\rfile ../other/out.mp4\n"],
    ["a file line after a comment and a NUL", "#\0file ../other/out.mp4\n"],
    ["a carriage return between file and the name", "  file \r\t../other/out.mp4\n"],
    ["a quote inside a bare name", "file part'.mp4' x\n"],
    ["a quoted run followed by more name", "file 'part'.mp4\n"],
    ["a backslash escape", "file part\\.mp4\n"],
    ["text after the name", "file part.mp4 ../other/out.mp4\n"],
    ["an empty name", "file ''\n"],
    ["an option line", "file part.mp4\noption safe 0\n"],
    ["an option line before any file", "option protocol_whitelist file\nfile part.mp4\n"],
    ["a name that is not there", "file gone.mp4\n"],
  ])("refuses %s", async (_name, body) => {
    const file = list(body, "part.mp4");
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(await isNotMediaPayload(file)).toBe(true);
  });

  it("refuses a name outside the folder written in each form", async () => {
    expect(await playlistLeavesItsFolder(list("file\t'../other/out.mp4'  \n"))).toBe(true);
    expect(await playlistLeavesItsFolder(list("file ../other/out.mp4\r\n"))).toBe(true);
  });

  it.each([
    ["a bare name", "file part.mp4\n"],
    ["a quoted name with a space", "file 'part 1.mp4'\n"],
    ["tabs and blanks around the name", "  file\tpart.mp4 \t\n"],
    ["CR LF line ends", "file part.mp4\r\nduration 1\r\nfile 'part 1.mp4'\r\n"],
    ["comments and other directives", "# file ../other/out.mp4\nfile part.mp4\ninpoint 0.5\n"],
    ["lines whose keyword is not file", "file'../other/out.mp4'\nfiles ../other/out.mp4\n"],
  ])("keeps %s", async (_name, body) => {
    expect(await playlistLeavesItsFolder(list(body, "part.mp4", "part 1.mp4"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a backslash in a bare name even when that name is there",
    async () => {
      expect(await playlistLeavesItsFolder(list("file a\\b.mp4\n", "a\\b.mp4"))).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps a backslash inside quotes as written, as ffmpeg does",
    async () => {
      expect(await playlistLeavesItsFolder(list("file 'a\\b.mp4'\n", "a\\b.mp4"))).toBe(false);
      expect(await playlistLeavesItsFolder(list("file 'a\\b.mp4'\n", "ab.mp4"))).toBe(true);
    },
  );
});

describe("playlistLeavesItsFolder reads entries and folders as ffmpeg resolves them", () => {
  const hls = (...lines: string[]) => ["#EXTM3U", ...lines, "#EXT-X-ENDLIST"].join("\n");
  const listIn = (folder: string, contents: string | Buffer, name = "list.m3u8"): string => {
    const dir = join(mkdtempSync(join(tmpdir(), "hf-playlist-folder-")), folder);
    mkdirSync(dir);
    writeFileSync(join(dir, name), contents);
    return join(dir, name);
  };

  it.each([
    ["a drive-relative path", hls("C:Videos\\a.mp4")],
    ["a drive-relative file name", hls("c:x.mp4")],
    ["a colon after an underscore", hls("_:x.mp4")],
    ["an encoded colon", hls("%63%3Ax.mp4")],
    ["a colon in a map URI", hls('#EXT-X-MAP:URI="c:x.mp4"', "seg.ts")],
    ["a colon in a concat entry", "ffconcat version 1.0\nfile c:x.mp4\n"],
  ])("refuses %s", async (_name, contents) => {
    const file = writeFixture("clip.m3u8", contents);
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(await isNotMediaPayload(file)).toBe(true);
  });

  it.each(process.platform === "win32" ? ["#"] : ["#", "?"])(
    "refuses a list naming a file from a folder with %s in its name",
    async (mark) => {
      const file = listIn(`sub${mark}x`, hls("seg.ts"));
      expect(await playlistLeavesItsFolder(file)).toBe(true);
      expect(await isNotMediaPayload(file)).toBe(true);
    },
  );

  it("refuses a nested list read from a folder with # in its name, and a list placed in one", async () => {
    const top = writeTree({
      "top.m3u8": hls("sub#x/inner.m3u8"),
      "sub#x/inner.m3u8": hls("seg.ts"),
    });
    expect(await playlistLeavesItsFolder(top)).toBe(true);
    const placedAt = join(tmpdir(), "sub#x", "list.m3u8");
    expect(await playlistLeavesItsFolder(writeFixture("clip.m3u8", hls("seg.ts")), placedAt)).toBe(
      true,
    );
  });

  it("keeps entries beside the list, https entries, and a media file in a folder with # in its name", async () => {
    const beside = hls("seg.ts", "sub/seg.ts", "seg#1.ts", "https://cdn.example.com/seg.ts");
    const list = withBeside(writeFixture("clip.m3u8", beside), "seg.ts", "sub/seg.ts", "seg#1.ts");
    expect(await playlistLeavesItsFolder(list)).toBe(false);
    const httpsOnly = listIn("sub#x", hls("https://cdn.example.com/a.ts"));
    expect(await playlistLeavesItsFolder(httpsOnly)).toBe(false);
    const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, ...Array(24).fill(0)]);
    expect(await isNotMediaPayload(listIn("sub#x", mp4, "clip.mp4"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "keeps a list in a folder with : in its name",
    async () => {
      expect(
        await playlistLeavesItsFolder(withBeside(listIn("c:d", hls("seg.ts")), "seg.ts")),
      ).toBe(false);
    },
  );
});

describe("playlistLeavesItsFolder reads a list as ffprobe does", () => {
  const FFPROBE_8 = /^ffprobe version n?8\./.test(
    spawnSync(getFfprobeBinary(), ["-version"], { encoding: "utf-8" }).stdout ?? "",
  );
  const head = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n";
  const tail = "#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n";
  const outside = "../outside/secret.mp4";
  // Cut at ffmpeg's 4095-byte line limit this names the outside file; whole, it walks back in.
  const cutLine = "./".repeat((4095 - outside.length) / 2) + outside + "/../../proj/seg.ts";
  // Each 0xFF is one byte to ffmpeg, so the cut lands after the outside name, not inside it.
  const tagStart = Buffer.concat([
    Buffer.from('#EXT-X-MAP:X="'),
    Buffer.alloc(40, 0xff),
    Buffer.from('",URI="'),
  ]);
  const tagPad = 4095 - tagStart.length - outside.length;
  const notUtf8Line = Buffer.concat([
    tagStart,
    Buffer.from(
      "./".repeat(Math.floor(tagPad / 2)) +
        (tagPad % 2 ? "/" : "") +
        outside +
        '/../../proj/seg.ts"',
    ),
  ]);

  it.each([
    ["a segment after a bare carriage return", `${head}#EXTINF:1,\r${outside}\n#EXT-X-ENDLIST\n`],
    ["a segment after a NUL", `${head}#EXTINF:1,\0${outside}\n#EXT-X-ENDLIST\n`],
    ["an unquoted map URI", `${head}#EXT-X-MAP:URI=${outside}\n${tail}`],
    ["a backslash-escaped map URI", `${head}#EXT-X-MAP:URI=".\\./outside/secret.mp4"\n${tail}`],
    [
      "an unquoted rendition URI",
      `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=a,NAME=a,URI=${outside}\n` +
        '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nv.m3u8\n',
    ],
    [
      "a list behind an ID3 tag",
      Buffer.concat([
        Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]),
        Buffer.from(`${head}#EXTINF:1,\n${outside}\n#EXT-X-ENDLIST\n`),
      ]),
    ],
    ["a segment line longer than ffmpeg reads", `${head}#EXTINF:1,\n${cutLine}\n#EXT-X-ENDLIST\n`],
    [
      "a long tag line with bytes that are not UTF-8",
      Buffer.concat([
        Buffer.from(head),
        notUtf8Line,
        Buffer.from("\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n"),
      ]),
    ],
  ])("refuses %s", async (_name, contents) => {
    const root = mkdtempSync(join(tmpdir(), "hf-playlist-ffprobe-"));
    mkdirSync(join(root, "proj"));
    mkdirSync(join(root, "outside"));
    writeFileSync(join(root, "outside", "secret.mp4"), "outside media");
    writeFileSync(join(root, "proj", "v.m3u8"), head + tail);
    writeFileSync(join(root, "proj", "clip.m3u8"), contents);

    expect(await playlistLeavesItsFolder(join(root, "proj", "clip.m3u8"))).toBe(true);
    if (!FFPROBE_8) return;
    const probe = spawnSync(
      getFfprobeBinary(),
      ["-loglevel", "debug", "-show_format", "--", "clip.m3u8"],
      {
        cwd: join(root, "proj"),
        encoding: "utf-8",
      },
    );
    expect(probe.stderr).toMatch(/outside\/secret\.mp4' for reading/);
  });

  it("refuses a nested name it cannot read, and one that is not there", async () => {
    const list = (entry: string) => `${head}#EXTINF:1,\n${entry}\n#EXT-X-ENDLIST\n`;
    const unreadable = writeTree({ "clip.m3u8": list("sub"), "sub/seg.ts": "segment" });
    expect(await playlistLeavesItsFolder(unreadable)).toBe(true);
    const missing = writeTree({ "clip.m3u8": list("gone.ts") });
    expect(await playlistLeavesItsFolder(missing)).toBe(true);
    const missingFolder = writeTree({ "clip.m3u8": list("gone/seg.ts") });
    expect(await playlistLeavesItsFolder(missingFolder)).toBe(true);
  });

  it.skipIf(process.platform !== "linux")(
    "reads a nested list whose name is not UTF-8 by its bytes",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hf-playlist-bytes-"));
      const name = Buffer.concat([Buffer.from("in"), Buffer.from([0xff]), Buffer.from(".m3u8")]);
      writeFileSync(Buffer.from(`${root}/${name.toString("latin1")}`, "latin1"), list(outside));
      const top = Buffer.concat([
        Buffer.from("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n"),
        name,
        Buffer.from("\n"),
      ]);
      writeFileSync(join(root, "clip.m3u8"), top);
      expect(await playlistLeavesItsFolder(join(root, "clip.m3u8"))).toBe(true);

      function list(entry: string): string {
        return `${head}#EXTINF:1,\n${entry}\n#EXT-X-ENDLIST\n`;
      }
    },
  );

  it("keeps a list with the same tags naming files beside it", async () => {
    const list = `${head}#EXT-X-MAP:URI=init.mp4\r#EXT-X-KEY:METHOD=AES-128,URI="k\\ey.bin"\r${tail}`;
    const file = withBeside(writeFixture("clip.m3u8", list), "init.mp4", "key.bin", "seg.ts");
    expect(await playlistLeavesItsFolder(file)).toBe(false);
  });

  it("refuses a file behind more ID3 tags than it skips", async () => {
    const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    const file = writeFixture(
      "clip.m3u8",
      Buffer.concat([...Array(17).fill(tag), Buffer.from(head)]),
    );
    expect(await playlistLeavesItsFolder(file)).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("a FIFO with no writer", () => {
  function fifoBeside(list?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-playlist-fifo-"));
    execFileSync("mkfifo", [join(dir, "pipe.mp4")]);
    if (list === undefined) return join(dir, "pipe.mp4");
    writeFileSync(join(dir, "clip.m3u8"), list);
    return join(dir, "clip.m3u8");
  }

  it("is refused as media without waiting for a writer", async () => {
    expect(await isNotMediaPayload(fifoBeside())).toBe(true);
  });

  it("is refused when a list names it, without waiting for a writer", async () => {
    const list = fifoBeside("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\npipe.mp4\n");
    expect(await playlistLeavesItsFolder(list)).toBe(true);
  });
});

describe("playlistLeavesItsFolder judges the name ffmpeg opens for each entry", () => {
  const FFPROBE_8 = /^ffprobe version n?8\./.test(
    spawnSync(getFfprobeBinary(), ["-version"], { encoding: "utf-8" }).stdout ?? "",
  );
  const segments = (extra = "") =>
    `#EXTM3U\n#EXT-X-TARGETDURATION:1\n${extra}#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n`;
  const kinds: [string, (name: string) => string][] = [
    [
      "segment",
      (name) => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${name}\n#EXT-X-ENDLIST\n`,
    ],
    ["variant", (name) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${name}\n`],
    [
      "rendition",
      (name) =>
        `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=a,NAME=a,URI="${name}"\n` +
        '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nv.m3u8\n',
    ],
    ["key", (name) => segments(`#EXT-X-KEY:METHOD=AES-128,URI="${name}"\n`)],
    ["map", (name) => segments(`#EXT-X-MAP:URI="${name}"\n`)],
  ];
  const uriKinds = kinds.filter(([kind]) => !["segment", "variant"].includes(kind));
  const outsideList = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${join(tmpdir(), "outside.ts")}\n#EXT-X-ENDLIST\n`;

  /** The list, a harmless file at the suffix's name beside it, and the sibling list ffmpeg opens for the suffix. */
  function withDecoy(list: string, suffix: string): string {
    const top = writeTree({ "clip.m3u8": list, "v.m3u8": segments(), "seg.ts": "media" });
    writeFileSync(join(top, "..", suffix.replace(/^%3F/i, "?")), "media");
    if (suffix.startsWith("?")) writeFileSync(`${top}${suffix}`, outsideList);
    return top;
  }

  const forms = [
    ...(process.platform === "win32" ? [] : ["?x.m3u8", "%3Fx.m3u8"]).flatMap((suffix) =>
      kinds.map(([kind, list]) => [kind, suffix, list] as const),
    ),
    ...uriKinds.flatMap(([kind, list]) => [
      [kind, "#x.m3u8", list] as const,
      [kind, "", list] as const,
    ]),
  ];

  it.each(forms)("refuses a %s entry %j with no path before it", async (_kind, suffix, list) => {
    const top = withDecoy(list(suffix), suffix || "decoy");
    expect(await playlistLeavesItsFolder(top)).toBe(true);
    expect(await isNotMediaPayload(top)).toBe(true);
    await expect(assertMediaPayload(top, "clip")).rejects.toBeInstanceOf(NotMediaPayloadError);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a segment line that trims to a query",
    async () => {
      const top = withDecoy(kinds[0]![1](" ?x.m3u8"), "?x.m3u8");
      expect(await playlistLeavesItsFolder(top)).toBe(true);
    },
  );

  it.skipIf(!FFPROBE_8 || process.platform === "win32")(
    "matches ffprobe, which opens the list's own name plus a query-only entry",
    async () => {
      const top = withDecoy(kinds[0]![1]("?x.ts"), "?x.ts");
      const probe = spawnSync(
        getFfprobeBinary(),
        ["-loglevel", "debug", "-show_format", "--", top],
        {
          encoding: "utf-8",
        },
      );
      expect(probe.stderr).toContain(`Opening '${top}?x.ts' for reading`);
    },
  );

  it.skipIf(!FFPROBE_8)("matches ffprobe on the name each kind of entry opens", async () => {
    for (const [kind, list] of kinds) {
      const name = kind === "variant" || kind === "rendition" ? "sub/in.m3u8" : `sub/${kind}.ts`;
      const top = writeTree({ "clip.m3u8": list(name), "v.m3u8": segments(), "seg.ts": "media" });
      mkdirSync(join(top, "..", "sub"), { recursive: true });
      writeFileSync(join(top, "..", "sub", "seg.ts"), "media");
      writeFileSync(join(top, "..", name), name.endsWith(".m3u8") ? segments() : "media");
      expect(await playlistLeavesItsFolder(top)).toBe(false);
      const probe = spawnSync(
        getFfprobeBinary(),
        ["-loglevel", "debug", "-show_format", "--", top],
        {
          encoding: "utf-8",
        },
      );
      expect(probe.stderr, kind).toContain(`Opening '${join(top, "..", name)}' for reading`);
    }
  });

  it("keeps a query or fragment after a name, as ffmpeg opens it beside the list", async () => {
    const names = process.platform === "win32" ? ["seg#1.ts"] : ["seg#1.ts", "seg?v=1.ts"];
    const list = withBeside(writeFixture("clip.m3u8", kinds[0]![1](names.join("\n"))), ...names);
    expect(await playlistLeavesItsFolder(list)).toBe(false);
  });
});

describe("playlistLeavesItsFolder refuses a list behind an ID3v2 tag", () => {
  const tag = (version: number, flags: number, body = 4) =>
    Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, version, 0, flags, 0, 0, 0, body]),
      Buffer.alloc(body),
    ]);
  const concat = "ffconcat version 1.0\nfile seg.mp4\n";
  const tags = [2, 3, 4, 5].flatMap((version) =>
    [0, 0x10].map((flags) => [version, flags] as const),
  );

  it.each(tags)(
    "refuses a list behind a v2.%i tag with flags %i, at the top and nested",
    async (version, flags) => {
      const tagged = Buffer.concat([
        tag(version, flags),
        Buffer.alloc(flags ? 10 : 0),
        Buffer.from(concat),
      ]);
      const top = withBeside(writeFixture("clip.mp4", tagged), "seg.mp4");
      expect(await playlistLeavesItsFolder(top)).toBe(true);
      expect(await isNotMediaPayload(top)).toBe(true);
      const root = mkdtempSync(join(tmpdir(), "hf-playlist-id3-"));
      writeFileSync(join(root, "clip.mp4"), "ffconcat version 1.0\nfile inner.mp4\n");
      writeFileSync(join(root, "inner.mp4"), tagged);
      writeFileSync(join(root, "seg.mp4"), "media");
      expect(await playlistLeavesItsFolder(join(root, "clip.mp4"))).toBe(true);
    },
  );

  it("refuses a list whose start the tag's footer flag moves", async () => {
    // A v2.3 tag with the footer flag: ffmpeg's demuxer reads the list from the tag's end, its probe 10 bytes later.
    const root = mkdtempSync(join(tmpdir(), "hf-playlist-id3-"));
    writeFileSync(join(root, "clip.mp4"), Buffer.concat([tag(3, 0x10), Buffer.from(concat)]));
    writeFileSync(join(root, "seg.mp4"), "media");
    expect(await playlistLeavesItsFolder(join(root, "clip.mp4"))).toBe(true);
  });

  it("keeps a tagged mp3 segment named by a list", async () => {
    const list = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\na.mp3\n#EXT-X-ENDLIST\n";
    const top = writeFixture("clip.m3u8", list);
    writeFileSync(
      join(top, "..", "a.mp3"),
      Buffer.concat([tag(3, 0x10), Buffer.from([0xff, 0xfb, 0x90, 0])]),
    );
    expect(await playlistLeavesItsFolder(top)).toBe(false);
  });
});
