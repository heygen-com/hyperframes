/** Who a review link lets in, and as what, as the shared-reviews server names them. */
export type AccessMode = "public" | "invite" | "team" | "private";
export type LinkRole = "viewer" | "commenter" | "editor";

/** Whether the version on the page, or the one a press would add, carries the project's synced files. `included`: it
 * does. `not_synced`: the render is the project as it is now, but that is not what was last synced. `changed`: the
 * project moved past the render. `other_workspace`: the project syncs to `workspace`, not the one Desktop is signed
 * into, whose sign-in can't read its snapshots. `off`: share_files or sync is off, or there is no render to speak of. */
export type ReviewFiles =
  | { at: "off" }
  | { at: "included" }
  | { at: "not_synced" }
  | { at: "changed" }
  | { at: "other_workspace"; workspace: string };
export type ReviewFilesState = ReviewFiles["at"];

/** An upload under way: bytes sent of the archive's total (0 while the archive is made). */
export interface ShareProgress {
  sent: number;
  total: number;
}

/** A project's shared link, as the Share popover reads it. */
export interface ShareStatus {
  /** Null until the first share; changedFiles counts the project's files changed since that link was made. */
  link: { url: string; sharedAt: number; changedFiles: number } | null;
  /** The project's files in bytes, and the most a shared project may be. */
  bytes: number;
  limit: number;
  publishing: ShareProgress | null;
}

/** A project's review link, as the server holds it. */
export interface ReviewShare {
  projectId?: string;
  entitlements?: import("./reviewWire.js").ReviewEntitlements | null | undefined;
  sharingState?: import("./reviewWire.js").ShareDTO["sharing_state"];
  removed?: boolean;
  /** Null while the link is off. */
  url: string | null;
  access: AccessMode;
  role: LinkRole;
  commentsOn: boolean;
  /** The space the link belongs to; null from a server that does not say. */
  space: ReviewSpaceRef | null;
  /** The link's space is not the one Desktop is signed into. Everything still works there; this only names it. */
  elsewhere: boolean;
  /** A report paused access through the link: only the owner, invited people and workspace members get in. */
  held: boolean;
  /** Staff took the review down: only the owner can open it, at `page`, and it can't be shared again. */
  takedown?: { page: string };
  /** Where the page's versions stand; every answer over IPC carries it. */
  version?: ReviewVersion;
  /** After a change of space: the old link not yet turned off, and whether retries keep failing. */
  oldLink?: { space: string; stuck: boolean } | null;
}

/** An upload to the review page in flight. `checking` is the server's screening, which can take a while. */
export interface ReviewExportProgress {
  step: "preparing" | "uploading" | "processing" | "checking";
  sent: number;
  total: number;
  /** Checking for over 2 minutes: staff review can take a while. */
  slow?: boolean;
  /** How screening stands, from a server that says: held for a person at HeyGen (no bar, polled slowly, up to a day)
   * or checking. Absent from an older server, which leaves `slow` to say a long check. */
  screening?: "checking" | "held";
  /** Checking for over 15 minutes since the upload completed, by this computer's clock. */
  late?: boolean;
}

export interface ReviewVersion {
  /** The newest version this app put on the page; `current` when it is the project as it is now. */
  last: { exportedAt: string; current: boolean } | null;
  /** The newest export: ready to go up, none, not MP4, or older than the project now. */
  source: "ready" | "none" | "not-mp4" | "stale";
  exporting: ReviewExportProgress | null;
  /** The last run's sentence when it did not go up. */
  failure: string | null;
  /** False when the same video would be refused again (blocked, rejected, not available): no Try again. */
  retryable?: boolean;
  /** With `retryable` false: a smaller or shorter export can go up, so offer Export MP4. */
  exportHelps?: boolean;
  /** The watch ran out while the video was held for review: not a refusal, so it is never shown as one. */
  held?: boolean;
}

export interface ReviewSpaceRef {
  id: string;
  name: string;
  kind: "personal" | "team";
  /** Someone besides the link's owner (on a space list: besides the caller) is in the space; absent when the server
   * does not say, which Share reads as yes. */
  hasOtherMembers?: boolean;
}

/** A space the account is in. v1 shares into the signed-in one; the later workspace switch lists the rest. */
export interface ReviewSpace extends ReviewSpaceRef {
  /** Existing native registration verified by reading its owner share; a retry needs no new slot. */
  existingProjectId?: string;
  /** A durable registration request can be replayed; the server still decides admission. */
  resumingRegistration?: boolean;
  sharingState?: ReviewShare["sharingState"];
  entitlements?: import("./reviewWire.js").ReviewEntitlements | null | undefined;
  lastUsedAt: string | null;
  canCreate: boolean;
  /** The workspace Desktop is signed into, where a new link goes. */
  signedIn: boolean;
}

export type ReviewAccessChange = { access: ReviewShare["access"] } | { role: ReviewShare["role"] };

/** A share link as Settings' Cloud list shows it (packages/agent-runtime/src/share/reviewLinkStates.mjs). */
export interface ReviewLinkState {
  state: "on" | "off" | "paused" | "taken-down";
  access: import("./share.js").AccessMode;
  /** Why a paused link is paused: a report HyperFrames looks into, or a plan that no longer includes it. */
  pausedFor?: "report" | "plan";
}
