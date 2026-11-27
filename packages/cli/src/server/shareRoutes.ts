import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import type {
  LocalShareAction,
  LocalShareAudience,
  LocalShareJob,
  LocalShareSnapshot,
} from "@hyperframes/studio-server";
import { ReviewFailed, type ReviewExportProgress } from "@hyperframes/share";
import {
  listReferencedHiddenSourceAssets,
  referencedHiddenDigest,
} from "@hyperframes/share/projectSnapshot.mjs";
import type { ShareService } from "../share/service.js";
import { shareError } from "../share/errors.js";
import { localShareRequestAllowed } from "./shareBoundary.js";
import { trackShareInteraction } from "../share/telemetry.js";
import { shareEventInput } from "./shareEvents.js";
import { presentSpaces } from "./sharePresentation.js";

import { createShareSessions, shareSessionKey } from "./shareSessions.js";

import { presentPortableShare } from "./shareFreshness.js";

const AUDIENCES: readonly LocalShareAudience[] = ["public", "team", "invite", "private"];
function actionInput(value: unknown): LocalShareAction | null {
  if (!isRecord(value)) return null;
  const record = Object.fromEntries(Object.entries(value));
  if (
    Object.keys(record).some(
      (key) =>
        ![
          "action",
          "audience",
          "space",
          "videoOnly",
          "expectedReferencedHiddenDigest",
          "confirmedReview",
        ].includes(key),
    )
  )
    return null;
  const { action, audience, space, videoOnly, confirmedReview } = record;
  if (!isAction(action)) return null;
  const chosen = AUDIENCES.find((mode) => mode === audience);
  if (audience !== undefined && !chosen) return null;
  const options = actionOptions(space, videoOnly);
  if (!options) return null;
  if (["share", "access"].includes(action) && !chosen) return null;
  return withHiddenSummary(
    withConfirmedReview({ action, audience: chosen, ...options }, confirmedReview),
    record.expectedReferencedHiddenDigest,
  );
}

function withHiddenSummary(
  input: LocalShareAction | null,
  digest: unknown,
): LocalShareAction | null {
  if (input?.action !== "sync") return digest === undefined ? input : null;
  if (
    !input.space ||
    input.audience ||
    input.videoOnly ||
    typeof digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(digest)
  )
    return null;
  return { ...input, expectedReferencedHiddenDigest: digest };
}

function withConfirmedReview(input: LocalShareAction, review: unknown): LocalShareAction | null {
  if (input.action === "login" || review === undefined) return input;
  return review === null || validId(review) ? { ...input, confirmedReview: review } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is LocalShareAction["action"] {
  return ["share", "update", "access", "off", "on", "login", "sync"].some(
    (action) => action === value,
  );
}
function actionOptions(
  space: unknown,
  videoOnly: unknown,
): Pick<LocalShareAction, "space" | "videoOnly"> | null {
  if (!validSpace(space)) return null;
  if (!optionalBoolean(videoOnly)) return null;
  const options: Pick<LocalShareAction, "space" | "videoOnly"> = {};
  if (typeof space === "string") options.space = space;
  if (videoOnly === true) options.videoOnly = true;
  return options;
}
function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}
function validSpace(value: unknown): boolean {
  return value === undefined || validId(value);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

type CreateService = (
  path: string,
  progress: (value: ReviewExportProgress | null) => void,
) => Promise<ShareService>;
const defaultCreate: CreateService = async (path, progress) =>
  (await import("../share/service.js")).createShareService(path, progress, {
    surface: "local_studio",
    pinIdentity: true,
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
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  let job: LocalShareJob | null = null;
  const hasRunningJob = () => job?.state === "running";
  let jobOwner: string | null = null;
  let loginToken: string | null = null;
  const sessions = createShareSessions(() =>
    create(projectDir, (progress) => {
      if (job?.state === "running" && progress) job.step = progress.step;
    }),
  );
  const visibleJob = async (token: string) => {
    if (loginToken === token && job && job.state !== "done") return job;
    const session = sessions.get(token);
    if (!session) return null;
    const key = shareSessionKey(await (await session.get()).checkSession());
    return key === jobOwner ? job : null;
  };
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!localShareRequestAllowed(c.req.raw, c.env?.incoming?.socket.remoteAddress))
      return c.json({ code: "forbidden", message: "Open sharing from this local Studio." }, 403);
    if (
      c.req.path !== "/api/share/bootstrap" &&
      !sessions.get(c.req.header("x-hyperframes-share-csrf") ?? "")
    )
      return c.json({ code: "forbidden", message: "Refresh Studio to reconnect sharing." }, 403);
    return next();
  });
  routes.use("*", bodyLimit({ maxSize: 4096 }));
  routes.get("/bootstrap", (c) => c.json({ csrf: sessions.open() }));
  routes.get("/project-files", async (c) => {
    try {
      const space = c.req.query("space");
      if (!validId(space))
        return c.json({ code: "invalid_space", message: "Choose a workspace." }, 400);
      const sharing = await sessions.get(c.req.header("x-hyperframes-share-csrf")!)!.get();
      const state = await sharing.sourceStatus(space);
      const paths =
        state === "needs_sync" ? await listReferencedHiddenSourceAssets(projectDir) : [];
      return c.json({
        state,
        paths,
        digest: referencedHiddenDigest(paths),
        canReconnect:
          state === "at_limit" || (state === "needs_sync" && (await sharing.reconnect.available())),
      });
    } catch {
      return c.json(
        { code: "hidden_assets_unavailable", message: "Could not read the hidden asset summary." },
        400,
      );
    }
  });
  routes.get("/reconnect", async (c) => {
    const space = c.req.query("space");
    if (!validId(space)) return c.json({ message: "Choose a workspace." }, 400);
    const token = c.req.header("x-hyperframes-share-csrf")!;
    try {
      return c.json(await (await sessions.get(token)!.get()).reconnect.list(space));
    } catch (error) {
      return c.json(await presentError(error, token), 400);
    }
  });
  routes.post("/reconnect", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || !validId(body.choice))
      return c.json({ message: "Confirm a cloud project and workspace." }, 400);
    const token = c.req.header("x-hyperframes-share-csrf")!;
    try {
      const difference = await (await sessions.get(token)!.get()).reconnect.confirm(body.choice);
      return c.json(difference ?? { reconnected: true });
    } catch (error) {
      return c.json(await presentError(error, token), 400);
    }
  });
  routes.post("/events", async (c) => {
    const event = shareEventInput(await c.req.json().catch(() => null));
    if (!event) return c.json({ code: "invalid_event", message: "Unknown sharing event." }, 400);
    track(event, "local_studio");
    return c.body(null, 204);
  });
  routes.get("/snapshot", async (c) => {
    try {
      const sharing = await sessions.get(c.req.header("x-hyperframes-share-csrf")!)!.get();
      const [state, spaces, capabilities] = await Promise.all([
        sharing.status(),
        sharing.spaces(),
        sharing.capabilities(),
      ]);
      return c.json({
        versionSharing: capabilities.versionSharing,
        share: await presentPortableShare(projectDir, state),
        spaces: presentSpaces(spaces),
        job: await visibleJob(c.req.header("x-hyperframes-share-csrf")!),
      } satisfies LocalShareSnapshot);
    } catch (error) {
      return c.json(
        {
          ...(await presentError(error, c.req.header("x-hyperframes-share-csrf")!)),
          job:
            loginToken === c.req.header("x-hyperframes-share-csrf") && job && job.state !== "done"
              ? job
              : null,
        },
        400,
      );
    }
  });
  routes.get("/jobs/:id", async (c) => {
    try {
      const current = await visibleJob(c.req.header("x-hyperframes-share-csrf")!);
      return current?.id === c.req.param("id")
        ? c.json(current)
        : c.json(
            { code: "job_not_found", message: "Refresh sharing to see the current state." },
            404,
          );
    } catch (error) {
      return c.json(await presentError(error, c.req.header("x-hyperframes-share-csrf")!), 400);
    }
  });
  routes.post("/actions", async (c) => {
    const input = actionInput(await c.req.json().catch(() => null));
    if (!input)
      return c.json(
        { code: "invalid_action", message: "Choose a valid sharing action and audience." },
        400,
      );
    const token = c.req.header("x-hyperframes-share-csrf")!;
    const session = sessions.get(token)!;
    if (hasRunningJob())
      return c.json(
        {
          code: "share_busy",
          message: "Sharing is already in progress.",
          job: await visibleJob(token).catch(() => null),
        },
        409,
      );
    let owner: string | null = null;
    if (input.action !== "login") {
      try {
        owner = await sessionOwner(session);
        const refused = await targetRefusal(session, input.confirmedReview);
        if (refused) return c.json(refused.body, refused.status);
      } catch (error) {
        return c.json(await presentError(error, c.req.header("x-hyperframes-share-csrf")!), 400);
      }
    }
    if (hasRunningJob())
      return c.json({ code: "share_busy", message: "Sharing is already in progress." }, 409);
    jobOwner = owner;
    loginToken = input.action === "login" ? token : null;
    const current: LocalShareJob = {
      id: randomUUID(),
      state: "running",
      step: actionStep(input),
      result: null,
      error: null,
    };
    job = current;
    void runJob(current, input, session, token);
    return c.json(current, 202);
  });
  async function runJob(
    current: LocalShareJob,
    input: LocalShareAction,
    session: NonNullable<ReturnType<typeof sessions.get>>,
    token: string,
  ) {
    try {
      if (input.action === "login") {
        await login();
        session.reset();
      }
      const sharing = await session.get();
      const result = await executeAction(sharing, input);
      jobOwner = shareSessionKey(await sharing.checkSession());
      current.result = await presentPortableShare(projectDir, result);
      current.state = "done";
    } catch (error) {
      current.error = await presentError(error, token);
      current.state = "failed";
    }
  }
  async function presentError(error: unknown, token: string) {
    if (!(error instanceof ReviewFailed) || error.status !== 401) return shareError(error);
    const session = sessions.get(token);
    if (!session) return shareError(error);
    try {
      await (await session.get()).checkSession(true);
      return {
        code: "sharing_not_admitted",
        message:
          "You're signed in, but sharing isn't accepting this sign-in. Try again later or contact support.",
      };
    } catch (verificationError) {
      return shareError(verificationError);
    }
  }
  app.route("/api/share", routes);
}

function executeAction(sharing: ShareService, input: LocalShareAction) {
  if (input.action === "login") return sharing.status();
  if (input.action === "sync")
    return sharing.syncProjectFiles(input.space!, input.expectedReferencedHiddenDigest!);
  if (input.action === "access" && input.audience) return sharing.setAccess(input.audience);
  if (input.action === "off") return sharing.linkOff();
  if (input.action === "on") return sharing.linkOn();
  return sharing.run({
    action: input.action === "update" ? "update" : "share",
    audience: input.audience,
    space: input.space,
    videoOnly: input.videoOnly,
    confirmedReview: input.confirmedReview,
  });
}

async function targetRefusal(
  session: { get: () => Promise<ShareService> },
  confirmed?: string | null,
) {
  if (confirmed === undefined)
    return {
      status: 400 as const,
      body: { code: "confirmation_required", message: "Confirm this sharing change in Studio." },
    };
  if ((await (await session.get()).status()).reviewId === confirmed) return null;
  return {
    status: 409 as const,
    body: {
      code: "share_target_changed",
      message: "This project now points to a different shared review. Check it and try again.",
    },
  };
}

function actionStep(input: LocalShareAction) {
  return input.action === "login" ? "signing_in" : "preparing";
}
async function sessionOwner(session: { get: () => Promise<ShareService> }) {
  return shareSessionKey(await (await session.get()).checkSession());
}
