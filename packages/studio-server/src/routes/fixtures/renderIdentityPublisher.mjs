import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (isMainThread) {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { root: process.argv[2], format: process.argv[3], gate },
  });
  const timeout = setTimeout(() => process.exit(2), 20_000);
  worker.on("message", (message) => {
    process.send?.(message);
    if (message.type === "released") {
      clearTimeout(timeout);
      process.disconnect();
    }
  });
  worker.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  process.on("message", (message) => {
    if (message === "release") {
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
    }
  });
  process.on("disconnect", () => {
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0);
  });
} else {
  const unlink = fs.unlinkSync;
  fs.unlinkSync = (path) => {
    parentPort.postMessage({ type: "published" });
    if (Atomics.wait(workerData.gate, 0, 0, 15_000) === "timed-out")
      throw new Error("Publisher release timeout");
    unlink(path);
  };
  syncBuiltinESMExports();
  const { tsImport } = await import("tsx/esm/api");
  const { RenderIdentityStore } = await tsImport(
    "../../helpers/renderIdentityStore.ts",
    import.meta.url,
  );
  const sequence = workerData.format === "png-sequence";
  await new RenderIdentityStore(async () => [workerData.root]).claim(
    workerData.root,
    "held",
    sequence ? "" : ".mp4",
    sequence ? "directory" : "file",
  );
  parentPort.postMessage({ type: "released" });
}
