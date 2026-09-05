import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const publishState = vi.hoisted(() => ({ publish: vi.fn() }));
const clackState = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: clackState.confirm,
}));

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
  async function runEntryMismatch(candidate: string): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-entry-mismatch-"));
    const candidatePath = join(project, candidate);
    mkdirSync(dirname(candidatePath), { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      candidatePath,
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
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });

    try {
      await expect(
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      ).rejects.toMatchObject({ name: "CliRuntimeError" });
      expect(publishState.publish).not.toHaveBeenCalled();
      return lines.join("\n");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it("suggests a nested index.html directory with the re-rooting caveat", async () => {
    const output = await runEntryMismatch("compositions/brand/index.html");

    expect(output).toContain("hyperframes publish <project>/compositions/brand");
    expect(output).toContain("assets are self-contained under that directory");
  });

  it("does not suggest a directory for a standalone file that is not index.html", async () => {
    const output = await runEntryMismatch("compositions/card.html");

    expect(output).toContain("compositions/card.html");
    expect(output).not.toContain("hyperframes publish <project>/compositions");
    expect(output).toContain("publish accepts project directories, not individual HTML files");
  });
});

describe("publish consent notice", () => {
  it("discloses public access and makes claiming conditional before consent", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-consent-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    publishState.publish.mockReset();
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });
    clackState.confirm.mockReset().mockImplementation(async () => {
      const notice = lines.join("\n");
      expect(notice).toContain("creates a stable public URL");
      expect(notice).toContain("Anyone with the URL can open the published project.");
      expect(notice).toContain(
        "If a claim link is returned, open it and sign in to claim the project.",
      );
      expect(notice).not.toContain("and claim it after authenticating");
      expect(notice).not.toContain("you own it on publish");
      return false;
    });

    try {
      await publishCommand.run?.({ args: { dir: project, proxy: false } } as never);
      expect(clackState.confirm).toHaveBeenCalledOnce();
      expect(publishState.publish).not.toHaveBeenCalled();
      expect(lines.join("\n")).toContain("Aborted.");
    } finally {
      log.mockRestore();
      clackState.confirm.mockReset();
      rmSync(project, { recursive: true, force: true });
    }
  });
});
