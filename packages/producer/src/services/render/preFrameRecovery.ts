import {
  type CaptureFailure,
  isLoopbackConnectionLoss,
  type LoopbackConnectionLoss,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import type { FileServerHandle, FileServerHealth } from "../fileServer.js";

/**
 * Pre-frame loopback recovery for an ordinary one-worker screenshot stream.
 *
 * The streaming stage can lose its loopback connection — to the file server or
 * to Chrome's DevTools port — before the first frame is captured. That is the
 * only transient shape this path retries, and this function is its single
 * owner: the failure must name a loopback endpoint (`isLoopbackConnectionLoss`),
 * the stream must be single-worker (a multi-worker stream has its own adaptive
 * retry), and no frame may have been written yet (a later loss is a different
 * failure and would restart the whole render from frame 0 on the slower
 * path). A bare `Target closed` — Chrome killed by SIGTERM on a host that is
 * going away — carries no endpoint and is deliberately excluded, matching
 * the encoder-interruption rule in `shouldRetryViaPinnedFallback`.
 */
export function resolvePreFrameLoopbackLoss(input: {
  failure: CaptureFailure;
  workerCount: number;
  framesRendered: number;
}): LoopbackConnectionLoss | undefined {
  if (input.workerCount !== 1 || input.framesRendered !== 0) return undefined;
  return isLoopbackConnectionLoss(input.failure) ? input.failure : undefined;
}

/**
 * Decide whether the retry needs a fresh file server and perform the restart.
 * The restart rebinds the caller's active server; nothing is returned.
 *
 * The probe result is passed in (not taken here) so the caller can start it
 * while the failed browser session is still closing. The restart keys on the
 * probe, not on the reported endpoint: a bare loopback timeout cannot prove
 * which listener was gone, so the file server's own health is the evidence.
 */
export async function recoverPreFrameFileServer(input: {
  failure: LoopbackConnectionLoss;
  fileServer: Pick<FileServerHandle, "url" | "port">;
  health: Promise<FileServerHealth>;
  restart: () => Promise<Pick<FileServerHandle, "url" | "port">>;
  log: Pick<ProducerLogger, "warn">;
}): Promise<void> {
  const health = await input.health;
  const endpointOwner =
    input.failure.endpoint.port === input.fileServer.port ? "file_server" : "browser_or_unknown";
  input.log.warn("[Render] Pre-frame capture endpoint health", {
    reportedEndpoint: `${input.failure.endpoint.host}:${input.failure.endpoint.port}`,
    endpointOwner,
    fileServerEndpoint: input.fileServer.url,
    fileServerHealthy: health.healthy,
    fileServerStatus: health.status,
    healthProbeMs: health.durationMs,
    healthProbeError: health.error,
  });
  if (health.healthy) return;
  const fileServer = await input.restart();
  input.log.warn("[Render] Recreated unhealthy file server before bounded capture retry", {
    fileServerEndpoint: fileServer.url,
  });
}
