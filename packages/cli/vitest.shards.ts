import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Seconds the heaviest files took on a Windows runner (merge-queue run, 2026-11-22). Any other file takes about 1 s.
const MEASURED_SECONDS: Record<string, number> = {
  "src/cli.agentMode.test.ts": 484,
  "src/timeline/timeline.e2e.test.ts": 87,
  "src/warmCheck.process.test.ts": 69,
  "src/heygen/generate.test.ts": 62,
  "src/commands/snapshot.test.ts": 48,
  "src/capture/publicNetwork.integration.test.ts": 35,
  "src/commands/usage.test.ts": 35,
  "src/commands/init.test.ts": 34,
  "src/cli.jsonFlag.test.ts": 33,
  "src/audio/read/read.test.ts": 33,
  "src/browser/chromeOrphans.process.test.ts": 31,
  "src/cloud/uploadParts.test.ts": 26,
  "src/measure/diff.test.ts": 26,
  "src/capture/publicNetwork.process.test.ts": 24,
};

/** Shard `index` of `count` (1-based): heaviest first, each file to the lane with the least run time so far. */
export function timedShard<T extends { path: string; alone: boolean }>(
  files: readonly T[],
  index: number,
  count: number,
): T[] {
  // A file that runs alone holds the lane; the rest share it with a second worker.
  const cost = (file: T) => (MEASURED_SECONDS[file.path] ?? 1) / (file.alone ? 1 : 2);
  const lanes = Array.from({ length: count }, () => ({ time: 0, files: [] as T[] }));
  const order = [...files].sort(
    (a, b) => cost(b) - cost(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  for (const file of order) {
    const lane = lanes.reduce((least, next) => (next.time < least.time ? next : least));
    lane.time += cost(file);
    lane.files.push(file);
  }
  return lanes[index - 1]?.files ?? [];
}

/** `--shard` by run time: by file count, the 8-minute spawn file pushed its lane past the 16-minute limit. */
export class TimedShards extends BaseSequencer {
  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const files = specs.map((spec) => ({
      spec,
      path: relative(this.ctx.config.root, spec.moduleId).replaceAll("\\", "/"),
      // Set at runtime, but missing from Vitest 4's ResolvedConfig type.
      alone: (spec.project.config as { fileParallelism?: boolean }).fileParallelism === false,
    }));
    return timedShard(files, index, count).map((file) => file.spec);
  }
}
