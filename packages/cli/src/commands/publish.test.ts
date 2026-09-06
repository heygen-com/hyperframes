import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const publishState = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("../utils/publishProject.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/publishProject.js")>()),
  publishProjectArchive: publishState.publish,
}));

import publishCommand, { examples, parseUpdateTarget } from "./publish.js";
import { ensureProjectId } from "../utils/projectLink.js";

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

describe("publish visibility messaging", () => {
  async function runPublish(options: {
    public: boolean;
    claimed?: boolean;
    inPlace?: boolean;
  }): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-visibility-"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    // "Updated in place" is decided by the response echoing the id the directory already
    // resolves to — no --update flag required, which is how a plain re-publish reaches it.
    const projectId = options.inPlace === true ? ensureProjectId(project) : "project-id";
    publishState.publish.mockReset();
    publishState.publish.mockResolvedValue({
      title: "test",
      fileCount: 1,
      claimed: options.claimed ?? true,
      projectId,
      url: `https://hyperframes.dev/p/${projectId}`,
      claimToken: "claim-secret",
    });
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });

    try {
      await publishCommand.run?.({
        args: { dir: project, yes: true, public: options.public, proxy: false },
      } as never);
      return lines.join("\n");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  }

  it.each([
    { public: false, label: "Private", hint: "--public" },
    { public: true, label: "Public", hint: undefined },
  ])(
    "keeps --yes orthogonal to requested $label visibility",
    async ({ public: isPublic, label, hint }) => {
      const output = await runPublish({ public: isPublic });

      expect(publishState.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ public: isPublic }),
      );
      expect(output).toContain("Requested visibility");
      expect(output).toContain(label);
      if (hint) expect(output).toContain(hint);
    },
  );

  // A re-publish without --public sends no visibility, so the server keeps whatever the
  // project already had. Claiming "Private" here would tell someone a public link is locked
  // down. This is the plain `hyperframes publish` path in an already-published directory,
  // not just --update — the same branch serves all three routes to an in-place update.
  it("does not claim private when re-publishing in place without --public", async () => {
    const output = await runPublish({ public: false, inPlace: true });

    expect(output).toContain("Requested visibility");
    expect(output).toContain("Unchanged — keeps this project's current setting");
    expect(output).toContain("Updated existing project");
    expect(output).not.toContain("Private — authentication and access required");
  });

  it("labels an authentication-required anonymous URL as a claim URL", async () => {
    const output = await runPublish({ public: false, claimed: false });

    expect(output).toContain("Claim URL");
    expect(output).toContain("claim_token=claim-secret");
    expect(output).toContain("sign in");
    expect(output).not.toMatch(/^\s*Public\s/m);
  });

  it("does not describe default publishing as public", () => {
    expect(examples[0]?.[0]).not.toContain("public URL");
  });
});
