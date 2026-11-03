// A release build of the CLI reads its skills at its own release tag.

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildManifest,
  checkSkills,
  cliReleaseTag,
  MANIFEST_FILE,
  type SkillsManifest,
} from "./skillsManifest.js";

const git = vi.hoisted(() => ({ fails: false, mainSha: "a".repeat(40) }));

// `git ls-remote` knows main's HEAD, or fails like a missing git / blocked proxy.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      callback: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
    ) =>
      git.fails
        ? callback(new Error("spawn git ENOENT"))
        : callback(null, { stdout: `${git.mainSha}\trefs/heads/main\n`, stderr: "" }),
  ),
}));

const RAW = "https://raw.githubusercontent.com/heygen-com/hyperframes";
const TAG_URL = `${RAW}/v0.9.2/${MANIFEST_FILE}`;

let root: string;
let home: string;
let installed: SkillsManifest;
let onMain: SkillsManifest;

/** Serve `byUrl` from the stubbed fetch; a function value answers that URL itself. */
function serve(byUrl: Record<string, SkillsManifest | number | (() => Promise<never>)>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const answer = byUrl[url] ?? onMain;
      if (typeof answer === "function") return answer();
      if (typeof answer === "number") return { ok: false, status: answer } as Response;
      return { ok: true, status: 200, json: async () => answer } as unknown as Response;
    }),
  );
}

const fetchedUrls = (): string[] => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-release-tag-"));
  home = join(root, "home");
  // The skills installed at v0.9.2; main has moved on since.
  const skillsDir = join(home, ".claude/skills");
  mkdirSync(join(skillsDir, "hyperframes"), { recursive: true });
  writeFileSync(join(skillsDir, "hyperframes", "SKILL.md"), "# hyperframes at v0.9.2");
  installed = buildManifest(skillsDir, { source: "heygen-com/hyperframes" });
  onMain = {
    source: "heygen-com/hyperframes",
    skills: { hyperframes: { hash: "f".repeat(16), files: 1 } },
  };
  git.fails = false;
  vi.mocked(execFile).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

const check = () => checkSkills({ cwd: root, home, canonical: true, cliVersion: "0.9.2" });

describe("cliReleaseTag", () => {
  it.each([
    ["0.9.3", "v0.9.3"],
    ["0.0.0-dev", null],
    ["0.8.190-hdr.1", null],
  ])("maps %s to %s", (version, tag) => {
    expect(cliReleaseTag(version)).toBe(tag);
  });
});

describe("checkSkills on a release build", () => {
  it("reads the manifest at the CLI's release tag without asking git first", async () => {
    serve({ [TAG_URL]: installed });
    const res = await check();
    expect(fetchedUrls()).toEqual([TAG_URL]);
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
    expect(res.ref).toBe("v0.9.2");
    expect(res.summary.outdated).toBe(0);
  });

  // The background nudge runs this check; comparing against main here would
  // cache "1 skill outdated" for 24h while `skills update` finds nothing to do.
  it("does not report skills outdated against main when the git lookup fails", async () => {
    git.fails = true;
    serve({ [TAG_URL]: installed });
    const res = await check();
    expect(res.summary.outdated).toBe(0);
    expect(res.ref).toBe("v0.9.2");
  });

  it("surfaces a timed-out tag fetch instead of comparing against main", async () => {
    serve({
      [TAG_URL]: () => Promise.reject(new DOMException("This operation was aborted", "AbortError")),
    });
    await expect(check()).rejects.toThrow(/aborted/);
    expect(fetchedUrls()).toEqual([TAG_URL]);
  });

  it("falls back to main only when the tag's manifest is a 404", async () => {
    serve({ [TAG_URL]: 404 });
    const res = await check();
    expect(fetchedUrls()).toEqual([TAG_URL, `${RAW}/${git.mainSha}/${MANIFEST_FILE}`]);
    expect(res.ref).toBe("main");
    expect(res.summary.outdated).toBe(1);
  });

  it.each([500, 403])(
    "surfaces an HTTP %i for the tag instead of comparing against main",
    async (status) => {
      serve({ [TAG_URL]: status });
      await expect(check()).rejects.toThrow(`HTTP ${status}`);
      expect(fetchedUrls()).toEqual([TAG_URL]);
    },
  );

  it("compares a dev build against main", async () => {
    serve({});
    const res = await checkSkills({ cwd: root, home, canonical: true, cliVersion: "0.0.0-dev" });
    expect(res.ref).toBe("main");
    expect(fetchedUrls()).toEqual([`${RAW}/${git.mainSha}/${MANIFEST_FILE}`]);
  });
});
