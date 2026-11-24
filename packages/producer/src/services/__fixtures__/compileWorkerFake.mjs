// Stands in for compileWorker.ts. workerData.projectDir picks the behaviour: "hang" spins in one
// synchronous pass and never answers, "typed" fails with a typed producer error, "child" starts a
// long-running child writing a temp file in downloadDir, reports both as the real worker does, then hangs.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

if (workerData.projectDir === "child") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const output = join(workerData.downloadDir, "clip.webm.tmp-1-2");
  writeFileSync(output, "partial");
  writeFileSync(join(workerData.downloadDir, "child.pid"), String(child.pid));
  parentPort.postMessage({ type: "child", pid: child.pid, output });
  // A second child names a file outside the compile's folders, which the parent must leave alone.
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(join(workerData.downloadDir, "other.pid"), String(other.pid));
  const outside = join(dirname(workerData.downloadDir), "outside.webm.tmp-1-2");
  parentPort.postMessage({ type: "child", pid: other.pid, output: outside });
  // Lets the message reach the parent before this thread stops answering.
  setTimeout(() => {
    for (;;);
  }, 50);
} else if (workerData.projectDir === "hang") {
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
