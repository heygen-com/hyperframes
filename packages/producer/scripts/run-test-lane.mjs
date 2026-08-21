import { spawnSync } from "node:child_process";
import { discoverProducerTests, PRODUCER_ROOT } from "./test-classification.mjs";

const lane = process.argv[2];
const requestedRunner = process.argv[3];
if (lane !== "unit" && lane !== "integration") {
  throw new Error("Usage: node scripts/run-test-lane.mjs <unit|integration> [bun|vitest]");
}
if (requestedRunner && requestedRunner !== "bun" && requestedRunner !== "vitest") {
  throw new Error(`Unknown test runner: ${requestedRunner}`);
}

const tests = discoverProducerTests().filter(
  (test) => test.lane === lane && (!requestedRunner || test.runner === requestedRunner),
);

function run(args) {
  const result = spawnSync("bun", args, {
    cwd: PRODUCER_ROOT,
    env: { ...process.env, HYPERFRAMES_TEST_LANE: lane },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const vitestFiles = tests.filter((test) => test.runner === "vitest").map((test) => test.file);
if (vitestFiles.length > 0) run(["x", "vitest", "run", ...vitestFiles]);

// Bun's mock.module registry is process-global. Run each file in a fresh
// process so mocks from one source test cannot mutate another test's imports.
for (const test of tests.filter((entry) => entry.runner === "bun")) {
  run(["test", test.file]);
}
