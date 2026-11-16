// Stands in for hyperframeLintWorker.ts on a page that sends the parser into a runaway: "hang" spins and never
// answers, "alloc" allocates until the thread's heap cap ends it, "heap" answers with the thread's own heap limit.
import { appendFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { parentPort, workerData } from "node:worker_threads";

if (process.env.HF_LINT_FIXTURE_LOG) appendFileSync(process.env.HF_LINT_FIXTURE_LOG, "x");

if (workerData.html === "heap") {
  parentPort.postMessage({
    result: { heapLimitMb: getHeapStatistics().heap_size_limit / 1048576 },
  });
} else if (workerData.html === "hang") {
  for (;;);
} else {
  for (const kept = []; ; ) kept.push(new Array(100_000).fill(1));
}
