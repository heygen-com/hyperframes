import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BatchRenderInputError,
  parseBatchRows,
  prepareBatchRender,
  resolveOutputTemplate,
  runBatchRender,
} from "./batchRender.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hf-local-batch-render-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeJson(name: string, content: string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

function writeIndex(schema = "[]"): string {
  return writeJson(
    "index.html",
    `<html data-composition-variables='${schema}'><body><div data-composition-id="root"></div></body></html>`,
  );
}

function expectBatchError(fn: () => unknown, title: string): BatchRenderInputError {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BatchRenderInputError);
    if (error instanceof BatchRenderInputError) {
      expect(error.title).toBe(title);
      return error;
    }
  }
  throw new Error("Expected BatchRenderInputError");
}

describe("parseBatchRows", () => {
  it("parses a JSON array of variable rows", () => {
    expect(parseBatchRows('[{"name":"Alice"},{"name":"Bob"}]', "rows.json")).toEqual([
      { name: "Alice" },
      { name: "Bob" },
    ]);
  });

  it("parses an object with a rows array", () => {
    expect(parseBatchRows('{"rows":[{"name":"Alice"}]}', "rows.json")).toEqual([{ name: "Alice" }]);
  });

  it("rejects non-object rows", () => {
    const error = expectBatchError(
      () => parseBatchRows('[{"name":"Alice"},null]', "rows.json"),
      "Invalid batch row",
    );
    expect(error.message).toMatch(/Row 1/);
  });
});

describe("resolveOutputTemplate", () => {
  it("replaces row placeholders and index", () => {
    expect(resolveOutputTemplate("renders/{name}-{index}.mp4", { name: "Alice" }, 3)).toBe(
      "renders/Alice-3.mp4",
    );
  });

  it("rejects missing placeholder keys", () => {
    const error = expectBatchError(
      () => resolveOutputTemplate("renders/{slug}.mp4", { name: "Alice" }, 0),
      "Invalid output template",
    );
    expect(error.message).toMatch(/Missing value/);
  });
});

describe("prepareBatchRender", () => {
  it("resolves output paths and the manifest path", () => {
    const batchPath = writeJson("rows.json", '[{"name":"Alice"},{"name":"Bob"}]');
    const outDir = join(tmpDir, "renders");
    const prepared = prepareBatchRender({
      batchPath,
      outputTemplate: join(outDir, "{name}.mp4"),
      indexPath: writeIndex(),
      strictVariables: false,
      quiet: true,
      json: false,
    });

    expect(prepared.rows.map((row) => row.outputPath)).toEqual([
      resolve(outDir, "Alice.mp4"),
      resolve(outDir, "Bob.mp4"),
    ]);
    expect(prepared.manifestPath).toBe(resolve(outDir, "manifest.json"));
  });

  it("rejects output collisions before rendering", () => {
    const batchPath = writeJson("rows.json", '[{"name":"Alice"},{"name":"Bob"}]');
    const error = expectBatchError(
      () =>
        prepareBatchRender({
          batchPath,
          outputTemplate: join(tmpDir, "same.mp4"),
          indexPath: writeIndex(),
          strictVariables: false,
          quiet: true,
          json: false,
        }),
      "Batch output collision",
    );
    expect(error.message).toMatch(/Rows 0 and 1/);
  });

  it("fails strict variable validation per row", () => {
    const batchPath = writeJson("rows.json", '[{"title":"Hello"},{"title":3}]');
    const schema = '[{"id":"title","type":"string","label":"Title","default":"Untitled"}]';
    const error = expectBatchError(
      () =>
        prepareBatchRender({
          batchPath,
          outputTemplate: join(tmpDir, "{index}.mp4"),
          indexPath: writeIndex(schema),
          strictVariables: true,
          quiet: true,
          json: true,
        }),
      "Variable validation failed",
    );
    expect(error.message).toMatch(/row 1/);
  });

  it("counts non-strict variable validation issues without failing", () => {
    const batchPath = writeJson("rows.json", '[{"title":3}]');
    const schema = '[{"id":"title","type":"string","label":"Title","default":"Untitled"}]';
    const prepared = prepareBatchRender({
      batchPath,
      outputTemplate: join(tmpDir, "{index}.mp4"),
      indexPath: writeIndex(schema),
      strictVariables: false,
      quiet: true,
      json: false,
    });

    expect(prepared.variableIssueCount).toBe(1);
  });
});

describe("runBatchRender", () => {
  it("writes a manifest with completed rows", async () => {
    const prepared = prepareBatchRender({
      batchPath: writeJson("rows.json", '[{"name":"Alice"}]'),
      outputTemplate: join(tmpDir, "renders/{name}.mp4"),
      indexPath: writeIndex(),
      strictVariables: false,
      quiet: true,
      json: false,
    });

    const manifest = await runBatchRender({
      prepared,
      concurrency: 1,
      failFast: false,
      quiet: true,
      json: false,
      renderOne: async () => ({ durationMs: 3000, renderTimeMs: 42 }),
    });

    expect(manifest.completed).toBe(1);
    expect(manifest.failed).toBe(0);
    expect(manifest.rows[0]).toMatchObject({
      index: 0,
      status: "completed",
      durationMs: 3000,
      renderTimeMs: 42,
      error: null,
    });
    expect(readFileSync(prepared.manifestPath, "utf8")).toContain('"status": "completed"');
  });

  it("emits exactly one final JSON document when json mode is enabled", async () => {
    const prepared = prepareBatchRender({
      batchPath: writeJson("rows.json", '[{"name":"Alice"}]'),
      outputTemplate: join(tmpDir, "renders/{name}.mp4"),
      indexPath: writeIndex(),
      strictVariables: false,
      quiet: true,
      json: true,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runBatchRender({
      prepared,
      concurrency: 1,
      failFast: false,
      quiet: true,
      json: true,
      renderOne: async () => ({ renderTimeMs: 10 }),
    });

    expect(log).toHaveBeenCalledTimes(1);
    const result = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      type: string;
      completed: number;
      rows: Array<{ status: string }>;
    };
    expect(result).toMatchObject({ type: "batch-complete", completed: 1 });
    expect(result.rows).toEqual([expect.objectContaining({ status: "completed" })]);
  });

  it("continues after row failure by default", async () => {
    const prepared = prepareBatchRender({
      batchPath: writeJson("rows.json", '[{"name":"Alice"},{"name":"Bob"}]'),
      outputTemplate: join(tmpDir, "renders/{name}.mp4"),
      indexPath: writeIndex(),
      strictVariables: false,
      quiet: true,
      json: false,
    });

    const seen: number[] = [];
    const manifest = await runBatchRender({
      prepared,
      concurrency: 1,
      failFast: false,
      quiet: true,
      json: false,
      renderOne: async (row) => {
        seen.push(row.index);
        if (row.index === 0) throw new Error("boom");
        return { renderTimeMs: 10 };
      },
    });

    expect(seen).toEqual([0, 1]);
    expect(manifest.failed).toBe(1);
    expect(manifest.completed).toBe(1);
  });

  it("marks unstarted rows skipped when fail-fast is enabled", async () => {
    const prepared = prepareBatchRender({
      batchPath: writeJson("rows.json", '[{"name":"Alice"},{"name":"Bob"},{"name":"Cleo"}]'),
      outputTemplate: join(tmpDir, "renders/{name}.mp4"),
      indexPath: writeIndex(),
      strictVariables: false,
      quiet: true,
      json: false,
    });

    const seen: number[] = [];
    const manifest = await runBatchRender({
      prepared,
      concurrency: 1,
      failFast: true,
      quiet: true,
      json: false,
      renderOne: async (row) => {
        seen.push(row.index);
        if (row.index === 1) throw new Error("boom");
        return { renderTimeMs: 10 };
      },
    });

    expect(seen).toEqual([0, 1]);
    expect(manifest.rows.map((row) => row.status)).toEqual(["completed", "failed", "skipped"]);
    expect(manifest.skipped).toBe(1);
  });
});
