import { join } from "node:path";
import {
  closeCaptureSession,
  createCaptureSession,
  readReferenceBackground,
  referenceBackgroundResult,
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  type ReferenceBackgroundResult,
} from "@hyperframes/engine";
import {
  closeFileServerSafely,
  createFileServer,
  type FileServerHandle,
  VIRTUAL_TIME_SHIM,
} from "../fileServer.js";
import type { ProducerLogger } from "../../logger.js";

interface PlanReferenceInput {
  projectDir: string;
  workDir: string;
  cfg: EngineConfig;
  options: CaptureOptions;
  log: ProducerLogger;
}

/** Optional evidence must not add capture capabilities to a browser-free planner. */
export async function readPlanReferenceBackground(
  input: PlanReferenceInput,
): Promise<ReferenceBackgroundResult> {
  let server: FileServerHandle | undefined;
  let session: CaptureSession | undefined;
  try {
    server = await createFileServer({
      projectDir: input.projectDir,
      compiledDir: join(input.workDir, "compiled"),
      port: 0,
      preHeadScripts: [VIRTUAL_TIME_SHIM],
      fps: input.options.fps,
    });
    session = await createCaptureSession(
      server.url,
      join(input.workDir, "reference"),
      {
        ...input.options,
        requiresWebGpu: false,
      },
      null,
      {
        ...input.cfg,
        forceScreenshot: true,
        useDrawElement: false,
        enablePageSideCompositing: false,
      },
    );
    const page = session.page;
    await page.goto(`${server.url}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: input.cfg.pageNavigationTimeout,
    });
    await page.evaluate("window.__hfFlushSync?.()");
    await page.waitForFunction(
      '!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)',
      { timeout: input.cfg.playerReadyTimeout, polling: 100 },
    );
    return referenceBackgroundResult(await readReferenceBackground(page));
  } catch (error) {
    input.log.debug("Reference background unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return referenceBackgroundResult(undefined);
  } finally {
    if (session) await closeCaptureSession(session).catch(() => undefined);
    if (server) closeFileServerSafely(server, "reference background", input.log);
  }
}
