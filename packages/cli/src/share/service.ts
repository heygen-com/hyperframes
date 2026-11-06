import { basename } from "node:path";
import { CliUsageError } from "../utils/commandResult.js";
import {
  addVersion,
  pendingReviewExport,
  refreshReviewExport,
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
import { assertReviewUploadStorage, bindCliShareProject } from "./host.js";
import { prepareShareRender } from "./render.js";
import { prepareCliShareSource, uncheckedSource, type PreparedShareSource } from "./sources.js";

export interface ShareAction {
  action: "share" | "update" | "status" | "manage";
  audience?: AccessMode;
  space?: string;
  waitSeconds?: number;
  videoOnly?: boolean;
}
function linkState(share: ReviewShare | null, ready: boolean): string {
  if (!share) return "not_shared";
  if (!share.url) return "link_off";
  return ready ? "ready" : "processing";
}
async function readStatus(dir: string, client: ReviewClient, expectedProjectId?: string) {
  const share = await reviewStatus({ projectPath: dir, client });
  if (expectedProjectId) assertUploadProject(share, expectedProjectId);
  if (share) await refreshReviewExport(dir, client);
  const project = await readProject(share, client);
  const latest = project?.latest_ready_version_id ?? null;
  const version = await reviewVersion(dir, { latestReadyVersionId: latest });
  const pending = await pendingReviewExport(dir);
  const activeUrl = share?.url ?? null;
  const processing = isProcessing(pending, share);
  const ready = Boolean(activeUrl && latest && !processing);
  return {
    share,
    version,
    pending,
    state: linkState(share, ready),
    ready,
    source: uncheckedSource(),
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
) {
  return Boolean(pending && pending.projectId === share?.projectId);
}
function selectSpace(spaces: Awaited<ReturnType<ReviewClient["spaces"]>>, id?: string) {
  if (id) return spaces.find((space) => space.space_id === id);
  return spaces.find((space) => space.bound) ?? spaces.find((space) => space.kind === "personal");
}
function assertUploadProject(share: ReviewShare | null, expectedId?: string): string {
  const id = share?.projectId;
  if (!id || (expectedId && id !== expectedId))
    throw new ReviewFailed(409, "review_binding_changed");
  return id;
}
function assertExistingIntent(share: ReviewShare | null, input: ShareAction) {
  if (!share) {
    if (input.action === "update") throw new ReviewFailed(404, "not_shared");
    return;
  }
  if (input.space && share.space?.id !== input.space)
    throw new ReviewFailed(409, "workspace_mismatch");
  if (input.audience && share.access !== input.audience)
    throw new ReviewFailed(409, "manage_existing_audience");
}
function retrievesExisting(current: ShareState, input: ShareAction) {
  return current.share && input.action === "share" && current.state !== "processing";
}
async function preflightFirst(dir: string, client: ReviewClient, input: ShareAction) {
  const audience = input.audience;
  if (!audience)
    throw new CliUsageError(
      "Choose an audience with --public, --team, --invite-only or --private. --yes is not audience consent.",
      { code: "audience_required" },
    );
  const [spaces, record] = await Promise.all([client.spaces(), reviewRecord(dir)]);
  const space = selectSpace(spaces, registrationSpace(record, input.space));
  if (!space || !space.can_create_review) throw new ReviewFailed(403, "workspace_cannot_share");
  assertQuota(record, space);
  assertAudience(audience, space);
  return space.space_id;
}
type Space = Awaited<ReturnType<ReviewClient["spaces"]>>[number];
type ShareRecord = Awaited<ReturnType<typeof reviewRecord>>;
function registrationSpace(record: ShareRecord, requested?: string) {
  if (!record?.spaceId) return requested;
  if (!requested || requested === record.spaceId) return record.spaceId;
  if (record.registration || record.projectId) throw new ReviewFailed(409, "workspace_mismatch");
  return requested;
}
function assertQuota(record: ShareRecord, space: Space) {
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
  const status = async (expectedProjectId?: string) => {
    await auth.access();
    return readStatus(dir, client, expectedProjectId);
  };
  const upload = async (input: ShareAction, projectId: string, sources: PreparedShareSource) => {
    const end = Date.now() + (input.waitSeconds ?? 300) * 1000;
    let added = false;
    const failure = await addVersion({
      projectPath: dir,
      projectId,
      title: basename(dir),
      client,
      onProgress: progress,
      allowPending: true,
      ...(sources.filesForExport && { filesForExport: sources.filesForExport }),
      requireSource: sources.requireSource,
      onAdded: () => {
        added = true;
      },
      open: () => Date.now() < end,
    });
    if (failure) throw new Error(failure);
    const result = { ...(await status(projectId)), source: sources.source };
    if (result.version.failure) throw new Error(result.version.failure);
    if (!added && !result.version.last?.current)
      return { ...result, state: "processing", ready: false, url: null };
    return result;
  };
  const uploadTarget = async (current: ReviewShare | null, input: ShareAction, space?: string) => {
    const share = current
      ? await reviewStatus({ projectPath: dir, client })
      : await shareForReview({
          projectPath: dir,
          title: basename(dir),
          client,
          spaceId: space,
          audience: input.audience,
        });
    const projectId = assertUploadProject(share, current?.projectId);
    if (share?.takedown) throw new ReviewFailed(409, "moderation_hold");
    assertExistingIntent(share, {
      ...input,
      space: input.space ?? space,
      audience: input.audience ?? current?.access,
    });
    return { projectId, spaceId: share?.space?.id };
  };
  const run = async (input: ShareAction) => {
    const current = await status();
    if (input.action === "status" || input.action === "manage") return current;
    assertExistingIntent(current.share, input);
    if (retrievesExisting(current, input)) return current;
    const flags = await client.reviewFlags();
    if (!flags.versionSharing) throw new ReviewFailed(403, "feature_unavailable");
    const space = current.share
      ? current.share.space?.id
      : await preflightFirst(dir, client, input);
    assertResumeSource(current, input);
    assertReviewUploadStorage();
    await prepareShareRender(dir);
    const target = await uploadTarget(current.share, input, space);
    const sources = await prepareCliShareSource(dir, auth.access, target.spaceId, {
      videoOnly: input.videoOnly,
      shareFiles: flags.shareFiles,
    });
    return upload(input, target.projectId, sources);
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
