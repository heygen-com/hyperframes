// Detects a missing or stale workspace build before anything else imports it.
// Zero `@hyperframes/*` imports: must stay importable when nothing is built.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Build-dependency order: each package only depends on ones before it. */
export const STUDIO_WORKSPACE_BUILD_ORDER = [
  "parsers",
  "lint",
  "studio-server",
  "core",
  "player",
] as const;

// Gitignored, produced only by `core`'s own build script. `runtime-inline.ts`
// is imported by `core/src/index.ts` directly; `audio-fx-runtime-inline.ts` is
// only reached via core's own `./audio-fx-runtime` subpath, which engine imports.
const CORE_REQUIRED_GENERATED_FILES = [
  "src/generated/runtime-inline.ts",
  "src/generated/audio-fx-runtime-inline.ts",
];

export const SKIP_STALE_CHECK_ENV = "HYPERFRAMES_SKIP_BUILD_STALE_CHECK";

export interface WorkspaceBuildProblem {
  package: string;
  kind: "missing" | "stale";
  detail: string;
  fix: string;
}

function buildCommand(pkg: string): string {
  return `bun run --filter @hyperframes/${pkg} build`;
}

function isTestFile(name: string): boolean {
  return /\.test\.[tj]sx?$/.test(name);
}

/** Newest mtime among files under `dir` (recursive; skips node_modules). */
function newestMtimeMs(dir: string, { skipTests }: { skipTests: boolean }): number {
  if (!existsSync(dir)) return 0;
  const mtimes = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.includes("node_modules"))
    .filter((entry) => !skipTests || !isTestFile(entry.name))
    .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs);
  return mtimes.length > 0 ? Math.max(...mtimes) : 0;
}

/** The `./dist/...` targets named in every condition of a package's own `exports`
 * map (not `publishConfig.exports`, which describes the published tarball). */
function distExportEntries(packageDir: string): Array<{ subpath: string; target: string }> {
  const pkgJsonPath = join(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
    exports?: Record<string, unknown>;
  };
  return Object.entries(pkg.exports ?? {}).flatMap(([subpath, conditions]) =>
    distTargetsOf(conditions).map((target) => ({ subpath, target })),
  );
}

function distTargetsOf(conditions: unknown): string[] {
  if (typeof conditions !== "object" || conditions === null) return [];
  return Object.values(conditions as Record<string, unknown>).filter(
    (value): value is string => typeof value === "string" && value.startsWith("./dist/"),
  );
}

// Declared exports whose target file is missing — the gap a merge that adds
// a subpath without a rebuild leaves, which a stale-mtime check alone misses.
function missingDistExportTargets(packageDir: string): string[] {
  return distExportEntries(packageDir)
    .filter((entry) => !existsSync(join(packageDir, entry.target)))
    .map((entry) => `${entry.subpath} (${entry.target})`);
}

// A malformed package.json must produce the same friendly message as any
// other build problem, not an uncaught SyntaxError.
function exportProblemsFor(packageDir: string, pkg: string, fix: string): WorkspaceBuildProblem[] {
  let missingExports: string[];
  try {
    missingExports = missingDistExportTargets(packageDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ package: pkg, kind: "missing", detail: `package.json is invalid: ${message}`, fix }];
  }
  if (missingExports.length === 0) return [];
  return [
    {
      package: pkg,
      kind: "missing",
      detail: `dist is missing exported file(s): ${missingExports.join(", ")}`,
      fix,
    },
  ];
}

// Checks parsers/lint/studio-server/core/player in build order. Missing
// files always report; a stale src skips via HYPERFRAMES_SKIP_BUILD_STALE_CHECK=1.
export function checkStudioWorkspaceBuild(repoRoot: string): WorkspaceBuildProblem[] {
  const problems: WorkspaceBuildProblem[] = [];

  for (const pkg of STUDIO_WORKSPACE_BUILD_ORDER) {
    const packageDir = join(repoRoot, "packages", pkg);
    const distDir = join(packageDir, "dist");
    const fix = buildCommand(pkg);

    if (!existsSync(distDir) || readdirSync(distDir).length === 0) {
      problems.push({ package: pkg, kind: "missing", detail: "dist/ is missing or empty", fix });
      continue;
    }

    if (pkg === "core") {
      const missingGenerated = CORE_REQUIRED_GENERATED_FILES.filter(
        (rel) => !existsSync(join(packageDir, rel)),
      );
      if (missingGenerated.length > 0) {
        problems.push({
          package: pkg,
          kind: "missing",
          detail: `generated file(s) missing: ${missingGenerated.join(", ")}`,
          fix,
        });
        continue;
      }
    }

    const exportProblems = exportProblemsFor(packageDir, pkg, fix);
    if (exportProblems.length > 0) {
      problems.push(...exportProblems);
      continue;
    }

    if (process.env[SKIP_STALE_CHECK_ENV]) continue;

    const newestSrc = newestMtimeMs(join(packageDir, "src"), { skipTests: true });
    const newestDist = newestMtimeMs(distDir, { skipTests: false });
    if (newestSrc > newestDist) {
      problems.push({
        package: pkg,
        kind: "stale",
        detail: `src changed after the last build (set ${SKIP_STALE_CHECK_ENV}=1 to skip this check)`,
        fix,
      });
    }
  }

  return problems;
}

export function formatWorkspaceBuildProblems(problems: WorkspaceBuildProblem[]): string {
  const lines = ["Studio workspace build check failed", ""];
  for (const problem of problems) {
    lines.push(`  - ${problem.package}: ${problem.detail}`);
    lines.push(`    fix: ${problem.fix}`);
  }
  lines.push("");
  lines.push(
    "  Or build every package in order (core depends on the first three, player on core):",
  );
  lines.push("    bun run --filter '@hyperframes/{parsers,lint,studio-server}' build \\");
  lines.push("      && bun run --filter @hyperframes/core build \\");
  lines.push("      && bun run --filter @hyperframes/player build");
  return lines.join("\n");
}
