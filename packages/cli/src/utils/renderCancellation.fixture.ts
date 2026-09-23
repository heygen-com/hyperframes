// fallow-ignore-file unused-file
import { writeFileSync } from "node:fs";
import { registerRootExitRequester, requestCliExit } from "./commandResult.js";
import { runCancellableProcess } from "./cancellableProcess.js";
import { createRenderCancellationScope } from "./renderCancellation.js";

const [outputPath, readyPath, rawWriteDelay] = process.argv.slice(2);
if (!outputPath || !readyPath || !rawWriteDelay) throw new Error("Missing fixture arguments");

const writeDelay = Number(rawWriteDelay);
const cancellation = createRenderCancellationScope({ parentPollIntervalMs: 25 });
registerRootExitRequester(() => {
  cancellation.dispose();
  process.kill(process.pid, "SIGTERM");
});
const setupScript = `
  const { writeFileSync } = await import("node:fs");
  const [outputPath, rawDelay] = process.argv.slice(1);
  setTimeout(() => writeFileSync(outputPath, "stale render output"), Number(rawDelay));
`;
const setup = runCancellableProcess(
  process.execPath,
  ["--input-type=module", "--eval", setupScript, outputPath, String(writeDelay)],
  {
    signal: cancellation.signal,
    onSpawn: (setupPid) => {
      writeFileSync(
        readyPath,
        JSON.stringify({ pid: process.pid, parentPid: process.ppid, setupPid }),
      );
    },
  },
);

try {
  await setup;
} catch (error) {
  if (!cancellation.signal.aborted) throw error;
  requestCliExit(1);
  await new Promise<never>(() => undefined);
} finally {
  cancellation.dispose();
}
