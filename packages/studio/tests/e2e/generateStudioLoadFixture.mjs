import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const ROOT_DURATION = 180;
const CLIP_DURATION = 2;
const SUB_COMPOSITION_DURATION = 120;
const SUB_COMPOSITION_PATH = "compositions/load-details.html";
const CLIP_KINDS = ["load-card", "load-caption", "load-accent"];

const MEDIA_CLIP_DURATION = 1;
/** Lane offsets past the caller's tracks, one per media kind. */
const MEDIA_KINDS = ["audio", "video", "image"];
const MEDIA_EXTENSIONS = { audio: "wav", video: "mp4", image: "png" };
// Real projects are image-heavy: the measured 273-clip project carried 263
// images against 23 audio and 77 video files. This ratio reproduces that mix.
const MEDIA_SOURCE_KIND_PATTERN = [
  "audio",
  "image",
  "video",
  "image",
  "image",
  "video",
  "image",
  "image",
];
/**
 * Every source must be reused at least this many times. This is the property
 * the fixture exists for: a project where each clip has its own source cannot
 * reproduce the request amplification (the measured project fetched one
 * `track.mp3` seven-plus times), so a gate built on it would measure nothing.
 */
const MIN_REFERENCES_PER_SOURCE = 7;
const MAX_MEDIA_CLIPS = Math.floor(ROOT_DURATION / MEDIA_CLIP_DURATION) - 1;
/**
 * The one asset that cannot be synthesized in a few lines: a real H.264 file a
 * browser will actually decode. 1,684 bytes, 128x72, one second of solid colour.
 */
const SEED_VIDEO = readFileSync(
  fileURLToPath(new URL("fixtures/media-seed/solid-colour.mp4", import.meta.url)),
);
const PROJECT_CONFIG = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets",
    },
  },
  null,
  2,
)}\n`;

const OPTION_MINIMUMS = { clipCount: 0, trackCount: 1, mediaSourceCount: 0, mediaClipCount: 0 };

function validateOptions(options) {
  for (const [name, minimum] of Object.entries(OPTION_MINIMUMS)) {
    const value = options[name];
    if (!Number.isInteger(value) || value < minimum) {
      throw new RangeError(`${name} must be an integer of at least ${minimum}`);
    }
  }

  const { mediaSourceCount, mediaClipCount } = options;
  if (mediaClipCount > MAX_MEDIA_CLIPS) {
    throw new RangeError(`mediaClipCount must be at most ${MAX_MEDIA_CLIPS}`);
  }
  if (mediaClipCount > 0 && mediaSourceCount < 1) {
    throw new RangeError("mediaClipCount above zero requires at least one media source");
  }
  if (mediaSourceCount > 0 && mediaClipCount < mediaSourceCount * MIN_REFERENCES_PER_SOURCE) {
    throw new RangeError(
      `mediaClipCount must be at least ${MIN_REFERENCES_PER_SOURCE} times mediaSourceCount so every source is reused`,
    );
  }
}

function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, checksum]);
}

/** A 32x32 solid-colour PNG whose colour is derived from the source index. */
function buildImageSource(sourceIndex) {
  const size = 32;
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = y * stride + 1 + x * 3;
      raw[pixel] = (sourceIndex * 61) % 256;
      raw[pixel + 1] = (sourceIndex * 113) % 256;
      raw[pixel + 2] = (sourceIndex * 173) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One second of 8 kHz 16-bit mono silence. */
function buildAudioSource(sourceIndex) {
  const sampleRate = 8_000;
  const dataBytes = sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16); // fmt chunk length
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  // Silence, except one inaudible final sample carrying the source index. No two
  // sources may be byte-identical, or a content-addressed cache anywhere in the
  // stack could collapse them and hide the very duplication being measured.
  wav.writeInt16LE(sourceIndex, wav.length - 2);
  return wav;
}

/** The seed clip plus a `free` box — ignored by demuxers, distinct on disk. */
function buildVideoSource(sourceIndex) {
  const freeBox = Buffer.alloc(12);
  freeBox.writeUInt32BE(12, 0);
  freeBox.write("free", 4, "ascii");
  freeBox.writeUInt32BE(sourceIndex, 8);
  return Buffer.concat([SEED_VIDEO, freeBox]);
}

const MEDIA_BUILDERS = {
  audio: buildAudioSource,
  video: buildVideoSource,
  image: buildImageSource,
};

function mediaSource(sourceIndex) {
  const kind = MEDIA_SOURCE_KIND_PATTERN[sourceIndex % MEDIA_SOURCE_KIND_PATTERN.length];
  const path = `assets/${kind}-${String(sourceIndex).padStart(3, "0")}.${MEDIA_EXTENSIONS[kind]}`;
  return { kind, path };
}

function renderMediaClip(index, { mediaSourceCount, trackCount }) {
  // Round-robin over the sources: distinct-source count and clip-instance count
  // are then independently controllable, and every source is reused.
  const { kind, path } = mediaSource(index % mediaSourceCount);
  const track = trackCount + MEDIA_KINDS.indexOf(kind);
  // One clip per second keeps every lane free of overlaps without any packing.
  const start = index * MEDIA_CLIP_DURATION;
  const timing = `data-start="${start}" data-duration="${MEDIA_CLIP_DURATION}" data-track-index="${track}"`;
  const layout = `style="left: ${(index * 53) % 1820}px; top: ${(index * 29) % 980}px"`;
  const id = `load-media-${index}`;

  if (kind === "image") {
    return `      <img id="${id}" class="clip" src="${path}" alt="" ${timing} ${layout} />`;
  }
  const muted = kind === "video" ? " muted" : "";
  return `      <${kind} id="${id}" class="clip" src="${path}"${muted} ${timing} ${layout}></${kind}>`;
}

function renderClip(index, start, track, indent) {
  const authoredId = index % 5 === 0 ? `${indent}  id="load-clip-${index}"\n` : "";
  const kind = CLIP_KINDS[index % CLIP_KINDS.length];
  const left = (index * 37) % 1820;
  const top = (index * 17) % 980;

  return `${indent}<div
${authoredId}${indent}  class="clip ${kind}"
${indent}  data-start="${start}"
${indent}  data-duration="${CLIP_DURATION}"
${indent}  data-track-index="${track}"
${indent}  style="left: ${left}px; top: ${top}px"
${indent}>
${indent}  ${index + 1}
${indent}</div>`;
}

function renderRootHtml(options, rootClipCount) {
  const { clipCount, trackCount, mediaClipCount } = options;
  const rootClips = Array.from({ length: rootClipCount }, (_, index) =>
    renderClip(
      index,
      (index * 37) % (ROOT_DURATION - CLIP_DURATION),
      index % Math.max(1, trackCount - 1),
      "      ",
    ),
  ).join("\n");
  const mediaClips = Array.from({ length: mediaClipCount }, (_, index) =>
    renderMediaClip(index, options),
  ).join("\n");
  const hostIndex = rootClipCount;
  const hostMarkup =
    clipCount === 0
      ? `      <div
        data-composition-id="studio-load-details"
        data-composition-src="${SUB_COMPOSITION_PATH}"
      ></div>`
      : `      <div
        class="clip load-card"
        data-composition-id="studio-load-details"
        data-composition-src="${SUB_COMPOSITION_PATH}"
        data-start="${(hostIndex * 37) % (ROOT_DURATION - SUB_COMPOSITION_DURATION)}"
        data-duration="${SUB_COMPOSITION_DURATION}"
        data-track-index="${trackCount - 1}"
      ></div>`;
  const clipMarkup = [rootClips, hostMarkup, mediaClips].filter(Boolean).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Studio load fixture (${clipCount} clips, ${trackCount} tracks)</title>
    <style>
      html,
      body {
        width: 1920px;
        height: 1080px;
        margin: 0;
        overflow: hidden;
        background: #0b1020;
        color: #f8fafc;
        font-family: Arial, sans-serif;
      }
      #studio-load-root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip {
        position: absolute;
        width: 100px;
        height: 100px;
        visibility: hidden;
      }
      .load-card {
        background: #2563eb;
      }
      .load-caption {
        background: #7c3aed;
      }
      .load-accent {
        background: #0f766e;
      }
    </style>
  </head>
  <body>
    <main
      id="studio-load-root"
      data-composition-id="studio-load"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="${ROOT_DURATION}"
      data-fps="30"
    >
${clipMarkup}
    </main>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["studio-load"] = {
        pause() {},
        seek() {},
      };
    </script>
  </body>
</html>
`;
}

function renderSubCompositionHtml({ trackCount }, rootClipCount, nestedClipCount) {
  const firstNestedIndex = rootClipCount + 1;
  const clips = Array.from({ length: nestedClipCount }, (_, offset) => {
    const index = firstNestedIndex + offset;
    return renderClip(
      index,
      (index * 17) % (SUB_COMPOSITION_DURATION - CLIP_DURATION),
      index % trackCount,
      "    ",
    );
  }).join("\n");
  const clipMarkup = clips ? `\n${clips}` : "";

  return `<template id="studio-load-details-template">
  <section
    id="studio-load-details-root"
    data-composition-id="studio-load-details"
    data-width="1920"
    data-height="1080"
    data-start="0"
    data-duration="${SUB_COMPOSITION_DURATION}"
  >
    <style>
      [data-composition-id="studio-load-details"] .clip {
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
    </style>${clipMarkup}
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["studio-load-details"] = {
        pause() {},
        seek() {},
      };
    </script>
  </section>
</template>
`;
}

/**
 * Build every source file for a deterministic, on-disk Studio load project.
 *
 * `mediaSourceCount` and `mediaClipCount` are independent: the clips round-robin
 * over the sources, so a small pool of real media files can back many clip
 * instances — the divergence that produces request amplification.
 *
 * @returns {Readonly<Record<string, string | Buffer>>} relative path to contents.
 */
export function generateStudioLoadFixture(options) {
  const resolved = { mediaSourceCount: 0, mediaClipCount: 0, ...options };
  validateOptions(resolved);
  const nestedClipCount = resolved.clipCount > 1 ? Math.min(100, resolved.clipCount - 1) : 0;
  const rootClipCount = resolved.clipCount - nestedClipCount - (resolved.clipCount > 0 ? 1 : 0);
  const mediaFiles = Object.fromEntries(
    Array.from({ length: resolved.mediaSourceCount }, (_, sourceIndex) => {
      const { kind, path } = mediaSource(sourceIndex);
      return [path, MEDIA_BUILDERS[kind](sourceIndex)];
    }),
  );

  return Object.freeze({
    "hyperframes.json": PROJECT_CONFIG,
    "index.html": renderRootHtml(resolved, rootClipCount),
    [SUB_COMPOSITION_PATH]: renderSubCompositionHtml(resolved, rootClipCount, nestedClipCount),
    ...mediaFiles,
  });
}

/** Write one generated project to disk. */
export function writeStudioLoadFixture(outputDir, options) {
  for (const [relativePath, contents] of Object.entries(generateStudioLoadFixture(options))) {
    const outputPath = join(outputDir, relativePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, contents);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const outputDir = fileURLToPath(new URL("fixtures/studio-load/", import.meta.url));
  writeStudioLoadFixture(outputDir, {
    clipCount: Number(process.argv[2] ?? 1_000),
    trackCount: Number(process.argv[3] ?? 50),
    mediaSourceCount: Number(process.argv[4] ?? 0),
    mediaClipCount: Number(process.argv[5] ?? 0),
  });
}
