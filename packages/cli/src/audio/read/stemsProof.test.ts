import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";

const { describeAccess } = vi.hoisted(() => ({ describeAccess: vi.fn() }));
vi.mock("./describe.js", async (original) => ({
  ...(await original<typeof import("./describe.js")>()),
  describeAccess,
}));

import { readAudio } from "./read.js";
import { cachedStems, recordStems } from "./stems.js";

const RATE = 22_050;
const dir = mkdtempSync(join(tmpdir(), "hf-audio-stems-proof-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  describeAccess.mockReset();
});

function wav(path: string, seconds: number, fill: (t: number) => number): string {
  const frames = Math.round(seconds * RATE);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(fill(i / RATE) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

const voiced = (t: number) => (t >= 0.5 && t < 2.5 ? 0.3 * Math.sin(2 * Math.PI * 180 * t) : 0);
const hum = (t: number) => 0.08 * Math.sin(2 * Math.PI * 261.63 * t);
const STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"];

/** A project holding a recording and a well-formed stems folder for it, as one could arrive with the project. */
function projectWithStems(name: string, stemFile: (stemDir: string) => string = () => "bed.wav") {
  const project = join(dir, name);
  const cacheDir = join(project, ".hyperframes", "read-audio");
  const path = wav(join(dir, `${name}.wav`), 3, (t) => voiced(t) + hum(t));
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  const stemDir = join(cacheDir, "stems", sha.slice(0, 12));
  mkdirSync(stemDir, { recursive: true });
  wav(join(stemDir, "vocals.wav"), 3, voiced);
  wav(join(stemDir, "bed.wav"), 3, hum);
  const other = stemFile(stemDir);
  const names = Object.fromEntries(
    STEMS.map((stem) => [
      stem,
      stem === "vocals" ? "vocals.wav" : stem === "other" ? other : "bed.wav",
    ]),
  );
  writeFileSync(join(stemDir, "stems.json"), JSON.stringify(names));
  const own = () => recordStems(stemDir, ["stems.json", ...new Set(Object.values(names))]);
  return { path, cacheDir, stemDir, own };
}

describe.skipIf(!findFfBinary("ffmpeg") || !findFfBinary("ffprobe"))("audio --read stems", () => {
  it("ignores a stems folder that arrived with the project, and reads it once this install wrote it", async () => {
    const { path, cacheDir, stemDir, own } = projectWithStems("planted");
    expect(cachedStems(stemDir)).toBeNull();
    const { analysis } = await readAudio(path, "planted.wav", { cacheDir });
    expect(analysis.separation).toBe("mix");
    expect(analysis.warnings[0]).toContain("not separated into stems");
    own();
    expect(Object.keys(cachedStems(stemDir) ?? {})).toEqual(STEMS);
    writeFileSync(join(stemDir, "bed.wav"), readFileSync(join(stemDir, "vocals.wav")));
    expect(cachedStems(stemDir)).toBeNull();
  });

  it.each(["local", "fast"] as const)(
    "at %s quality, reads its own stems with no request and no credential",
    async (quality) => {
      vi.stubEnv("HEYGEN_API_KEY", "test-key");
      const fetch = vi.spyOn(globalThis, "fetch");
      const { path, cacheDir, own } = projectWithStems(`own-${quality}`);
      own();
      const { analysis } = await readAudio(path, `own-${quality}.wav`, { cacheDir, quality });
      expect(analysis.separation).not.toBe("mix");
      expect(analysis.description ?? null).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(describeAccess).not.toHaveBeenCalled();
    },
  );

  it("refuses a stem that is a playlist before it is decoded, mixed or sent", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const fetch = vi.spyOn(globalThis, "fetch");
    const outside = wav(join(dir, "outside.wav"), 3, hum);
    const { path, cacheDir, stemDir, own } = projectWithStems("playlist", (stemDir) => {
      writeFileSync(
        join(stemDir, "other.m3u8"),
        `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n${outside}\n#EXT-X-ENDLIST\n`,
      );
      return "other.m3u8";
    });
    own();
    await expect(readAudio(path, "playlist.wav", { cacheDir, quality: "best" })).rejects.toThrow(
      /whitelist/,
    );
    expect(existsSync(join(stemDir, "no-vocals.wav"))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(describeAccess).not.toHaveBeenCalled();
  });
});
