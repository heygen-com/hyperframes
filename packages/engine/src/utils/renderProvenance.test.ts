import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";
import {
  PROVENANCE_RENDERER_NAME,
  PROVENANCE_RENDERER_TAG,
  PROVENANCE_VERSION,
  PROVENANCE_VERSION_TAG,
  readPackageVersionFrom,
  readRenderProvenance,
  renderProvenanceArgs,
} from "./renderProvenance.js";
import {
  applyFaststart,
  buildEncoderArgs,
  encodeFramesChunkedConcat,
  muxVideoWithAudio,
} from "../services/chunkEncoder.js";

/** Same probe the ffmpeg-dependent suites use: ask the binary, don't assume it. */
const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

describe("renderProvenanceArgs", () => {
  it("tags the renderer and version", () => {
    const args = renderProvenanceArgs("out.mp4");
    expect(args).toContain(`${PROVENANCE_RENDERER_TAG}=${PROVENANCE_RENDERER_NAME}`);
    expect(args).toContain(`${PROVENANCE_VERSION_TAG}=${PROVENANCE_VERSION}`);
  });

  it("carries nothing that identifies the machine or the project", () => {
    // Provenance is renderer identity only. A path, username or composition
    // name here would travel with every distributed file.
    const values = renderProvenanceArgs("/home/someone/projects/secret-launch/out.mp4")
      .filter((a) => a.includes("="))
      .join(" ");
    expect(values).not.toMatch(/secret-launch|someone|\/home\//);
  });

  it("adds use_metadata_tags for the mov-family containers only", () => {
    for (const ext of ["mp4", "mov", "m4v"]) {
      expect(renderProvenanceArgs(`out.${ext}`)).toContain("-movflags");
    }
    expect(renderProvenanceArgs("out.webm")).not.toContain("-movflags");
  });

  it("matches the container case-insensitively", () => {
    expect(renderProvenanceArgs("OUT.MP4")).toContain("-movflags");
  });

  it("uses the additive + form so it cannot clobber an earlier -movflags", () => {
    // Regression guard. A bare `use_metadata_tags` resets the flag field and
    // silently drops `+faststart` set earlier in the same command: tags still
    // probe correctly, but the moov atom moves to the end of the file. The
    // real-encode case below proves the behaviour; this pins the argument.
    const args = renderProvenanceArgs("out.mp4");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+use_metadata_tags");
  });
});

describe("readRenderProvenance", () => {
  it("reads mp4-cased tags", () => {
    expect(
      readRenderProvenance({ hyperframes_renderer: "hyperframes", hyperframes_version: "1.2.3" }),
    ).toEqual({ renderer: "hyperframes", version: "1.2.3" });
  });

  it("reads matroska-uppercased tags", () => {
    // Matroska uppercases keys on read; a case-sensitive lookup would work on
    // mp4 and miss every webm.
    expect(
      readRenderProvenance({ HYPERFRAMES_RENDERER: "hyperframes", HYPERFRAMES_VERSION: "1.2.3" }),
    ).toEqual({ renderer: "hyperframes", version: "1.2.3" });
  });

  it("returns null when there is no provenance", () => {
    expect(readRenderProvenance({ major_brand: "isom" })).toBeNull();
    expect(readRenderProvenance(undefined)).toBeNull();
  });
});

describe.skipIf(!HAS_FFMPEG)("provenance survives a real encode", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-provenance-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (args: string[]): void => {
    const res = spawnSync(getFfmpegBinary(), args, { encoding: "utf-8" });
    if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr ?? ""}`);
  };

  /** Format tags as ffprobe reports them, which is the only thing that counts. */
  const formatTags = (file: string): Record<string, string> => {
    const res = spawnSync(
      getFfprobeBinary(),
      ["-v", "error", "-show_entries", "format_tags", "-of", "json", "--", file],
      { encoding: "utf-8" },
    );
    if (res.status !== 0) throw new Error(`ffprobe failed: ${res.stderr ?? ""}`);
    const parsed = JSON.parse(res.stdout) as { format?: { tags?: Record<string, string> } };
    return parsed.format?.tags ?? {};
  };

  const source = (): string => {
    const src = join(dir, "src.mp4");
    run([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=15:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      src,
    ]);
    return src;
  };

  // The whole point of the feature: assert against the encoded file, not the
  // argument array. mp4 accepts `-metadata` for an unknown key and then
  // silently discards it, so an args-only test passes while every shipped mp4
  // carries no provenance at all.
  it.each(["mp4", "mov", "webm"])("round-trips through a real %s encode", (ext) => {
    const out = join(dir, `out.${ext}`);
    const codec = ext === "webm" ? ["-c:v", "libvpx-vp9", "-b:v", "200k"] : ["-c:v", "libx264"];
    run([
      "-v",
      "error",
      "-i",
      source(),
      ...codec,
      "-pix_fmt",
      "yuv420p",
      ...renderProvenanceArgs(out),
      "-y",
      out,
    ]);

    expect(readRenderProvenance(formatTags(out))).toEqual({
      renderer: PROVENANCE_RENDERER_NAME,
      version: PROVENANCE_VERSION,
    });
  });

  it("keeps +faststart working alongside the provenance flag", () => {
    // Guards the clobber directly: with a non-additive `use_metadata_tags` the
    // tags below still pass while the moov atom silently moves to the end.
    const out = join(dir, "faststart.mp4");
    run([
      "-v",
      "error",
      "-i",
      source(),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      ...renderProvenanceArgs(out),
      "-y",
      out,
    ]);

    expect(readRenderProvenance(formatTags(out))).not.toBeNull();

    // faststart means the moov atom precedes mdat. Read the whole file and
    // compare offsets: both atoms are always present, so a missing one would
    // mean the file is malformed rather than merely unoptimised.
    const bytes = readFileSync(out);
    const moov = bytes.indexOf("moov", 0, "latin1");
    const mdat = bytes.indexOf("mdat", 0, "latin1");
    expect(moov).toBeGreaterThan(-1);
    expect(mdat).toBeGreaterThan(-1);
    expect(moov).toBeLessThan(mdat);
  });

  // The in-process sibling of the distributed-assemble regression. This path
  // does its own concat-copy straight to the deliverable, and the concat
  // demuxer does not carry the chunks' container metadata through — so for a
  // no-audio mov (mux skipped, faststart only copies mov) the concat is the
  // last container write and the tags have to be re-asserted there. mp4 would
  // hide this: faststart re-muxes it and puts them back.
  it("survives the in-process chunked-encode concat for a no-audio mov", async () => {
    const framesDir = join(dir, "frames");
    mkdirSync(framesDir, { recursive: true });
    // 70 frames against a 30-frame chunk size gives 3 chunks, so the concat
    // step actually runs. A single chunk would skip it entirely.
    run([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=30:duration=2.34",
      "-frames:v",
      "70",
      "-start_number",
      "0",
      "-y",
      join(framesDir, "frame_%06d.png"),
    ]);

    const out = join(dir, "chunked.mov");
    const result = await encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.png",
      out,
      { fps: { num: 30, den: 1 }, width: 160, height: 120, preset: "ultrafast" },
      30,
    );

    expect(result.success).toBe(true);
    expect(readRenderProvenance(formatTags(out))).toEqual({
      renderer: PROVENANCE_RENDERER_NAME,
      version: PROVENANCE_VERSION,
    });
  }, 60_000);

  it("survives the encode -> mux -> faststart chain that produces a delivered mp4", async () => {
    // The stage that actually bites: `muxVideoWithAudio` and `applyFaststart`
    // each run their own ffmpeg over the encoder's output. Tagging only at the
    // encode stage passes an args test and still ships an mp4 with no
    // provenance, because the mux drops unknown keys on the way through.
    const encoded = join(dir, "encoded.mp4");
    run([
      "-v",
      "error",
      "-i",
      source(),
      ...buildEncoderArgs({ fps: { num: 15, den: 1 }, width: 160, height: 120 }, [], encoded),
    ]);
    expect(readRenderProvenance(formatTags(encoded))).not.toBeNull();

    const audio = join(dir, "audio.m4a");
    run([
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:a",
      "aac",
      "-y",
      audio,
    ]);

    const muxed = join(dir, "muxed.mp4");
    expect((await muxVideoWithAudio(encoded, audio, muxed)).success).toBe(true);
    expect(readRenderProvenance(formatTags(muxed))).not.toBeNull();

    const delivered = join(dir, "delivered.mp4");
    expect((await applyFaststart(muxed, delivered)).success).toBe(true);
    expect(readRenderProvenance(formatTags(delivered))).toEqual({
      renderer: PROVENANCE_RENDERER_NAME,
      version: PROVENANCE_VERSION,
    });
  });
});

describe("engine version resolution", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-provenance-version-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Lay out a package root and return a directory `depth` levels inside it. */
  const layout = (pkg: Record<string, unknown>, depth: number): string => {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    let inner = join(dir, "dist");
    for (let i = 1; i < depth; i++) inner = join(inner, `nested${i}`);
    mkdirSync(inner, { recursive: true });
    return inner;
  };

  // The regression. The CLI bundles the engine flat into `dist/cli.js`
  // (tsup `noExternal`), one directory below the package root rather than the
  // two that `src/utils/` and the published `dist/utils/` sit at. The previous
  // hardcoded `../../package.json` overshot to `node_modules/package.json`,
  // threw MODULE_NOT_FOUND, and stamped the fallback — so every render from
  // every published CLI carried `hyperframes_version=0.0.0-dev`. Nothing in
  // the suite exercised this depth, which is exactly why it shipped.
  it("resolves the version from the bundled CLI layout (one level deep)", () => {
    const bundled = layout({ name: "hyperframes", version: "1.2.3" }, 1);
    expect(readPackageVersionFrom(bundled)).toBe("1.2.3");
  });

  it("resolves the version from the published engine layout (two levels deep)", () => {
    const published = layout({ name: "@hyperframes/engine", version: "1.2.3" }, 2);
    expect(readPackageVersionFrom(published)).toBe("1.2.3");
  });

  it("resolves from any depth, because the depth is what broke", () => {
    for (const depth of [1, 2, 3, 5]) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      expect(readPackageVersionFrom(layout({ name: "hyperframes", version: "9.9.9" }, depth))).toBe(
        "9.9.9",
      );
    }
  });

  // Reporting someone else's version number under a `hyperframes_version` key
  // is worse than admitting we don't know.
  it("refuses a non-HyperFrames package rather than stamping its version", () => {
    const foreign = layout({ name: "someones-app", version: "9.9.9" }, 1);
    expect(readPackageVersionFrom(foreign)).toBe("0.0.0-dev");
  });

  // `hyperframes-monorepo` is this repo's own private root: a prefix match
  // would accept it and stamp a version it does not even have.
  it("matches the package name exactly, not by prefix", () => {
    const monorepo = layout({ name: "hyperframes-monorepo", private: true }, 1);
    expect(readPackageVersionFrom(monorepo)).toBe("0.0.0-dev");
  });

  it("falls back instead of throwing when there is no package.json to find", () => {
    const orphan = join(dir, "deep", "nowhere");
    mkdirSync(orphan, { recursive: true });
    expect(readPackageVersionFrom(orphan)).toBe("0.0.0-dev");
  });

  it("falls back when the owning package.json is unreadable", () => {
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(readPackageVersionFrom(dir)).toBe("0.0.0-dev");
  });

  // The end-to-end assertion the rest of the suite cannot make: every other
  // version test compares PROVENANCE_VERSION against itself, so all of them
  // pass just as happily when it is the fallback sentinel.
  it("stamps the real engine version, not the fallback", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8"),
    ) as { version: string };
    expect(PROVENANCE_VERSION).toBe(pkg.version);
    expect(PROVENANCE_VERSION).not.toBe("0.0.0-dev");
  });
});
