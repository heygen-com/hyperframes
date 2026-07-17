/**
 * Shared test fixture for faking the `hyperframes-vst` sidecar process —
 * used by both `audioMixer.test.ts` (the render pipeline's caller) and
 * `vstBounce.test.ts` (the sidecar-invocation layer itself) so the two
 * suites' fake-process setup can't drift apart.
 */

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/** Writes an executable shell script to `dir` that stands in for the real
 *  `hyperframes-vst` binary when pointed at via `HF_VST_HOST_CMD` — `body`
 *  is the fake process's behavior (e.g. copy input to output, or exit with
 *  a specific plugin-missing error). */
export function makeFakeSidecar(dir: string, body: string): string {
  const script = join(dir, "fake-vst.sh");
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
  return script;
}
