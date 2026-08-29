import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const publishState = vi.hoisted(() => ({ publish: vi.fn() }));
const authState = vi.hoisted(() => ({ tryResolveCredential: vi.fn().mockResolvedValue(null) }));
const clackState = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("../utils/publishProject.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/publishProject.js")>()),
  publishProjectArchive: publishState.publish,
}));

vi.mock("../auth/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/index.js")>()),
  tryResolveCredential: authState.tryResolveCredential,
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: clackState.confirm,
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
  async function runConsent(credential: unknown): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-consent-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    publishState.publish.mockReset();
    authState.tryResolveCredential.mockReset().mockResolvedValue(credential);
    // Declining the prompt stops the run right after the notice — no network, no upload.
    clackState.confirm.mockReset().mockResolvedValue(false);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });

    try {
      await publishCommand.run?.({ args: { dir: project, proxy: false } } as never);
      expect(publishState.publish).not.toHaveBeenCalled();
      return lines.join("\n");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it("offers the claim step when publishing anonymously", async () => {
    const output = await runConsent(null);

    expect(output).toContain("claim it after authenticating");
  });

  it("tells a signed-in publisher there is no claim link", async () => {
    const output = await runConsent({ type: "api_key", key: "k", source: "env" });

    expect(output).toContain("you own it on publish and there is no claim link");
    expect(output).not.toContain("claim it after authenticating");
  });

  it.each([
    ["anonymous", null],
    ["signed in", { type: "api_key", key: "k", source: "env" }],
  ])("discloses the exposure before uploading (%s)", async (_label, credential) => {
    // The consent prompt is the only place the user is told the artifact is world-readable:
    // the result block prints no exposure line on the owned branch. Dropping it from either
    // branch means someone approves an upload without being told who can reach it.
    const output = await runConsent(credential);

    expect(output).toContain("creates a stable public URL");
    expect(output).toContain("Anyone with the URL can open the published project");
  });
});
