import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The page runtime is a build output; this test only reads the stamp in front of it.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((path: Parameters<typeof actual.readFileSync>[0], ...rest: unknown[]) =>
      path instanceof URL && path.pathname.endsWith("/inspection.js")
        ? ""
        : Reflect.apply(actual.readFileSync, undefined, [
            path,
            ...rest,
          ])) as typeof actual.readFileSync,
  };
});

const { fingerprint, prepareLiveInspection } = await import("../src/live");

describe("the live inspection stamp", () => {
  it("gives the page the generation id and no filesystem path", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-live-stamp-"));
    try {
      writeFileSync(join(dir, "index.html"), "<html><head></head><body></body></html>");
      const project = realpathSync(dir);
      const live = prepareLiveInspection(
        dir,
        "<html><head></head><body></body></html>",
        [],
        fingerprint(project),
      );

      const stamp = /window\.__hfLiveInspection=(\{[^}]*\});/.exec(live.html)?.[1];
      expect(stamp && JSON.parse(stamp)).toEqual({ generation: live.generation });
      expect(live.html).not.toContain(project);
      expect(live.html).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
