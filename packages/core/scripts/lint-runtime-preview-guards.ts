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

function main(): void {
  const result = checkGuards(GUARD_SPECS);
  if (result.failed.length === 0) {
    console.log(
      JSON.stringify({
        event: "runtime_preview_guards_lint_passed",
        checkedGuards: GUARD_SPECS.length,
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
