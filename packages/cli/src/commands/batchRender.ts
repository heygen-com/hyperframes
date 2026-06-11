import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import {
  loadProjectVariableSchema,
  reportVariableIssues,
  validateVariablesAgainstSchema,
} from "../utils/variables.js";

export class BatchRenderInputError extends Error {
  readonly title: string;
  readonly hint: string | undefined;

  constructor(title: string, message: string, hint?: string) {
    super(message);
    this.name = "BatchRenderInputError";
    this.title = title;
    this.hint = hint;
  }
}

export interface PreparedBatchRow {
  index: number;
  variables: Record<string, unknown>;
  outputPath: string;
}

export interface PreparedBatchRender {
  batchPath: string;
  manifestPath: string;
  variableIssueCount: number;
  rows: PreparedBatchRow[];
}

export interface BatchRenderResult {
  durationMs?: number;
  renderTimeMs: number;
}

export interface BatchManifestRow {
  index: number;
  outputPath: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  durationMs: number | null;
  renderTimeMs: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  variables: Record<string, unknown>;
}

export interface BatchManifest {
  version: 1;
  batchPath: string;
  manifestPath: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  rows: BatchManifestRow[];
}

interface PrepareBatchRenderOptions {
  batchPath: string;
  outputTemplate: string;
  indexPath: string;
  strictVariables: boolean;
  quiet: boolean;
  json: boolean;
  readFile?: (path: string) => string;
}

interface RunBatchRenderOptions {
  prepared: PreparedBatchRender;
  concurrency: number;
  failFast: boolean;
  quiet: boolean;
  json: boolean;
  renderOne: (row: PreparedBatchRow) => Promise<BatchRenderResult>;
}

const PLACEHOLDER_RE = /\{([A-Za-z0-9_.-]+)\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    throw new BatchRenderInputError(
      "Invalid JSON in --batch",
      `${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseBatchRows(raw: string, source: string): Record<string, unknown>[] {
  const parsed = parseJson(raw, source);
  const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.rows : undefined;

  if (!Array.isArray(rows)) {
    throw new BatchRenderInputError(
      "Invalid batch payload",
      '--batch must be a JSON array of objects, or an object with a "rows" array.',
    );
  }
  if (rows.length === 0) {
    throw new BatchRenderInputError("Empty batch", `${source} contains zero rows.`);
  }

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new BatchRenderInputError(
        "Invalid batch row",
        `Row ${index} must be a JSON object of variable values.`,
      );
    }
    return row;
  });
}

function placeholderValue(row: Record<string, unknown>, key: string, index: number): string {
  if (key === "index") return String(index);
  if (!Object.hasOwn(row, key)) {
    throw new BatchRenderInputError(
      "Invalid output template",
      `Missing value for placeholder {${key}} in row ${index}.`,
    );
  }

  const value = row[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  throw new BatchRenderInputError(
    "Invalid output template",
    `Placeholder {${key}} in row ${index} must resolve to a string, number, or boolean.`,
  );
}

export function resolveOutputTemplate(
  template: string,
  row: Record<string, unknown>,
  index: number,
): string {
  return template.replace(PLACEHOLDER_RE, (_match, key: string) =>
    placeholderValue(row, key, index),
  );
}

function isSameOrChildPath(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

export function commonOutputDirectory(outputPaths: readonly string[]): string {
  const firstPath = outputPaths[0];
  if (!firstPath) return resolve("renders");

  let common = dirname(firstPath);
  for (const outputPath of outputPaths.slice(1)) {
    const dir = dirname(outputPath);
    while (!isSameOrChildPath(dir, common)) {
      const parent = dirname(common);
      if (parent === common) return common;
      common = parent;
    }
  }
  return common;
}

function checkOutputCollisions(rows: readonly PreparedBatchRow[], manifestPath: string): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const previous = seen.get(row.outputPath);
    if (previous !== undefined) {
      throw new BatchRenderInputError(
        "Batch output collision",
        `Rows ${previous} and ${row.index} both resolve to ${row.outputPath}.`,
        "Use placeholders such as {index} or a unique row key in --output.",
      );
    }
    if (row.outputPath === manifestPath) {
      throw new BatchRenderInputError(
        "Batch output collision",
        `Row ${row.index} resolves to the manifest path: ${manifestPath}.`,
      );
    }
    seen.set(row.outputPath, row.index);
  }
}

function validateBatchVariables(
  rows: readonly Record<string, unknown>[],
  indexPath: string,
  strictVariables: boolean,
  quiet: boolean,
  json: boolean,
): number {
  const schema = loadProjectVariableSchema(indexPath);
  let issueCount = 0;
  const strictRows: number[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || Object.keys(row).length === 0) continue;

    const issues = validateVariablesAgainstSchema(row, schema);
    if (issues.length === 0) continue;

    issueCount += issues.length;
    if (!quiet && !json) {
      console.log("");
      console.log(c.dim(`Batch row ${index}:`));
    }
    reportVariableIssues(issues, { strict: false, quiet: quiet || json });
    if (strictVariables) strictRows.push(index);
  }

  if (strictRows.length > 0) {
    throw new BatchRenderInputError(
      "Variable validation failed",
      `Aborting batch due to variable issues in row ${strictRows.join(", ")} (--strict-variables mode).`,
    );
  }

  return issueCount;
}

export function prepareBatchRender(options: PrepareBatchRenderOptions): PreparedBatchRender {
  const batchPath = resolve(options.batchPath);
  const read = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  let raw: string;
  try {
    raw = read(batchPath);
  } catch (error: unknown) {
    throw new BatchRenderInputError(
      "Could not read --batch",
      `${batchPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const variableRows = parseBatchRows(raw, batchPath);
  const rows = variableRows.map((variables, index) => ({
    index,
    variables,
    outputPath: resolve(resolveOutputTemplate(options.outputTemplate, variables, index)),
  }));
  const manifestPath = join(
    commonOutputDirectory(rows.map((row) => row.outputPath)),
    "manifest.json",
  );
  checkOutputCollisions(rows, manifestPath);

  const variableIssueCount = validateBatchVariables(
    variableRows,
    options.indexPath,
    options.strictVariables,
    options.quiet,
    options.json,
  );

  return {
    batchPath,
    manifestPath,
    variableIssueCount,
    rows,
  };
}

function makeInitialManifest(prepared: PreparedBatchRender): BatchManifest {
  return {
    version: 1,
    batchPath: prepared.batchPath,
    manifestPath: prepared.manifestPath,
    total: prepared.rows.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    rows: prepared.rows.map((row) => ({
      index: row.index,
      outputPath: row.outputPath,
      status: "pending",
      durationMs: null,
      renderTimeMs: null,
      error: null,
      startedAt: null,
      completedAt: null,
      variables: row.variables,
    })),
  };
}

function summarizeManifest(manifest: BatchManifest): void {
  manifest.completed = manifest.rows.filter((row) => row.status === "completed").length;
  manifest.failed = manifest.rows.filter((row) => row.status === "failed").length;
  manifest.skipped = manifest.rows.filter((row) => row.status === "skipped").length;
}

function writeManifest(manifest: BatchManifest): void {
  summarizeManifest(manifest);
  mkdirSync(dirname(manifest.manifestPath), { recursive: true });
  writeFileSync(manifest.manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function emitJsonEvent(event: Record<string, unknown>, json: boolean): void {
  if (json) console.log(JSON.stringify(event));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function renderBatchRow(
  row: PreparedBatchRow,
  manifest: BatchManifest,
  options: RunBatchRenderOptions,
): Promise<boolean> {
  const manifestRow = manifest.rows[row.index];
  if (!manifestRow) {
    throw new Error(`Batch manifest is missing row ${row.index}`);
  }

  manifestRow.status = "running";
  manifestRow.startedAt = new Date().toISOString();
  writeManifest(manifest);
  emitJsonEvent(
    { type: "batch-row-start", index: row.index, outputPath: row.outputPath },
    options.json,
  );

  if (!options.quiet && !options.json) {
    console.log(c.dim(`Batch row ${row.index}: ${row.outputPath}`));
  }

  try {
    mkdirSync(dirname(row.outputPath), { recursive: true });
    const result = await options.renderOne(row);
    manifestRow.status = "completed";
    manifestRow.durationMs = result.durationMs ?? null;
    manifestRow.renderTimeMs = result.renderTimeMs;
    manifestRow.completedAt = new Date().toISOString();
    writeManifest(manifest);
    emitJsonEvent(
      {
        type: "batch-row-complete",
        index: row.index,
        outputPath: row.outputPath,
        durationMs: manifestRow.durationMs,
        renderTimeMs: manifestRow.renderTimeMs,
      },
      options.json,
    );
    return true;
  } catch (error: unknown) {
    manifestRow.status = "failed";
    manifestRow.error = errorMessage(error);
    manifestRow.completedAt = new Date().toISOString();
    writeManifest(manifest);
    emitJsonEvent(
      {
        type: "batch-row-error",
        index: row.index,
        outputPath: row.outputPath,
        error: manifestRow.error,
      },
      options.json,
    );
    if (!options.quiet && !options.json) {
      console.log(c.error(`  Row ${row.index} failed: ${manifestRow.error}`));
    }
    return false;
  }
}

function markUnstartedRowsSkipped(manifest: BatchManifest): void {
  for (const row of manifest.rows) {
    if (row.status !== "pending") continue;
    row.status = "skipped";
    row.error = "Skipped after --batch-fail-fast.";
    row.completedAt = new Date().toISOString();
  }
}

export async function runBatchRender(options: RunBatchRenderOptions): Promise<BatchManifest> {
  if (options.concurrency < 1) {
    throw new BatchRenderInputError(
      "Invalid batch-concurrency",
      `Got "${options.concurrency}". Must be a positive integer.`,
    );
  }

  const manifest = makeInitialManifest(options.prepared);
  writeManifest(manifest);

  if (!options.quiet && !options.json) {
    console.log("");
    console.log(
      c.accent("◆") +
        `  Batch rendering ${options.prepared.rows.length} rows` +
        c.dim(` → ${options.prepared.manifestPath}`),
    );
    console.log(c.dim(`   batch concurrency: ${options.concurrency}`));
    console.log("");
  }

  let cursor = 0;
  let stopLaunching = false;
  const workerCount = Math.min(options.concurrency, options.prepared.rows.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!stopLaunching) {
        const row = options.prepared.rows[cursor];
        if (!row) return;
        cursor++;

        const ok = await renderBatchRow(row, manifest, options);
        if (!ok && options.failFast) {
          stopLaunching = true;
        }
      }
    }),
  );

  if (stopLaunching) markUnstartedRowsSkipped(manifest);
  writeManifest(manifest);
  emitJsonEvent(
    {
      type: "batch-complete",
      manifestPath: manifest.manifestPath,
      total: manifest.total,
      completed: manifest.completed,
      failed: manifest.failed,
      skipped: manifest.skipped,
    },
    options.json,
  );

  if (!options.quiet && !options.json) {
    console.log("");
    console.log(
      manifest.failed > 0
        ? c.warn(
            `Batch complete: ${manifest.completed} completed, ${manifest.failed} failed, ${manifest.skipped} skipped.`,
          )
        : c.success(`Batch complete: ${manifest.completed} completed.`),
    );
    console.log(c.dim(`Manifest: ${manifest.manifestPath}`));
  }

  return manifest;
}

export function exitBatchRenderInputError(error: unknown): never {
  if (error instanceof BatchRenderInputError) {
    errorBox(error.title, error.message, error.hint);
    process.exit(1);
  }
  throw error;
}
