import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MANIFEST_FILENAME, TEMPLATES_DIR } from "./remote.js";

// These constants construct the GitHub URL that installed CLIs use to fetch
// remote examples. Accidentally reverting either value silently breaks init
// for every user. Pin them explicitly.
describe("remote template path constants", () => {
  it("TEMPLATES_DIR points to registry/examples", () => {
    expect(TEMPLATES_DIR).toBe("registry/examples");
  });

  it("MANIFEST_FILENAME is retained for backwards-compat with any external consumers", () => {
    expect(MANIFEST_FILENAME).toBe("templates.json");
  });
});

describe("fetchRemoteTemplate", () => {
  it("writes a registry warning to stderr with control characters escaped", async () => {
    const destDir = mkdtempSync(join(tmpdir(), "hf-remote-template-"));
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    onTestFinished(() => {
      write.mockRestore();
      vi.doUnmock("../registry/resolver.js");
      vi.doUnmock("../registry/index.js");
      rmSync(destDir, { recursive: true, force: true });
    });
    vi.resetModules();
    vi.doMock("../registry/resolver.js", () => ({
      resolveItemWithDependencies: async () => [
        { name: "starter", type: "hyperframes:example", deprecated: "use \u001b]0;t\u0007x" },
      ],
    }));
    vi.doMock("../registry/index.js", () => ({
      installItem: async () => writeFileSync(join(destDir, "index.html"), ""),
    }));
    const { fetchRemoteTemplate } = await import("./remote.js");

    await fetchRemoteTemplate("starter", destDir);

    const line = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(line).toContain("use \\x1b]0;t\\x07x");
    for (const control of ["\u001b", "\u0007"]) expect(line).not.toContain(control);
  });
});
