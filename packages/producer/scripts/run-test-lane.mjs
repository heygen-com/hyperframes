import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

const noNetwork = fileURLToPath(new URL("./no-network.mjs", import.meta.url));
const unit = lane === "unit";

function run(args, env = {}) {
  const result = spawnSync("bun", args, {
    cwd: PRODUCER_ROOT,
    env: { ...process.env, HYPERFRAMES_TEST_LANE: lane, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const vitestFiles = tests.filter((test) => test.runner === "vitest").map((test) => test.file);
const vitestEnv = unit
  ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${noNetwork}`.trim() }
  : {};
if (vitestFiles.length > 0) run(["x", "vitest", "run", ...vitestFiles], vitestEnv);

// Bun's mock.module registry is process-global. Run each file in a fresh
// process so mocks from one source test cannot mutate another test's imports.
for (const test of tests.filter((entry) => entry.runner === "bun")) {
  run(["test", ...(unit ? ["--preload", noNetwork] : []), test.file]);
}
