import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("parseVariablesArg", () => {
  let parseVariablesArg: typeof import("./variables.js").parseVariablesArg;

  beforeAll(async () => {
    ({ parseVariablesArg } = await import("./variables.js"));
  });

  function expectErr<T extends { kind: string }>(
    result: import("./variables.js").VariablesParseResult,
  ): T {
    if (result.ok) throw new Error(`expected error, got ${JSON.stringify(result.value)}`);
    return result.error as T;
  }

  it("returns undefined when neither flag is set", () => {
    expect(parseVariablesArg(undefined, undefined)).toEqual({ ok: true, value: undefined });
  });

  it("parses inline JSON object", () => {
    expect(parseVariablesArg('{"title":"Hello","n":3}', undefined)).toEqual({
      ok: true,
      value: { title: "Hello", n: 3 },
    });
  });

  it("parses file JSON via injected reader", () => {
    const fakeReader = (path: string) => {
      if (path === "vars.json") return '{"theme":"dark"}';
      throw new Error("unexpected path");
    };
    expect(parseVariablesArg(undefined, "vars.json", fakeReader)).toEqual({
      ok: true,
      value: { theme: "dark" },
    });
  });

  it("rejects when both flags are set", () => {
    const err = expectErr(parseVariablesArg('{"a":1}', "vars.json"));
    expect(err).toEqual({ kind: "conflict" });
  });

  it("rejects unparseable JSON with a source-aware kind", () => {
    expect(expectErr(parseVariablesArg("{not json", undefined))).toMatchObject({
      kind: "parse-error",
      source: "inline",
    });
    expect(expectErr(parseVariablesArg(undefined, "x", () => "{not json"))).toMatchObject({
      kind: "parse-error",
      source: "file",
    });
  });

  it("rejects non-object payloads (array, string, null, number)", () => {
    for (const payload of ["[1,2]", '"hello"', "null", "42"]) {
      expect(expectErr(parseVariablesArg(payload, undefined))).toEqual({ kind: "shape-error" });
    }
  });

  it("surfaces filesystem errors from --variables-file", () => {
    const err = expectErr<{
      kind: "read-error";
      path: string;
      cause: string;
    }>(
      parseVariablesArg(undefined, "missing.json", () => {
        throw new Error("ENOENT: no such file");
      }),
    );
    expect(err.kind).toBe("read-error");
    expect(err.path).toBe("missing.json");
    expect(err.cause).toMatch(/ENOENT/);
  });
});

describe("validateVariablesAgainstProject", () => {
  let validateVariablesAgainstProject: typeof import("./variables.js").validateVariablesAgainstProject;
  let tmpDir: string;
  let mkdtempSync: typeof import("node:fs").mkdtempSync;
  let writeFileSync: typeof import("node:fs").writeFileSync;
  let rmSync: typeof import("node:fs").rmSync;
  let join: typeof import("node:path").join;
  let tmpdir: typeof import("node:os").tmpdir;

  beforeAll(async () => {
    ({ validateVariablesAgainstProject } = await import("./variables.js"));
    ({ mkdtempSync, writeFileSync, rmSync } = await import("node:fs"));
    ({ join } = await import("node:path"));
    ({ tmpdir } = await import("node:os"));
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hf-validate-vars-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIndex(html: string): string {
    const path = join(tmpDir, "index.html");
    writeFileSync(path, html);
    return path;
  }

  it("returns [] when the project has no data-composition-variables declarations", () => {
    const indexPath = writeIndex(`<html><body><div data-composition-id="x"></div></body></html>`);
    expect(validateVariablesAgainstProject(indexPath, { title: "Hello" })).toEqual([]);
  });

  it("returns [] when every value matches its declaration", () => {
    const indexPath = writeIndex(
      `<html data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"x"}]'><body><div data-composition-id="root"></div></body></html>`,
    );
    expect(validateVariablesAgainstProject(indexPath, { title: "Hello" })).toEqual([]);
  });

  it("flags undeclared keys", () => {
    const indexPath = writeIndex(
      `<html data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"x"}]'><body><div data-composition-id="root"></div></body></html>`,
    );
    expect(validateVariablesAgainstProject(indexPath, { title: "Hello", extra: 1 })).toEqual([
      { kind: "undeclared", variableId: "extra" },
    ]);
  });

  it("flags type mismatches", () => {
    const indexPath = writeIndex(
      `<html data-composition-variables='[{"id":"count","type":"number","label":"Count","default":0}]'><body><div data-composition-id="root"></div></body></html>`,
    );
    expect(validateVariablesAgainstProject(indexPath, { count: "three" })).toEqual([
      { kind: "type-mismatch", variableId: "count", expected: "number", actual: "string" },
    ]);
  });

  it("returns [] when the index file cannot be read (lint owns that diagnostic)", () => {
    expect(
      validateVariablesAgainstProject(join(tmpDir, "missing.html"), { title: "Hello" }),
    ).toEqual([]);
  });
});
