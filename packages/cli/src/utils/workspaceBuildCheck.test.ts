import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkStudioWorkspaceBuild,
  SKIP_STALE_CHECK_ENV,
  STUDIO_WORKSPACE_BUILD_ORDER,
} from "./workspaceBuildCheck.js";

let dirs: string[] = [];

// Fixed, monotonically increasing mtime stamps: two `new Date()` calls taken
// moments apart can round to the same value on a coarse-mtime filesystem.
const CLOCK_START = new Date(2024, 0, 1).getTime();
let clockTicks = 0;
function nextStamp(): Date {
  clockTicks += 1;
  return new Date(CLOCK_START + clockTicks * 10_000);
}

function tmpRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-workspace-build-check-"));
  dirs.push(dir);
  return dir;
}

/** A fully built package: dist/index.js exists, no exports gap, dist newer than src. */
function writeBuiltPackage(
  repoRoot: string,
  pkg: string,
  exportsMap: Record<string, unknown> = {
    ".": { node: "./dist/index.js", import: "./src/index.ts" },
  },
): void {
  const pkgDir = join(repoRoot, "packages", pkg);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkg, exports: exportsMap }));
  writeFileSync(join(pkgDir, "src", "index.ts"), "export {};");
  writeFileSync(join(pkgDir, "dist", "index.js"), "export {};");
  const srcFiles = [join(pkgDir, "src", "index.ts")];
  if (pkg === "core") {
    mkdirSync(join(pkgDir, "src", "generated"), { recursive: true });
    writeFileSync(join(pkgDir, "src", "generated", "runtime-inline.ts"), "export {};");
    writeFileSync(join(pkgDir, "src", "generated", "audio-fx-runtime-inline.ts"), "export {};");
    srcFiles.push(
      join(pkgDir, "src", "generated", "runtime-inline.ts"),
      join(pkgDir, "src", "generated", "audio-fx-runtime-inline.ts"),
    );
  }
  // dist strictly newer than every src file so a fresh build never reads as stale.
  const past = nextStamp();
  const now = nextStamp();
  for (const file of srcFiles) utimesSync(file, past, past);
  utimesSync(join(pkgDir, "dist", "index.js"), now, now);
}

function writeAllBuilt(repoRoot: string): void {
  for (const pkg of STUDIO_WORKSPACE_BUILD_ORDER) writeBuiltPackage(repoRoot, pkg);
}

afterEach(() => {
  delete process.env[SKIP_STALE_CHECK_ENV];
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("checkStudioWorkspaceBuild", () => {
  it("reports every package as missing on a fresh clone with nothing built", () => {
    const repoRoot = tmpRepoRoot();
    mkdirSync(join(repoRoot, "packages"), { recursive: true });

    const problems = checkStudioWorkspaceBuild(repoRoot);

    expect(problems.map((p) => p.package)).toEqual([...STUDIO_WORKSPACE_BUILD_ORDER]);
    expect(problems.every((p) => p.kind === "missing")).toBe(true);
  });

  it("reports only the one package whose src changed after its last build", () => {
    const repoRoot = tmpRepoRoot();
    writeAllBuilt(repoRoot);
    const parsersSrc = join(repoRoot, "packages", "parsers", "src", "index.ts");
    const touchedAt = nextStamp();
    utimesSync(parsersSrc, touchedAt, touchedAt);

    const problems = checkStudioWorkspaceBuild(repoRoot);

    expect(problems).toEqual([expect.objectContaining({ package: "parsers", kind: "stale" })]);
  });

  it("skips the stale-src check under the escape hatch env var", () => {
    const repoRoot = tmpRepoRoot();
    writeAllBuilt(repoRoot);
    const parsersSrc = join(repoRoot, "packages", "parsers", "src", "index.ts");
    const touchedAt = nextStamp();
    utimesSync(parsersSrc, touchedAt, touchedAt);
    process.env[SKIP_STALE_CHECK_ENV] = "1";

    expect(checkStudioWorkspaceBuild(repoRoot)).toEqual([]);
  });

  it("reports a new export subpath missing from an otherwise fresh dist", () => {
    const repoRoot = tmpRepoRoot();
    writeAllBuilt(repoRoot);
    // Simulates a merge that added a subpath to package.json and its src file,
    // without anyone rebuilding this already-checked-out worktree's dist.
    writeBuiltPackage(repoRoot, "core", {
      ".": { node: "./dist/index.js", import: "./src/index.ts" },
      "./new-thing": { node: "./dist/newThing.js", import: "./src/newThing.ts" },
    });

    const problems = checkStudioWorkspaceBuild(repoRoot);

    expect(problems).toEqual([expect.objectContaining({ package: "core", kind: "missing" })]);
    expect(problems[0]?.detail).toContain("newThing.js");
  });

  it("reports nothing for a fully built, fresh workspace", () => {
    const repoRoot = tmpRepoRoot();
    writeAllBuilt(repoRoot);

    expect(checkStudioWorkspaceBuild(repoRoot)).toEqual([]);
  });

  it("reports a broken package.json instead of throwing", () => {
    const repoRoot = tmpRepoRoot();
    writeAllBuilt(repoRoot);
    writeFileSync(join(repoRoot, "packages", "parsers", "package.json"), "{not json");

    const problems = checkStudioWorkspaceBuild(repoRoot);

    expect(problems).toEqual([expect.objectContaining({ package: "parsers", kind: "missing" })]);
    expect(problems[0]?.detail).toContain("package.json is invalid");
  });
});
