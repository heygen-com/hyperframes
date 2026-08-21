import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const publishState = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("../utils/publishProject.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/publishProject.js")>()),
  publishProjectArchive: publishState.publish,
}));

import publishCommand, { parseUpdateTarget } from "./publish.js";

describe("parseUpdateTarget", () => {
  it("extracts the id from a full published URL", () => {
    expect(parseUpdateTarget("https://hyperframes.dev/p/hfp_abc123")).toBe("hfp_abc123");
  });

  it("handles a scheme-less URL (which new URL() rejects)", () => {
    expect(parseUpdateTarget("hyperframes.dev/p/hfp_abc123")).toBe("hfp_abc123");
  });

  it("strips a trailing query and hash", () => {
    expect(parseUpdateTarget("https://hyperframes.dev/p/hfp_abc123?claim_token=x#frag")).toBe(
      "hfp_abc123",
    );
  });

  it("accepts a bare id unchanged and trims surrounding whitespace", () => {
    expect(parseUpdateTarget("  hfp_abc123  ")).toBe("hfp_abc123");
  });

  it("falls back to the last path segment for a non-/p/ URL", () => {
    expect(parseUpdateTarget("https://example.com/foo/hfp_abc123")).toBe("hfp_abc123");
  });
});

describe("publish default-entry preflight", () => {
  it("rejects the real fixture before creating or uploading an archive", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-entry-mismatch-"));
    const compositions = join(project, "compositions");
    mkdirSync(compositions);
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      join(compositions, "index.html"),
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    publishState.publish.mockReset();
    publishState.publish.mockResolvedValue({
      title: "test",
      fileCount: 2,
      claimed: true,
      projectId: "project-id",
      url: "https://hyperframes.dev/p/project-id",
      claimToken: "",
    });

    try {
      await expect(
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      ).rejects.toMatchObject({ name: "CliRuntimeError" });
      expect(publishState.publish).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
