import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProjectRootMissing, mkdirWithinProject, mkdirWithinProjectAsync } from "./safePath.js";

const gone = vi.hoisted(() => ({ root: "" }));

// The project folder is removed as the first folder below it is made, after the maker found it there.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const mkdirSync = ((...args: Parameters<typeof actual.mkdirSync>) => {
    if (gone.root) actual.rmSync(gone.root, { recursive: true, force: true });
    return actual.mkdirSync(...args);
  }) as typeof actual.mkdirSync;
  return { ...actual, mkdirSync, default: { ...actual, mkdirSync } };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { rmSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
  const mkdir = ((...args: Parameters<typeof actual.mkdir>) => {
    if (gone.root) rmSync(gone.root, { recursive: true, force: true });
    return actual.mkdir(...args);
  }) as typeof actual.mkdir;
  return { ...actual, mkdir, default: { ...actual, mkdir } };
});

afterEach(() => {
  gone.root = "";
});

describe("making folders in a project whose folder goes away meanwhile", () => {
  it.each([
    ["mkdirWithinProject", async (root: string, dir: string) => mkdirWithinProject(root, dir)],
    ["mkdirWithinProjectAsync", mkdirWithinProjectAsync],
  ])("%s reports the project folder gone and does not make it again", async (_, make) => {
    const root = mkdtempSync(join(tmpdir(), "hf-root-gone-"));
    gone.root = root;
    const error = await make(root, join(root, "a", "b")).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(isProjectRootMissing(error)).toBe(true);
    expect(existsSync(root)).toBe(false);
  });
});
