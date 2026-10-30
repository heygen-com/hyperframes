import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const refusals = vi.hoisted(() => ({ left: 0 }));
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (refusals.left-- > 0)
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      actual.renameSync(from, to);
    },
  };
});

import { publishRegistryFile, registryRoot } from "./publication.js";

afterEach(() => vi.restoreAllMocks());

it("publishes over an existing file when Windows refuses the first rename", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-publish-")));
  try {
    writeFileSync(join(root, "hyperframes.lock.json"), "old");
    refusals.left = 1;
    publishRegistryFile(root, "hyperframes.lock.json", "new");
    expect(readFileSync(join(root, "hyperframes.lock.json"), "utf-8")).toBe("new");
  } finally {
    refusals.left = 0;
    rmSync(root, { recursive: true, force: true });
  }
});
