import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type {
  LocalShareAction,
  LocalShareAudience,
  LocalShareJob,
  LocalShareSnapshot,
} from "@hyperframes/studio-server";
import type { ReviewExportProgress } from "@hyperframes/share";
import type { ShareService } from "../share/service.js";
import { shareError } from "../share/errors.js";
import { createShareCsrf, localShareRequestAllowed } from "./shareBoundary.js";
import { trackShareInteraction } from "../share/telemetry.js";
import { shareEventInput } from "./shareEvents.js";
import { presentShare, presentSpaces } from "./sharePresentation.js";

const AUDIENCES: readonly LocalShareAudience[] = ["public", "team", "invite", "private"];
function actionInput(value: unknown): LocalShareAction | null {
  if (!isRecord(value)) return null;
  const record = Object.fromEntries(Object.entries(value));
  if (
    Object.keys(record).some((key) => !["action", "audience", "space", "videoOnly"].includes(key))
  )
    return null;
  const { action, audience, space, videoOnly } = record;
  if (!isAction(action)) return null;
  const chosen = AUDIENCES.find((mode) => mode === audience);
  if (audience !== undefined && !chosen) return null;
  const options = actionOptions(space, videoOnly);
  if (!options) return null;
  if (["share", "access"].includes(action) && !chosen) return null;
  return {
    action,
    audience: chosen,
    ...options,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is LocalShareAction["action"] {
  return ["share", "update", "access", "off", "on", "login"].some((action) => action === value);
}
function actionOptions(
  space: unknown,
  videoOnly: unknown,
): Pick<LocalShareAction, "space" | "videoOnly"> | null {
  if (!validSpace(space)) return null;
  if (videoOnly !== undefined && typeof videoOnly !== "boolean") return null;
  const options: Pick<LocalShareAction, "space" | "videoOnly"> = {};
  if (typeof space === "string") options.space = space;
  if (videoOnly === true) options.videoOnly = true;
  return options;
}
function validSpace(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value));
}

type CreateService = (
  path: string,
  progress: (value: ReviewExportProgress | null) => void,
) => Promise<ShareService>;
const defaultCreate: CreateService = async (path, progress) =>
  (await import("../share/service.js")).createShareService(path, progress, {
    surface: "local_studio",
  });

async function defaultLogin(): Promise<void> {
  const { startAuthorizationCodeFlow } = await import("../auth/oauth.js");
  await startAuthorizationCodeFlow({ timeoutMs: 300_000 });
}

export function mountShareRoutes(
  app: Hono,
  projectDir: string,
  create: CreateService = defaultCreate,
  login: () => Promise<void> = defaultLogin,
  track: typeof trackShareInteraction = trackShareInteraction,
): void {
  const routes = new Hono();
  const csrf = createShareCsrf();
  let job: LocalShareJob | null = null;
  let service: Promise<ShareService> | null = null;
  const getService = () =>
    (service ??= create(projectDir, (progress) => {
      if (job?.state === "running" && progress) job.step = progress.step;
    }));
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!localShareRequestAllowed(c.req.raw))
      return c.json({ code: "forbidden", message: "Open sharing from this local Studio." }, 403);
    if (
      c.req.path !== "/api/share/bootstrap" &&
      !csrf.accepts(c.req.header("x-hyperframes-share-csrf") ?? null)
    )
      return c.json({ code: "forbidden", message: "Refresh Studio to reconnect sharing." }, 403);
    return next();
  });
  routes.use("*", bodyLimit({ maxSize: 4096 }));
  routes.get("/bootstrap", (c) => c.json({ csrf: csrf.token }));
  routes.post("/events", async (c) => {
    const event = shareEventInput(await c.req.json().catch(() => null));
    if (!event) return c.json({ code: "invalid_event", message: "Unknown sharing event." }, 400);
    track(event, "local_studio");
    return c.body(null, 204);
  });
  routes.get("/snapshot", async (c) => {
    try {
      const sharing = await getService();
      const [state, spaces, capabilities] = await Promise.all([
        sharing.status(),
        sharing.spaces(),
        sharing.capabilities(),
      ]);
      return c.json({
        versionSharing: capabilities.versionSharing,
        share: presentShare(state),
        spaces: presentSpaces(spaces),
        job,
      } satisfies LocalShareSnapshot);
    } catch (error) {
      return c.json({ ...shareError(error), job }, 400);
    }
  });
  routes.get("/jobs/:id", (c) =>
    job?.id === c.req.param("id")
      ? c.json(job)
      : c.json(
          { code: "job_not_found", message: "Refresh sharing to see the current state." },
          404,
        ),
  );
  routes.post("/actions", async (c) => {
    const input = actionInput(await c.req.json().catch(() => null));
    if (!input)
      return c.json(
        { code: "invalid_action", message: "Choose a valid sharing action and audience." },
        400,
      );
    if (job?.state === "running")
      return c.json({ code: "share_busy", message: "Sharing is already in progress.", job }, 409);
    const current: LocalShareJob = {
      id: randomUUID(),
      state: "running",
      step: input.action === "login" ? "signing_in" : "preparing",
      result: null,
      error: null,
    };
    job = current;
    void (async () => {
      try {
        if (input.action === "login") {
          await login();
          service = null;
        }
        const sharing = await getService();
        const result = await executeAction(sharing, input);
        current.result = presentShare(result);
        current.state = "done";
      } catch (error) {
        current.error = shareError(error);
        current.state = "failed";
      }
    })();
    return c.json(current, 202);
  });
  app.route("/api/share", routes);
}

function executeAction(sharing: ShareService, input: LocalShareAction) {
  if (input.action === "login") return sharing.status();
  if (input.action === "access" && input.audience) return sharing.setAccess(input.audience);
  if (input.action === "off") return sharing.linkOff();
  if (input.action === "on") return sharing.linkOn();
  return sharing.run({
    action: input.action === "update" ? "update" : "share",
    audience: input.audience,
    space: input.space,
    videoOnly: input.videoOnly,
  });
}
