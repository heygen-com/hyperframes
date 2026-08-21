import { failCommand } from "../utils/commandResult.js";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  HF_COLOR_GRADING_ATTR,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  parseCubeLut,
  serializeHfColorGrading,
} from "@hyperframes/core";
import { defineCommand } from "citty";
import sharp from "sharp";
import type { Example } from "./_examples.js";
import { openSettledCompositionPage, runFfmpegOnce } from "../capture/captureCompositionFrame.js";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { c } from "../ui/colors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { displayPathFromBase, readOptionalString, resolveFromBase } from "../utils/pathArgs.js";
import { trackCompareSheet } from "../telemetry/events.js";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";
import { withMeta } from "../utils/updateCheck.js";

const COMPOSITION_ID = "grade-compare";
const COMPOSITION_DURATION = "1";
const DEFAULT_CELL_WIDTH = 560;
const MAX_CANDIDATE_CELLS = 16;
const MAX_COLUMNS = 4;
const GRID_PADDING = 16;
const LABEL_HEIGHT = 32;
const FFMPEG_EXTRACT_TIMEOUT_MS = 30_000;

export interface GradeCompareCell {
  label: string;
  grading: unknown;
}

interface ParsedGradeCompareArgs {
  framePath: string;
  projectDir: string;
  outPath: string;
  source: { kind: "grades"; path: string } | { kind: "luts"; value: string };
  json: boolean;
  timeoutMs: number;
}

interface PreparedGradeCompareProject {
  tempDir: string;
  html: string;
  cells: GradeCompareCell[];
}

export interface CandidateCellCapResult {
  cells: GradeCompareCell[];
  truncated: boolean;
  total: number;
}

export interface GradeCompareSuccessPayload {
  ok: true;
  sheet: string;
  cells: number;
  truncated?: true;
  total?: number;
}

interface GradeCompareHtmlOptions {
  cells: readonly GradeCompareCell[];
  frameSrc: string;
  frameWidth: number;
  frameHeight: number;
}

interface ReferenceFrame {
  buffer: Buffer;
  width: number;
  height: number;
  stagedName: string;
}

export const examples: Example[] = [
  [
    "Compare grade presets on one reference frame",
    "hyperframes grade-compare --for frame.png --grades grades.json",
  ],
  [
    "Compare LUT files and print agent-friendly JSON",
    "hyperframes grade-compare --for frame.png --luts looks/a.cube,looks/b.cube --json",
  ],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = value;
  }
  return next;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeSingleQuotedAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function validateCell(label: string, grading: unknown): GradeCompareCell {
  if (!normalizeHfColorGrading(grading)) {
    throw new Error(`Invalid color grading for cell "${label}"`);
  }
  return { label, grading };
}

export function warnInactiveGradingCells(cells: readonly GradeCompareCell[]): void {
  for (const cell of cells) {
    const normalized = normalizeHfColorGrading(cell.grading);
    if (!isHfColorGradingActive(normalized)) {
      console.error(
        c.warn(`Warning: grading for "${cell.label}" is inactive/no-op — it will render ungraded`),
      );
    }
  }
}

export function capCandidateCells(cells: readonly GradeCompareCell[]): CandidateCellCapResult {
  const total = cells.length;
  if (total <= MAX_CANDIDATE_CELLS) {
    return { cells: [...cells], truncated: false, total };
  }
  console.error(
    c.warn(
      `Warning: ${total} candidate grades exceed the ${MAX_CANDIDATE_CELLS}-cell cap — rendering the first ${MAX_CANDIDATE_CELLS} of ${total}; re-run with fewer grades or split into multiple runs.`,
    ),
  );
  return { cells: cells.slice(0, MAX_CANDIDATE_CELLS), truncated: true, total };
}

export function buildGradeCompareSuccessPayload(
  sheet: string,
  cells: number,
  capResult: CandidateCellCapResult,
): GradeCompareSuccessPayload {
  if (!capResult.truncated) {
    return { ok: true, sheet, cells };
  }
  return { ok: true, sheet, cells, truncated: true, total: capResult.total };
}

function serializedGradingForCell(cell: GradeCompareCell): string {
  const normalized = normalizeHfColorGrading(cell.grading);
  if (!normalized) {
    throw new Error(`Invalid color grading for cell "${cell.label}"`);
  }
  return serializeHfColorGrading(normalized);
}

function lutSrcFromGrading(grading: unknown): string | null {
  if (!isRecord(grading) || !hasOwn(grading, "lut")) return null;
  const lut = grading.lut;
  if (typeof lut === "string" && lut.trim()) return lut.trim();
  if (!isRecord(lut)) return null;
  const src = lut.src;
  return typeof src === "string" && src.trim() ? src.trim() : null;
}

function rewriteGradingLutSrc(grading: unknown, src: string): unknown {
  if (!isRecord(grading) || !hasOwn(grading, "lut")) return grading;
  const lut = grading.lut;
  const next = cloneRecord(grading);
  if (typeof lut === "string") {
    next.lut = { src };
    return next;
  }
  if (isRecord(lut)) {
    const nextLut = cloneRecord(lut);
    nextLut.src = src;
    next.lut = nextLut;
  }
  return next;
}

export function parseGradesFile(filePath: string): GradeCompareCell[] {
  if (!existsSync(filePath)) {
    throw new Error(`Grades file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(`Could not parse grades JSON: ${normalizeErrorMessage(err)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Grades file must be a JSON array of { label, grading } objects");
  }

  return parsed.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Grade entry ${index + 1} must be an object with label and grading`);
    }
    const label = entry.label;
    if (typeof label !== "string" || !label.trim()) {
      throw new Error(`Grade entry ${index + 1} must have a non-empty string label`);
    }
    if (!hasOwn(entry, "grading")) {
      throw new Error(`Grade entry "${label}" must include a grading value`);
    }
    return validateCell(label, entry.grading);
  });
}

export function resolveLutCells(luts: string): GradeCompareCell[] {
  const paths = luts
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    throw new Error("--luts must include at least one LUT path");
  }
  return paths.map((lutPath) =>
    validateCell(basename(lutPath, extname(lutPath)), { lut: { src: lutPath } }),
  );
}

// The ungraded frame as a leading reference cell. An empty grading object
// normalizes to inactive, so the runtime renders the source image untouched —
// giving the agent a baseline to judge every candidate look against.
export function prependBaselineCell(cells: GradeCompareCell[]): GradeCompareCell[] {
  return [validateCell("original", {}), ...cells];
}

export function parseGradeCompareArgs(args: {
  for?: unknown;
  grades?: unknown;
  luts?: unknown;
  project?: unknown;
  out?: unknown;
  json?: unknown;
  timeout?: unknown;
}): ParsedGradeCompareArgs {
  const frameArg = readOptionalString(args.for);
  if (!frameArg) throw new Error("--for <path> is required");

  const gradesArg = readOptionalString(args.grades);
  const lutsArg = readOptionalString(args.luts);
  if (Boolean(gradesArg) === Boolean(lutsArg)) {
    throw new Error("Exactly one of --grades or --luts is required");
  }

  const projectDir = resolve(readOptionalString(args.project) ?? process.cwd());
  const framePath = resolveFromBase(projectDir, frameArg);
  const outPath = resolveFromBase(projectDir, readOptionalString(args.out) ?? "grade-compare.png");

  return {
    framePath,
    projectDir,
    outPath,
    source: gradesArg
      ? { kind: "grades", path: resolveFromBase(projectDir, gradesArg) }
      : { kind: "luts", value: lutsArg ?? "" },
    json: args.json === true,
    timeoutMs: Number.parseInt(readOptionalString(args.timeout) ?? "", 10) || 5000,
  };
}

function gridMetrics(
  cellCount: number,
  frameWidth: number,
  frameHeight: number,
): {
  columns: number;
  rows: number;
  cellImageWidth: number;
  cellImageHeight: number;
  width: number;
  height: number;
} {
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(cellCount))));
  const rows = Math.ceil(cellCount / columns);
  const cellImageWidth = DEFAULT_CELL_WIDTH;
  const aspect = frameHeight > 0 && frameWidth > 0 ? frameHeight / frameWidth : 9 / 16;
  const cellImageHeight = Math.max(1, Math.round(cellImageWidth * aspect));
  return {
    columns,
    rows,
    cellImageWidth,
    cellImageHeight,
    width: columns * cellImageWidth + (columns + 1) * GRID_PADDING,
    height: rows * (cellImageHeight + LABEL_HEIGHT) + (rows + 1) * GRID_PADDING,
  };
}

export function buildGradeCompareHtml(options: GradeCompareHtmlOptions): string {
  if (options.cells.length === 0) {
    throw new Error("At least one grade cell is required");
  }
  const metrics = gridMetrics(options.cells.length, options.frameWidth, options.frameHeight);

  const cellHtml = options.cells
    .map((cell, index) => {
      const serialized = escapeSingleQuotedAttr(serializedGradingForCell(cell));
      const label = escapeXml(cell.label);
      const row = Math.floor(index / metrics.columns);
      const col = index % metrics.columns;
      const left = GRID_PADDING + col * (metrics.cellImageWidth + GRID_PADDING);
      const top = GRID_PADDING + row * (metrics.cellImageHeight + LABEL_HEIGHT + GRID_PADDING);
      return `      <figure class="grade-cell" style="left:${left}px;top:${top}px;width:${metrics.cellImageWidth}px;height:${metrics.cellImageHeight + LABEL_HEIGHT}px">
        <figcaption>${label}</figcaption>
        <img src="${escapeXml(options.frameSrc)}" ${HF_COLOR_GRADING_ATTR}='${serialized}' alt="${label}" />
      </figure>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${metrics.width}, height=${metrics.height}" />
    <title>HyperFrames Grade Compare</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        width: ${metrics.width}px;
        height: ${metrics.height}px;
        overflow: hidden;
        background: #191919;
        font-family: Arial, Helvetica, sans-serif;
      }

      #${COMPOSITION_ID} {
        position: relative;
        width: ${metrics.width}px;
        height: ${metrics.height}px;
        overflow: hidden;
        background: #191919;
      }

      .grade-cell {
        position: absolute;
        margin: 0;
        background: #0f0f0f;
      }

      .grade-cell figcaption {
        height: ${LABEL_HEIGHT}px;
        line-height: ${LABEL_HEIGHT}px;
        padding: 0 10px;
        box-sizing: border-box;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: #ffffff;
        background: #111111;
        font-size: 14px;
        font-weight: 700;
      }

      .grade-cell img {
        display: block;
        width: ${metrics.cellImageWidth}px;
        height: ${metrics.cellImageHeight}px;
        object-fit: contain;
        background: #000000;
      }
    </style>
  </head>
  <body>
    <div
      id="${COMPOSITION_ID}"
      data-composition-id="${COMPOSITION_ID}"
      data-start="0"
      data-duration="${COMPOSITION_DURATION}"
      data-width="${metrics.width}"
      data-height="${metrics.height}"
    >
${cellHtml}
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["${COMPOSITION_ID}"] = gsap.timeline({ paused: true });
      </script>
    </div>
  </body>
</html>
`;
}

function frameFileNameForPath(framePath: string): string {
  const ext = extname(framePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return `frame${ext}`;
  return "frame.png";
}

export async function prepareGradeCompareTempProject(opts: {
  projectDir: string;
  framePath: string;
  frameBuffer: Buffer;
  cells: readonly GradeCompareCell[];
  frameWidth: number;
  frameHeight: number;
  frameFileName?: string;
}): Promise<PreparedGradeCompareProject> {
  const tempDir = mkdtempSync(join(tmpdir(), "hf-grade-compare-"));
  try {
    const frameFileName = opts.frameFileName ?? frameFileNameForPath(opts.framePath);
    writeFileSync(join(tempDir, frameFileName), opts.frameBuffer);

    let lutIndex = 0;
    const stagedCells = opts.cells.map((cell) => {
      const lutSrc = lutSrcFromGrading(cell.grading);
      if (!lutSrc) return cell;

      const sourcePath = resolveFromBase(opts.projectDir, lutSrc);
      if (!existsSync(sourcePath)) {
        throw new Error(`LUT file not found for "${cell.label}": ${sourcePath}`);
      }
      const lutText = readFileSync(sourcePath, "utf-8");
      try {
        parseCubeLut(lutText, { maxSize: 64 });
      } catch (err) {
        throw new Error(
          `LUT for "${cell.label}" is not a valid .cube: ${normalizeErrorMessage(err)}`,
        );
      }
      const lutExt = extname(sourcePath) || ".cube";
      const stagedName = `lut-${lutIndex}${lutExt}`;
      lutIndex += 1;
      copyFileSync(sourcePath, join(tempDir, stagedName));
      return {
        label: cell.label,
        grading: rewriteGradingLutSrc(cell.grading, stagedName),
      };
    });

    const html = buildGradeCompareHtml({
      cells: stagedCells,
      frameSrc: frameFileName,
      frameWidth: opts.frameWidth,
      frameHeight: opts.frameHeight,
    });
    writeFileSync(join(tempDir, "index.html"), html);
    return { tempDir, html, cells: stagedCells };
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

function isVideoPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpeg", ".mpg", ".ogv"].includes(ext);
}

async function extractVideoFrameToBuffer(videoPath: string): Promise<Buffer | null> {
  const tmp = mkdtempSync(join(tmpdir(), "hf-grade-compare-frame-"));
  const outPath = join(tmp, "frame.png");
  try {
    const ffmpegPath = findFFmpeg();
    if (!ffmpegPath) return null;
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      outPath,
    ];
    const result = await runFfmpegOnce(ffmpegPath, args, FFMPEG_EXTRACT_TIMEOUT_MS);
    if (result.timedOut) {
      throw new Error(`ffmpeg timed out extracting first frame from ${videoPath}`);
    }
    if (result.code !== 0 || !existsSync(outPath)) {
      const detail = result.stderr.trim() ? `: ${result.stderr.trim()}` : "";
      throw new Error(`ffmpeg could not extract first frame from ${videoPath}${detail}`);
    }
    return readFileSync(outPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function loadReferenceFrame(framePath: string): Promise<ReferenceFrame> {
  if (!existsSync(framePath)) {
    throw new Error(`Reference frame not found: ${framePath}`);
  }

  const buffer = isVideoPath(framePath)
    ? await extractVideoFrameToBuffer(framePath)
    : readFileSync(framePath);
  if (!buffer) {
    throw new Error(`Could not extract a frame from video: ${framePath}`);
  }

  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read reference frame dimensions: ${framePath}`);
  }

  return {
    buffer,
    width: metadata.width,
    height: metadata.height,
    stagedName: isVideoPath(framePath) ? "frame.png" : frameFileNameForPath(framePath),
  };
}

async function captureGradeCompareSheet(
  projectDir: string,
  timeoutMs: number,
): Promise<{ sheetPath: string; renderReadyTimedOut: boolean }> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(projectDir, html);
  const sheetPath = join(projectDir, "grade-compare.png");

  try {
    const {
      browser: chromeBrowser,
      page,
      renderReadyTimedOut,
    } = await openSettledCompositionPage(html, server.url, {
      renderReadyTimeoutMs: timeoutMs,
      renderReadyWarningSuffix: "grade comparison may be inaccurate",
    });

    try {
      await page.screenshot({ path: sheetPath, type: "png" });
      return { sheetPath, renderReadyTimedOut };
    } finally {
      await chromeBrowser.close();
    }
  } finally {
    await server.close();
  }
}

function printJson(payload: object): void {
  console.log(JSON.stringify(withMeta(payload), null, 2));
}

export default defineCommand({
  meta: {
    name: "grade-compare",
    description: "Render candidate color grades onto a reference frame as one comparison PNG",
  },
  args: {
    for: {
      type: "string",
      description: "Reference image path, or a video path to sample at t=0",
      required: true,
    },
    grades: {
      type: "string",
      description: "JSON array of { label, grading } candidate grades",
    },
    luts: {
      type: "string",
      description: "Comma-separated .cube LUT paths to compare",
    },
    project: {
      type: "string",
      description: "Base directory for relative --for, --grades, and LUT paths (default: cwd)",
    },
    out: {
      type: "string",
      description: "Output PNG path (default: <project>/grade-compare.png)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
      default: false,
    },
    timeout: {
      type: "string",
      description: "Render-ready timeout in ms before capture (default: 5000)",
    },
    baseline: {
      type: "boolean",
      description:
        "Prepend the ungraded frame as an 'original' reference cell (--no-baseline to omit)",
      default: true,
    },
  },
  async run({ args }) {
    const jsonRequested = args.json === true;
    let preparedDir: string | null = null;
    try {
      const parsed = parseGradeCompareArgs({
        for: args.for,
        grades: args.grades,
        luts: args.luts,
        project: args.project,
        out: args.out,
        json: args.json,
        timeout: args.timeout,
      });
      let cells =
        parsed.source.kind === "grades"
          ? parseGradesFile(parsed.source.path)
          : resolveLutCells(parsed.source.value);
      if (cells.length === 0) {
        throw new Error("At least one grade candidate is required");
      }
      const capResult = capCandidateCells(cells);
      cells = capResult.cells;
      warnInactiveGradingCells(cells);
      if (args.baseline !== false) {
        cells = prependBaselineCell(cells);
      }

      if (!parsed.json) {
        console.log(
          `${c.accent("◆")}  Rendering ${cells.length} grade candidates from ${c.accent(basename(parsed.framePath))}`,
        );
      }

      const frame = await loadReferenceFrame(parsed.framePath);
      const prepared = await prepareGradeCompareTempProject({
        projectDir: parsed.projectDir,
        framePath: parsed.framePath,
        frameBuffer: frame.buffer,
        frameWidth: frame.width,
        frameHeight: frame.height,
        frameFileName: frame.stagedName,
        cells,
      });
      preparedDir = prepared.tempDir;

      const { sheetPath: tempSheet, renderReadyTimedOut } = await captureGradeCompareSheet(
        prepared.tempDir,
        parsed.timeoutMs,
      );
      mkdirSync(dirname(parsed.outPath), { recursive: true });
      copyFileSync(tempSheet, parsed.outPath);
      trackCompareSheet({
        command: "grade-compare",
        cells: prepared.cells.length,
        truncated: capResult.truncated,
        total: capResult.total,
        renderReadyTimedOut,
      });

      const sheet = displayPathFromBase(parsed.projectDir, parsed.outPath);
      if (parsed.json) {
        printJson(buildGradeCompareSuccessPayload(sheet, prepared.cells.length, capResult));
      } else {
        console.log(`\n${c.success("◇")}  Grade comparison saved to ${sheet}`);
      }
    } catch (err) {
      const message = normalizeErrorMessage(err);
      if (jsonRequested) {
        printJson({ ok: false, error: message });
      } else {
        console.error(`\n${c.error("✗")} Grade compare failed: ${message}`);
      }
      failCommand();
    } finally {
      if (preparedDir) {
        rmSync(preparedDir, { recursive: true, force: true });
      }
    }
  },
});
