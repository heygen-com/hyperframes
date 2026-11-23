// Stands in for compileWorker.ts. workerData.projectDir picks the behaviour: "hang" spins in one
// synchronous pass and never answers, "typed" fails with a typed producer error.
import { parentPort, workerData } from "node:worker_threads";

if (workerData.projectDir === "hang") {
  for (;;);
} else if (workerData.projectDir === "typed") {
  parentPort.postMessage({
    type: "error",
    error: {
      name: "CompositionTooLargeError",
      message: "too large",
      props: {
        code: "COMPOSITION_TOO_LARGE",
        owner: "user",
        retryable: false,
        publicMetadata: { bytes: 2, limitBytes: 1 },
      },
    },
  });
}
