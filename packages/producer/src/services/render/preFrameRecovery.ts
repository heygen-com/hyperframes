import {
  type CaptureFailure,
  isLoopbackConnectionLoss,
  type LoopbackConnectionLoss,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import type { FileServerHandle, FileServerHealth } from "../fileServer.js";

/**
 * A loopback loss on a one-worker stream before any frame earns a file-server health probe (restart when
 * unhealthy). Retrying is shouldRetryViaPinnedFallback's call; a bare `Target closed` gets no probe.
 */
export function resolvePreFrameLoopbackLoss(input: {
  failure: CaptureFailure;
  workerCount: number;
  framesRendered: number;
}): LoopbackConnectionLoss | undefined {
  if (input.workerCount !== 1 || input.framesRendered !== 0) return undefined;
  return isLoopbackConnectionLoss(input.failure) ? input.failure : undefined;
}

/** Restart the file server when its own health probe fails: a loopback timeout cannot name the listener. */
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
