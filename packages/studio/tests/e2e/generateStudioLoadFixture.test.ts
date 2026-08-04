import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateStudioLoadFixture, writeStudioLoadFixture } from "./generateStudioLoadFixture.mjs";

type FixtureFiles = Record<string, string | Buffer>;

const temporaryProjects: string[] = [];
const CLI_LINT_PATH = fileURLToPath(
  new URL("../../../cli/src/utils/lintProject.ts", import.meta.url),
);
/**
 * 16 distinct sources behind 112 clip instances — the divergence that produces
 * request amplification. Every source is referenced 7 times, mirroring the
 * measured project where one `track.mp3` was fetched seven-plus times.
 */
const MEDIA_OPTIONS = {
  clipCount: 300,
  trackCount: 50,
  mediaSourceCount: 16,
  mediaClipCount: 112,
};
/**
 * The fixture exists to avoid measuring against a 748 MB real project, so its
 * own weight is capped. Today's media configuration lands around 117 KiB.
 */
const FIXTURE_WEIGHT_CEILING_BYTES = 512 * 1024;

function createTemporaryProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "studio-load-fixture-"));
  temporaryProjects.push(projectDir);
  return projectDir;
}

function clipTags(files: FixtureFiles): string[] {
  return Object.values(files).flatMap((contents) =>
    typeof contents === "string"
      ? (contents.match(/<[^>]+\bclass="[^"]*\bclip\b[^"]*"[^>]*>/g) ?? [])
      : [],
  );
}

function mediaReferences(files: FixtureFiles): string[] {
  const markup = String(files["index.html"]);
  return [...markup.matchAll(/<(?:audio|video|img)\b[^>]*\bsrc="([^"]+)"/g)].map((match) =>
    String(match[1]),
  );
}

function expectProjectToPassLint(projectDir: string): void {
  const program = `
    import { lintProject } from ${JSON.stringify(pathToFileURL(CLI_LINT_PATH).href)};
    const result = await lintProject(${JSON.stringify(projectDir)});
    const errors = result.results.flatMap(({ file, result }) =>
      result.findings.filter(({ severity }) => severity === "error").map((finding) => ({ file, ...finding })),
    );
    console.log(JSON.stringify({ errors, totalErrors: result.totalErrors }));
    if (result.totalErrors > 0) process.exitCode = 1;
  `;
  const result = spawnSync("bun", ["-e", program], { encoding: "utf8" });

  expect(
    { error: result.error?.message, status: result.status },
    result.stderr || result.stdout,
  ).toEqual({ error: undefined, status: 0 });
}

afterEach(() => {
  for (const projectDir of temporaryProjects.splice(0)) {
    rmSync(projectDir, { force: true, recursive: true });
  }
});

describe("generateStudioLoadFixture", () => {
  it("generates exactly 1,000 clips across every requested track", () => {
    const files = generateStudioLoadFixture({ clipCount: 1_000, trackCount: 37 });
    const tags = clipTags(files);
    const tracks = new Set(
      tags.flatMap((tag) => {
        const match = tag.match(/\bdata-track-index="(\d+)"/);
        return match ? [Number(match[1])] : [];
      }),
    );

    expect(tags).toHaveLength(1_000);
    expect([...tracks].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 37 }, (_, index) => index),
    );
  });

  it("produces byte-identical files for the same inputs", () => {
    expect(generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 })).toStrictEqual(
      generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 }),
    );
  });

  it("keeps the authored DOM id ratio below 30 percent", () => {
    const tags = clipTags(generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 }));
    const authoredIdCount = tags.filter((tag) => /\sid="[^"]+"/.test(tag)).length;

    expect(authoredIdCount / tags.length).toBeLessThan(0.3);
  });

  it("passes the HyperFrames CLI structural lint", () => {
    const projectDir = createTemporaryProject();
    writeStudioLoadFixture(projectDir, { clipCount: 1_000, trackCount: 50 });

    expectProjectToPassLint(projectDir);
  }, 15_000);

  it("references an existing sub-composition from the root", () => {
    const projectDir = createTemporaryProject();
    const files = generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 });
    writeStudioLoadFixture(projectDir, { clipCount: 1_000, trackCount: 50 });
    const reference = files["index.html"].match(/data-composition-src="([^"]+)"/)?.[1];

    expect(reference).toBeDefined();
    expect(reference && existsSync(join(projectDir, reference))).toBe(true);
  });

  it("generates a structurally valid zero-clip project", () => {
    const files = generateStudioLoadFixture({ clipCount: 0, trackCount: 1 });
    const projectDir = createTemporaryProject();
    writeStudioLoadFixture(projectDir, { clipCount: 0, trackCount: 1 });

    expect(clipTags(files)).toHaveLength(0);
    expectProjectToPassLint(projectDir);
  });

  it("emits no media files when no media is requested", () => {
    const paths = Object.keys(generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 }));

    expect(paths.filter((path) => path.startsWith("assets/"))).toEqual([]);
    expect(
      mediaReferences(generateStudioLoadFixture({ clipCount: 1_000, trackCount: 50 })),
    ).toEqual([]);
  });

  it("diverges distinct media sources from media clip instances", () => {
    const files = generateStudioLoadFixture(MEDIA_OPTIONS);
    const references = mediaReferences(files);
    const referenceCounts = new Map<string, number>();
    for (const source of references) {
      referenceCounts.set(source, (referenceCounts.get(source) ?? 0) + 1);
    }

    expect(references).toHaveLength(MEDIA_OPTIONS.mediaClipCount);
    expect(referenceCounts.size).toBe(MEDIA_OPTIONS.mediaSourceCount);
    expect(Math.max(...referenceCounts.values())).toBeGreaterThanOrEqual(7);
    // Every referenced source is a real file the fixture emits, and all three
    // media kinds appear — images are the second-largest request contributor.
    expect([...referenceCounts.keys()].filter((source) => files[source] === undefined)).toEqual([]);
    for (const extension of [".wav", ".mp4", ".png"]) {
      expect(references.some((source) => source.endsWith(extension))).toBe(true);
    }
  });

  it("controls source count and clip count independently", () => {
    const moreClips = mediaReferences(
      generateStudioLoadFixture({ ...MEDIA_OPTIONS, mediaClipCount: 160 }),
    );
    const fewerSources = mediaReferences(
      generateStudioLoadFixture({ ...MEDIA_OPTIONS, mediaSourceCount: 8 }),
    );

    expect(moreClips).toHaveLength(160);
    expect(new Set(moreClips).size).toBe(MEDIA_OPTIONS.mediaSourceCount);
    expect(fewerSources).toHaveLength(MEDIA_OPTIONS.mediaClipCount);
    expect(new Set(fewerSources).size).toBe(8);
  });

  it("rejects a media configuration that would not amplify", () => {
    expect(() =>
      generateStudioLoadFixture({ ...MEDIA_OPTIONS, mediaSourceCount: 16, mediaClipCount: 20 }),
    ).toThrow(RangeError);
    expect(() => generateStudioLoadFixture({ ...MEDIA_OPTIONS, mediaClipCount: 1_000 })).toThrow(
      RangeError,
    );
  });

  it("produces byte-identical media for the same inputs", () => {
    const first = generateStudioLoadFixture(MEDIA_OPTIONS);
    const second = generateStudioLoadFixture(MEDIA_OPTIONS);

    expect(Object.keys(second)).toEqual(Object.keys(first));
    for (const [path, contents] of Object.entries(first)) {
      expect(Buffer.from(second[path] as string | Buffer), path).toEqual(Buffer.from(contents));
    }
  });

  it("keeps the media fixture under the stated weight ceiling", () => {
    const totalBytes = Object.values(generateStudioLoadFixture(MEDIA_OPTIONS)).reduce(
      (total, contents) => total + Buffer.byteLength(contents),
      0,
    );

    expect(totalBytes).toBeLessThan(FIXTURE_WEIGHT_CEILING_BYTES);
  });

  it("passes the HyperFrames CLI structural lint with media", () => {
    const projectDir = createTemporaryProject();
    writeStudioLoadFixture(projectDir, MEDIA_OPTIONS);

    expectProjectToPassLint(projectDir);
  }, 15_000);
});
