export type ReviewPoint = [number, number];
/** Where on the video a comment points, as the share page sends it. */
export type ReviewAnchor =
  | { version: 1; kind: "moment"; time: number; at?: ReviewPoint | null; from?: ReviewPoint | null }
  | { version: 1; kind: "range"; start: number; end: number }
  | { version: 1; kind: "region"; time: number; points: ReviewPoint[]; elements?: string[] }
  | { version: 1; kind: "element"; time: number; selector: string; label?: string | null }
  | { version: 1; kind: "track"; time: number; track: number };

/** A review comment as the window sees it: no signed URL, no author id. */
export interface ReviewComment {
  id: string;
  parentId: string | null;
  body: string;
  anchor: ReviewAnchor | null;
  /** The export the comment was left on. */
  origin: { versionId: string; exportedAt: string; width: number; height: number } | null;
  /** Project-relative path of the saved frame once it is on disk; null until then, when there is none, or once the
   * thread is resolved. */
  framePath: string | null;
  /** The comment carries a saved frame (the share page's capture can fail, leaving an anchored comment without one). */
  hasFrame: boolean;
  author: string;
  authorRole: "owner" | "editor" | "commenter" | "viewer" | "guest" | null;
  status: "open" | "resolved" | null;
  /** `completed`: accepted, and the edit it asked for is done (the `resolve` action). */
  resolution: "accepted" | "dismissed" | "completed" | null;
  /** The thread was forwarded for follow-up. Defaults to false when absent. */
  forwarded: boolean;
  revision: number;
  statusRevision: number | null;
  createdAt: string;
  deleted: boolean;
  canResolve: boolean;
  /** The server's hashed, project-scoped ref for a root comment, sent only to those who can decide; absent from older
   * servers. Usage events alone carry it: it is never shown and never goes into a request to the agent. */
  analyticsRef?: string;
}

/** The thread decisions the review server takes on its status route. */
export type ReviewAction = "accept" | "dismiss" | "reopen" | "resolve";

/** A thread write's answer: the thread's new status revision, or why it was refused. */
export type ReviewWriteResult =
  | { ok: true; statusRevision: number | null }
  | {
      ok: false;
      reason: "conflict" | "forwarded" | "offline" | "signed-out" | "denied" | "gone" | "failed";
    };

/** The project's review comments, kept current while the project is in view. */
export interface ReviewFeedView {
  /** off: the flag is off, or the project was never shared for review. */
  state: "off" | "loading" | "ready" | "reconnecting" | "signed-out" | "denied" | "gone";
  comments: ReviewComment[];
  latestVersionId: string | null;
  reviewUrl: string | null;
  syncedAt: number | null;
}
