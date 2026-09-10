import fs from "node:fs";
import path from "node:path";

type GuardSpec = {
  id: string;
  description: string;
  filePath: string;
  pattern: RegExp;
};

type GuardCheckResult = {
  passed: GuardSpec[];
  failed: GuardSpec[];
};

type BanSpec = {
  id: string;
  description: string;
  directory: string;
  pattern: RegExp;
  remedy: string;
};

type BanHit = { id: string; filePath: string; line: number; text: string; remedy: string };

/**
 * Source shapes that must not come back. Unlike GUARD_SPECS (a pattern that must
 * be PRESENT in one file), these are patterns that must be ABSENT everywhere
 * under a directory.
 */
const BAN_SPECS: BanSpec[] = [
  {
    id: "realm_bound_dom_instanceof",
    description:
      "`instanceof` against a DOM interface answers which realm built the node, not what the node is. The composition DOM is not always built by the realm the runtime runs in, so these checks can return false for every element in the document — silently, with nothing thrown.",
    directory: "src/runtime",
    pattern:
      /\binstanceof\s+(?:Element|Node|Text|Document|DocumentFragment|ShadowRoot|HTML[A-Za-z]*Element|SVG[A-Za-z]*Element)\b/,
    remedy: "Use a structural predicate from src/runtime/domRealm.ts instead.",
  },
];

// Keep only temporary source-shape guards that do not yet have behavioral
// coverage. Timeline replacement and early-play rebinding are exercised by
// init.test.ts and timelineRebindPolicy.test.ts instead of regexes.
const GUARD_SPECS: GuardSpec[] = [
  {
    id: "external_compositions_gate",
    description: "Do not bind timelines before external compositions are loaded",
    filePath: "src/runtime/init.ts",
    pattern: /if\s*\(\s*!externalCompositionsReady\s*\)\s*return\s+false;/,
  },
  {
    id: "child_timeline_activation",
    description: "Force root child timelines active before composition binding",
    filePath: "src/runtime/init.ts",
    pattern: /timelineWithPaused\.paused\(false\)/,
  },
  {
    id: "root_unusable_fallback",
    description: "Fallback to composite timeline when root duration is unusable",
    filePath: "src/runtime/init.ts",
    pattern:
      /if\s*\(\s*!isUsableTimelineDuration\(rootDurationSeconds\)\s*&&\s*rootChildCandidates\.length\s*>\s*0\s*\)/,
  },
  {
    id: "external_script_ordering",
    description: "Inject external composition scripts with deterministic ordering",
    filePath: "src/runtime/compositionLoader.ts",
    pattern: /injectedScript\.async\s*=\s*false;/,
  },
  {
    id: "external_script_load_wait",
    description: "Await external composition script load before continuing",
    filePath: "src/runtime/compositionLoader.ts",
    pattern: /await\s+waitForExternalScriptLoad\(injectedScript\);/,
  },
];

function resolveFilePath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

function checkGuards(guards: GuardSpec[]): GuardCheckResult {
  const passed: GuardSpec[] = [];
  const failed: GuardSpec[] = [];

  for (const guard of guards) {
    const absolutePath = resolveFilePath(guard.filePath);
    if (!fs.existsSync(absolutePath)) {
      failed.push(guard);
      continue;
    }
    const content = fs.readFileSync(absolutePath, "utf8");
    if (guard.pattern.test(content)) {
      passed.push(guard);
    } else {
      failed.push(guard);
    }
  }

  return { passed, failed };
}

/** Tests assert the banned shape on purpose, to prove the predicates match it. */
function isScannableSource(entry: fs.Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts");
}

function collectSourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(isScannableSource)
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** A comment may legitimately name the banned shape while explaining why it is banned. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function checkBans(bans: BanSpec[]): BanHit[] {
  const hits: BanHit[] = [];
  for (const ban of bans) {
    const root = resolveFilePath(ban.directory);
    if (!fs.existsSync(root)) continue;
    for (const file of collectSourceFiles(root)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isCommentLine(line) || !ban.pattern.test(line)) return;
        hits.push({
          id: ban.id,
          filePath: path.relative(process.cwd(), file),
          line: index + 1,
          text: line.trim().slice(0, 160),
          remedy: ban.remedy,
        });
      });
    }
  }
  return hits;
}

function main(): void {
  const bannedHits = checkBans(BAN_SPECS);
  if (bannedHits.length > 0) {
    console.error(
      JSON.stringify({
        event: "runtime_preview_guards_lint_failed",
        bannedShapes: bannedHits,
      }),
    );
    process.exit(1);
  }

  const result = checkGuards(GUARD_SPECS);
  if (result.failed.length === 0) {
    console.log(
      JSON.stringify({
        event: "runtime_preview_guards_lint_passed",
        checkedGuards: GUARD_SPECS.length,
        checkedBans: BAN_SPECS.length,
      }),
    );
    return;
  }

  console.error(
    JSON.stringify({
      event: "runtime_preview_guards_lint_failed",
      checkedGuards: GUARD_SPECS.length,
      missingGuards: result.failed.map((guard) => ({
        id: guard.id,
        filePath: guard.filePath,
        description: guard.description,
      })),
    }),
  );
  process.exit(1);
}

main();
