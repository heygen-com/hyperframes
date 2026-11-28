// fallow-ignore-file unused-file
import { outputWritten, registerRootExitRequester } from "./commandResult.js";
import { createRenderCancellationScope } from "./renderCancellation.js";
import { reportRenderCancellation } from "./renderJsonResult.js";

const json = process.argv[2] === "json";
const cancellation = createRenderCancellationScope({ parentPollIntervalMs: 25 });
registerRootExitRequester((exitCode) => {
  cancellation.dispose();
  void outputWritten().then(() => process.exit(exitCode));
});
process.stderr.write("ready\n");

const keepAlive = setInterval(() => undefined, 1_000);
try {
  await new Promise<never>((_resolve, reject) => {
    const stopped = () => reject(cancellation.signal.reason);
    if (cancellation.signal.aborted) stopped();
    else cancellation.signal.addEventListener("abort", stopped, { once: true });
  });
} catch (reason) {
  if (!cancellation.signal.aborted) throw reason;
  reportRenderCancellation(reason, json);
}
clearInterval(keepAlive);
