// Lints workerData's page on its own heap, so a parser runaway ends this thread, not the server.
// One thread per request: /lint is not hot, and a stuck page cannot hold up another.
import { parentPort, workerData } from "node:worker_threads";
import { lintHyperframeHtml, type HyperframeLinterOptions } from "@hyperframes/lint";

const { html, opts } = workerData as { html: string; opts?: HyperframeLinterOptions };

try {
  parentPort?.postMessage({ result: await lintHyperframeHtml(html, opts) });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
