// Open in Studio from a share page (docs/sync-backed-sharing/contracts.md C1-C3, C7): the server's answers, and what
// Desktop's choice dialog is told.

/** C1: `GET /v1/hyperframes/reviews/{token}/open?version_id=`. */
export interface OpenSummaryDTO {
  /** `project_id` is the review project, which Work on {owner}'s project names on composition calls (C5). */
  project: { project_id: string; title: string; owner_name: string; space_name: string | null };
  version: {
    version_id: string;
    label: string;
    has_files: boolean;
    files?: { count: number; bytes: number } | null;
  };
  fallback_version: { version_id: string; label: string; published_at: string } | null;
  composition: {
    space_id: string;
    composition_id: string;
    latest_snapshot_id: string;
    newer_than_version: boolean;
  } | null;
  can_get: boolean;
  plan_space_id: string | null;
  plan_space_name: string | null;
}

/** One signed read URL in a sync download batch. */
export interface SignedBlobDTO {
  sha256: string;
  size: number;
  url: string;
  expires_at: string;
}

/** C2: `GET /v1/hyperframes/reviews/{token}/versions/{version_id}/files`, the snapshot's manifest and the first URLs
 * (at most 500 files). More, or fresh ones, come from `POST` on the same path with `{continuation_token, sha256s}`,
 * which answers exactly the sync `DownloadUrlsResponse`. */
export interface VersionFilesDTO {
  version_id: string;
  snapshot_id: string;
  manifest_sha256: string;
  manifest: { document: unknown; file_count: number; total_bytes: number };
  continuation_token: string;
  continuation_expires_at: string;
  urls: SignedBlobDTO[];
}

/** C2's refresh: the sync download batch for the same snapshot. */
export interface FileUrlsDTO {
  snapshot_id: string;
  manifest_sha256: string;
  continuation_token: string;
  continuation_expires_at: string;
  urls: SignedBlobDTO[];
}

/** The copy card: the version's files, the earlier version that has some, or nothing to copy. */
export type ShareCopyCard =
  | { at: "ready"; versionId: string; label: string; files: number; bytes: number }
  | {
      at: "fallback";
      label: string;
      fallback: { versionId: string; label: string; publishedAt: string };
    }
  | { at: "none"; label: string };

/** The Work on {owner}'s project card (C7): `open` to Get the owner's latest sync (`newer` when it is newer than the
 * version the page showed); `locked` when the signed-in workspace (`planSpace`) has no paid plan; `linked` when this
 * Mac already has a folder bound to it, with its edits not sent yet (null when they could not be counted). */
export type ShareWorkCard =
  | { at: "open"; newer: boolean }
  | { at: "locked"; planSpace: string | null }
  | { at: "linked"; unsent: number | null };

/** The one press a failed open offers beside Close; `none` when no press here can change the answer. */
export type ShareOpenOffer = "try_again" | "switch_account" | "sign_in" | "open_latest" | "none";

/** What the choice dialog shows for the share link main is opening; null when none is. */
export type ShareOpenView =
  | { id: string; at: "loading" }
  | { id: string; at: "failed"; sentence: string; offers: ShareOpenOffer }
  | {
      id: string;
      at: "choose";
      /** The review project (C1), kept for Work on {owner}'s project's composition calls. */
      projectId: string;
      title: string;
      owner: string;
      space: string | null;
      versionLabel: string;
      /** Null when the card is hidden: the project was never synced with files, or sync is off on this Mac. */
      work: ShareWorkCard | null;
      copy: ShareCopyCard;
    }
  | { id: string; at: "copying"; title: string; label: string; fraction: number | null }
  /** Work on {owner}'s project is getting the owner's latest sync into a new linked folder. */
  | { id: string; at: "linking"; title: string; owner: string };
