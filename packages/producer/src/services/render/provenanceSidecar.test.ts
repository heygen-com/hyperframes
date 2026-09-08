import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProducerLogger } from "../../logger.js";
import {
  RENDER_SIDECAR_SCHEMA_URL,
  RENDER_SIDECAR_SCHEMA_VERSION,
  RENDER_SIDECAR_SUFFIX,
  buildRenderProvenanceSidecar,
  collectFontFamilies,
  emitRenderProvenanceSidecar,
  hashVariables,
  resolveProvenanceSidecarPath,
  type BuildRenderProvenanceSidecarInput,
} from "./provenanceSidecar.js";
import { sha256Hex } from "./stages/planHash.js";

function makeLogger(): ProducerLogger & { warnings: string[]; infos: string[] } {
  const warnings: string[] = [];
  const infos: string[] = [];
  return {
    warnings,
    infos,
    error() {},
    warn(message) {
      warnings.push(message);
    },
    info(message) {
      infos.push(message);
    },
    debug() {},
    isLevelEnabled: () => true,
  };
}

describe("resolveProvenanceSidecarPath", () => {
  it("defaults to <output>.hf-render.json beside the artifact", () => {
    expect(resolveProvenanceSidecarPath("/renders/out.mp4", undefined)).toBe(
      `${resolve("/renders/out.mp4")}${RENDER_SIDECAR_SUFFIX}`,
    );
  });

  it("places a png-sequence sidecar NEXT TO the directory, not inside it", () => {
    expect(resolveProvenanceSidecarPath("/renders/frames/", undefined)).toBe(
      `${resolve("/renders/frames")}${RENDER_SIDECAR_SUFFIX}`,
    );
  });

  it("returns null when disabled", () => {
    expect(resolveProvenanceSidecarPath("/renders/out.mp4", false)).toBeNull();
  });

  it("resolves a custom sidecar path", () => {
    expect(resolveProvenanceSidecarPath("/renders/out.mp4", "receipts/out.json")).toBe(
      resolve("receipts/out.json"),
    );
  });
});

describe("collectFontFamilies", () => {
  it("extracts sorted, de-duplicated @font-face families", () => {
    const html = `<style>
      @font-face { font-family: 'Space Grotesk'; src: url(a.woff2); }
      @font-face { font-family: "Inter"; font-weight: 700; src: url(b.woff2); }
      @font-face { font-family: Inter; font-weight: 400; src: url(c.woff2); }
      body { font-family: Inter, sans-serif; }
    </style>`;
    expect(collectFontFamilies(html)).toEqual(["Inter", "Space Grotesk"]);
  });

  it("returns an empty list when the composition declares no @font-face", () => {
    expect(collectFontFamilies("<style>body { font-family: system-ui; }</style>")).toEqual([]);
  });
});

describe("hashVariables", () => {
  it("returns null for absent or empty variables", () => {
    expect(hashVariables(undefined)).toBeNull();
    expect(hashVariables({})).toBeNull();
  });

  it("hashes canonically so property order does not change the receipt", () => {
    const a = hashVariables({ title: "Q4", theme: "dark" });
    const b = hashVariables({ theme: "dark", title: "Q4" });
    expect(a).toEqual(b);
    expect(a?.count).toBe(2);
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a value changes", () => {
    expect(hashVariables({ title: "Q4" })?.sha256).not.toBe(hashVariables({ title: "Q5" })?.sha256);
  });
});

function makeBuildInput(
  overrides: Partial<BuildRenderProvenanceSidecarInput> = {},
): BuildRenderProvenanceSidecarInput {
  return {
    jobId: "job-1",
    outcome: "completed",
    warningCodes: [],
    totalElapsedMs: 1234,
    stages: { compileMs: 10, captureMs: 100, encodeMs: 50 },
    workers: 2,
    quality: "standard",
    producerVersion: "0.9.9-test",
    ffmpegVersion: "ffmpeg version 6.1.1",
    entryFile: "index.html",
    entrySha256: sha256Hex("<html></html>"),
    compositionHash: "abc123",
    fonts: ["Inter"],
    variables: { title: "secret launch name", apiKey: "sk-super-secret" },
    outputPath: "/renders/out.mp4",
    format: "mp4",
    fps: { num: 30, den: 1 },
    width: 1920,
    height: 1080,
    durationSeconds: 4,
    totalFrames: 120,
    outputSizeBytes: 4096,
    outputSha256: sha256Hex("fake-mp4-bytes"),
    hdr: false,
    encoder: { codec: "h264", preset: "medium", pixelFormat: "yuv420p" },
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildRenderProvenanceSidecar", () => {
  it("builds the versioned receipt shape", () => {
    const sidecar = buildRenderProvenanceSidecar(makeBuildInput());
    expect(sidecar.$schema).toBe(RENDER_SIDECAR_SCHEMA_URL);
    expect(sidecar.schemaVersion).toBe(RENDER_SIDECAR_SCHEMA_VERSION);
    expect(sidecar.kind).toBe("hf-render-sidecar");
    expect(sidecar.versions).toEqual({
      producer: "0.9.9-test",
      node: process.version,
      ffmpeg: "ffmpeg version 6.1.1",
    });
    expect(sidecar.render.jobId).toBe("job-1");
    expect(sidecar.output).toEqual({
      file: "out.mp4",
      format: "mp4",
      fps: { num: 30, den: 1 },
      width: 1920,
      height: 1080,
      durationSeconds: 4,
      totalFrames: 120,
      sizeBytes: 4096,
      sha256: sha256Hex("fake-mp4-bytes"),
      hdr: false,
      encoder: { codec: "h264", preset: "medium", pixelFormat: "yuv420p" },
    });
    expect(sidecar.host).toEqual({ platform: process.platform, arch: process.arch });
  });

  it("hashes variables instead of embedding their values", () => {
    const sidecar = buildRenderProvenanceSidecar(makeBuildInput());
    const serialized = JSON.stringify(sidecar);
    expect(serialized).not.toContain("sk-super-secret");
    expect(serialized).not.toContain("secret launch name");
    expect(sidecar.input.variables).toEqual({
      count: 2,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("sorts and de-duplicates warning codes", () => {
    const sidecar = buildRenderProvenanceSidecar(
      makeBuildInput({
        outcome: "completed_with_warnings",
        warningCodes: ["video_not_ready", "audio_missing", "video_not_ready"],
      }),
    );
    expect(sidecar.render.warningCodes).toEqual(["audio_missing", "video_not_ready"]);
  });

  it("omits absent optional facts rather than writing null placeholders", () => {
    const sidecar = buildRenderProvenanceSidecar(
      makeBuildInput({
        ffmpegVersion: undefined,
        entrySha256: undefined,
        compositionHash: undefined,
        variables: undefined,
        outputSizeBytes: undefined,
        outputSha256: undefined,
        encoder: null,
        format: "png-sequence",
        outputPath: "/renders/frames",
      }),
    );
    expect("ffmpeg" in sidecar.versions).toBe(false);
    expect("entrySha256" in sidecar.input).toBe(false);
    expect("sha256" in sidecar.output).toBe(false);
    expect(sidecar.input.variables).toBeNull();
    expect(sidecar.output.encoder).toBeNull();
    expect(sidecar.output.file).toBe("frames");
  });
});

describe("emitRenderProvenanceSidecar", () => {
  // Each test provisions its own root through makeEmitInput; a single
  // splice-and-remove afterEach keeps cleanup out of the fixture helper.
  const tmpRoots: string[] = [];
  let dir: string;

  afterEach(() => {
    for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function makeEmitInput(overrides: Record<string, unknown> = {}) {
    dir = mkdtempSync(join(tmpdir(), "hf-provenance-"));
    tmpRoots.push(dir);
    const projectDir = join(dir, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "index.html"), "<html>entry</html>");
    const outputPath = join(dir, "out.mp4");
    writeFileSync(outputPath, "fake-mp4-bytes");
    return {
      outputPath,
      provenance: undefined as string | false | undefined,
      isFileArtifact: true,
      projectDir,
      entryFile: "index.html",
      compiledHtml: "<style>@font-face { font-family: 'Inter'; }</style>",
      jobId: "job-emit",
      outcome: "completed" as const,
      warningCodes: [],
      totalElapsedMs: 99,
      stages: { encodeMs: 5 },
      workers: 1,
      quality: "standard" as const,
      compositionHash: "hash-1",
      variables: { title: "Hello" },
      format: "mp4",
      fps: { num: 30, den: 1 },
      width: 640,
      height: 360,
      durationSeconds: 1,
      totalFrames: 30,
      hdr: false,
      encoder: { codec: "h264", preset: "medium", pixelFormat: "yuv420p" },
      log: makeLogger(),
      ...overrides,
    };
  }

  it("writes the receipt beside the artifact by default", async () => {
    const input = makeEmitInput();
    const sidecarPath = await emitRenderProvenanceSidecar(input);
    expect(sidecarPath).toBe(`${input.outputPath}${RENDER_SIDECAR_SUFFIX}`);
    const sidecar = JSON.parse(readFileSync(sidecarPath as string, "utf-8"));
    expect(sidecar.kind).toBe("hf-render-sidecar");
    expect(sidecar.input.entrySha256).toBe(sha256Hex("<html>entry</html>"));
    expect(sidecar.input.fonts).toEqual(["Inter"]);
    expect(sidecar.input.variables.count).toBe(1);
    expect(sidecar.output.sha256).toBe(sha256Hex("fake-mp4-bytes"));
    expect(sidecar.output.sizeBytes).toBe("fake-mp4-bytes".length);
    expect(sidecar.versions.producer).toEqual(expect.any(String));
  });

  it("returns null and writes nothing when disabled", async () => {
    const input = makeEmitInput({ provenance: false });
    expect(await emitRenderProvenanceSidecar(input)).toBeNull();
    expect(existsSync(`${input.outputPath}${RENDER_SIDECAR_SUFFIX}`)).toBe(false);
  });

  it("honors a custom sidecar path", async () => {
    const input = makeEmitInput();
    const customPath = join(dir, "receipts", "out.json");
    mkdirSync(join(dir, "receipts"), { recursive: true });
    input.provenance = customPath;
    expect(await emitRenderProvenanceSidecar(input)).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
  });

  it("skips artifact size and sha256 for directory outputs", async () => {
    const input = makeEmitInput({
      isFileArtifact: false,
      format: "png-sequence",
      encoder: null,
    });
    const framesDir = join(dir, "frames");
    mkdirSync(framesDir, { recursive: true });
    input.outputPath = framesDir;
    const sidecarPath = await emitRenderProvenanceSidecar(input);
    const sidecar = JSON.parse(readFileSync(sidecarPath as string, "utf-8"));
    expect("sha256" in sidecar.output).toBe(false);
    expect("sizeBytes" in sidecar.output).toBe(false);
    expect(sidecar.output.encoder).toBeNull();
  });

  it("logs a warning instead of failing when the sidecar cannot be written", async () => {
    const log = makeLogger();
    const input = makeEmitInput({ log });
    input.provenance = join(dir, "missing-dir", "out.json");
    expect(await emitRenderProvenanceSidecar(input)).toBeNull();
    expect(log.warnings).toContain("Failed to write render provenance sidecar");
  });

  it("tolerates an unreadable entry file", async () => {
    const input = makeEmitInput({ entryFile: "missing.html" });
    const sidecarPath = await emitRenderProvenanceSidecar(input);
    const sidecar = JSON.parse(readFileSync(sidecarPath as string, "utf-8"));
    expect("entrySha256" in sidecar.input).toBe(false);
    expect(sidecar.input.entryFile).toBe("missing.html");
  });
});
