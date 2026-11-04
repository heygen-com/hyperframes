import { basename } from "node:path";
import {
  addVersion,
  pendingReviewExport,
  reviewClient,
  reviewRecord,
  reviewStatus,
  reviewVersion,
  shareForReview,
  setReviewAccess,
  turnOffReviewLink,
  ReviewFailed,
  type AccessMode,
  type ReviewClient,
  type ReviewExportProgress,
  type ReviewShare,
} from "@hyperframes/share";
import { createShareAccess, shareSite } from "./auth.js";
import { bindCliShareProject } from "./host.js";
import { prepareShareRender } from "./render.js";

export interface ShareAction {
  action: "share" | "update" | "status" | "manage";
  audience?: AccessMode;
  space?: string;
  waitSeconds?: number;
}
function linkState(share: ReviewShare | null, ready: boolean): string {
  if (!share) return "not_shared";
  if (!share.url) return "link_off";
  return ready ? "ready" : "processing";
}
async function readStatus(dir: string, client: ReviewClient) {
  const share = await reviewStatus({ projectPath: dir, client });
  const project = await readProject(share, client);
  const latest = project?.latest_ready_version_id ?? null;
  const version = await reviewVersion(dir, { latestReadyVersionId: latest });
  const pending = await pendingReviewExport(dir);
  const activeUrl = share?.url ?? null;
  const processing = isProcessing(pending, share, latest);
  const ready = Boolean(activeUrl && latest && !processing);
  return {
    share,
    version,
    pending,
    state: linkState(share, ready),
    ready,
    ...statusLinks(activeUrl, ready, processing, project),
  };
}
async function readProject(share: ReviewShare | null, client: ReviewClient) {
  return share?.projectId ? client.project(share.projectId) : null;
}
function statusLinks(
  url: string | null,
  ready: boolean,
  processing: boolean,
  project: Awaited<ReturnType<typeof readProject>>,
) {
  return {
    url: ready ? url : null,
    previousUrl: processing && project?.latest_ready_version_id ? url : null,
    manageUrl: project?.authenticated_review_url ?? `${shareSite()}/shares`,
  };
}
function isProcessing(
  pending: Awaited<ReturnType<typeof pendingReviewExport>>,
  share: ReviewShare | null,
  latest: string | null,
) {
  return Boolean(pending && pending.projectId === share?.projectId && pending.videoId !== latest);
}
function selectSpace(spaces: Awaited<ReturnType<ReviewClient["spaces"]>>, id?: string) {
  if (id) return spaces.find((space) => space.space_id === id);
  return spaces.find((space) => space.bound) ?? spaces.find((space) => space.kind === "personal");
}
function assertExistingIntent(current: ShareState, input: ShareAction) {
  if (!current.share) {
    if (input.action === "update") throw new ReviewFailed(404, "not_shared");
    return;
  }
  if (input.space && current.share.space?.id !== input.space)
    throw new ReviewFailed(409, "workspace_mismatch");
  if (input.audience && current.share.access !== input.audience)
    throw new ReviewFailed(409, "manage_existing_audience");
}
function retrievesExisting(current: ShareState, input: ShareAction) {
  return current.share && input.action === "share" && current.state !== "processing";
}
async function preflightFirst(dir: string, client: ReviewClient, input: ShareAction) {
  const audience = input.audience;
  if (!audience) throw new ReviewFailed(400, "audience_required");
  const spaces = await client.spaces();
  const space = selectSpace(spaces, input.space);
  if (!space || !space.can_create_review) throw new ReviewFailed(403, "workspace_cannot_share");
  await assertQuota(dir, space);
  assertAudience(audience, space);
}
type Space = Awaited<ReturnType<ReviewClient["spaces"]>>[number];
async function assertQuota(dir: string, space: Space) {
  const record = await reviewRecord(dir);
  if (record?.registration || record?.projectId) return;
  if (space.review_entitlements?.can_register_project === false)
    throw new ReviewFailed(402, "review_project_limit_reached");
}
function assertAudience(audience: AccessMode, space: Space) {
  if (audience === "private") return;
  if (!space.review_entitlements?.allowed_collaborative_access_modes.includes(audience))
    throw new ReviewFailed(402, "review_subscription_required");
}
function assertResumeSource(current: ShareState, input: ShareAction) {
  if (current.share && input.action === "share" && current.version.source !== "ready")
    throw new Error(
      "The shared video is unfinished and local edits have changed. Run hyperframes share --update to explicitly upload the current project.",
    );
}
export function createShareService(
  projectPath: string,
  progress: (value: ReviewExportProgress | null) => void = () => {},
) {
  const dir = bindCliShareProject(projectPath);
  const auth = createShareAccess();
  const client = reviewClient(auth);
  const status = async () => {
    await auth.access();
    return readStatus(dir, client);
  };
  const upload = async (input: ShareAction) => {
    const end = Date.now() + (input.waitSeconds ?? 300) * 1000;
    let added = false;
    const failure = await addVersion({
      projectPath: dir,
      title: basename(dir),
      client,
      onProgress: progress,
      onAdded: () => {
        added = true;
      },
      open: () => Date.now() < end,
    });
    if (failure) throw new Error(failure);
    const result = await status();
    if (!added && !result.version.last?.current)
      return { ...result, state: "processing", ready: false, url: null };
    return result;
  };
  const run = async (input: ShareAction) => {
    const current = await status();
    if (input.action === "status" || input.action === "manage") return current;
    assertExistingIntent(current, input);
    if (retrievesExisting(current, input)) return current;
    if (!(await client.reviewFlags()).versionSharing)
      throw new ReviewFailed(403, "feature_unavailable");
    if (!current.share) await preflightFirst(dir, client, input);
    assertResumeSource(current, input);
    await prepareShareRender(dir);
    const share =
      current.share ??
      (await shareForReview({
        projectPath: dir,
        title: basename(dir),
        client,
        spaceId: input.space,
        audience: input.audience,
      }));
    if (share.takedown) throw new ReviewFailed(409, "moderation_hold");
    return upload(input);
  };
  return {
    status,
    run,
    capabilities: () => client.reviewFlags(),
    spaces: () => client.spaces(),
    setAccess: async (access: AccessMode) => {
      await setReviewAccess({ projectPath: dir, client, change: { access } });
      return status();
    },
    linkOff: async () => {
      await turnOffReviewLink({ projectPath: dir, client });
      return status();
    },
    linkOn: async () => {
      await shareForReview({ projectPath: dir, title: basename(dir), client });
      return status();
    },
  };
}
export type ShareService = ReturnType<typeof createShareService>;
export type ShareState = Awaited<ReturnType<typeof readStatus>>;
