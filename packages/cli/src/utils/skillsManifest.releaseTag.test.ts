// A release build of the CLI reads its skills at its own release tag.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSkills, cliReleaseTag, MANIFEST_FILE, skillsSourceRef } from "./skillsManifest.js";

const lsRemote = vi.hoisted(() => ({
  tags: new Set<string>(),
  tagSha: "b".repeat(40),
  mainSha: "a".repeat(40),
}));

// `git ls-remote <url> <ref>` answers from `lsRemote.tags` and always knows main.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      args: readonly string[],
      _opts: unknown,
      callback: (err: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => {
      const ref = args[args.length - 1] ?? "";
      const sha =
        ref === "refs/heads/main"
          ? lsRemote.mainSha
          : lsRemote.tags.has(ref)
            ? lsRemote.tagSha
            : null;
      callback(null, { stdout: sha ? `${sha}\t${ref}\n` : "", stderr: "" });
    },
  ),
}));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-release-tag-"));
  lsRemote.tags = new Set();
  vi.mocked(execFile).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ source: "heygen-com/hyperframes", skills: {} }),
        }) as unknown as Response,
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("cliReleaseTag", () => {
  it.each([
    ["0.9.3", "v0.9.3"],
    ["0.0.0-dev", null],
    ["0.8.190-hdr.1", null],
  ])("maps %s to %s", (version, tag) => {
    expect(cliReleaseTag(version)).toBe(tag);
  });
});

describe("skillsSourceRef", () => {
  it("is the CLI's release tag when the repo has it", async () => {
    lsRemote.tags.add("refs/tags/v0.9.3");
    expect(await skillsSourceRef("0.9.3")).toBe("v0.9.3");
  });

  it("falls back to main for a version the repo has no tag for", async () => {
    expect(await skillsSourceRef("0.9.3")).toBe("main");
  });

  it("is main for a dev build without asking git", async () => {
    expect(await skillsSourceRef("0.0.0-dev")).toBe("main");
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });
});

describe("checkSkills on a release build", () => {
  it("compares against the manifest at the CLI's release tag, not main", async () => {
    lsRemote.tags.add("refs/tags/v0.9.3");
    await checkSkills({ cwd: root, home: root, canonical: true, cliVersion: "0.9.3" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/heygen-com/hyperframes/v0.9.3/${MANIFEST_FILE}`,
      expect.anything(),
    );
  });

  it("compares against main when the tag does not exist", async () => {
    await checkSkills({ cwd: root, home: root, canonical: true, cliVersion: "0.9.3" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/heygen-com/hyperframes/${lsRemote.mainSha}/${MANIFEST_FILE}`,
      expect.anything(),
    );
  });
});
