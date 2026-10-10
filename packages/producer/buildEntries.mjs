// Workers sit beside the bundles because healthWorker.ts and shaderTransitionWorkerPool.ts
// look for them in their own module's directory.
export const BUNDLES = [
  { entry: "src/index.ts", outfile: "dist/index.js" },
  { entry: "src/server.ts", outfile: "dist/public-server.js" },
  { entry: "src/distributed.ts", outfile: "dist/distributed.js" },
];
export const WORKERS = [
  { entry: "src/services/shaderTransitionWorker.ts", outfile: "dist/shaderTransitionWorker.js" },
  { entry: "src/services/healthWorkerThread.ts", outfile: "dist/healthWorkerThread.js" },
];
