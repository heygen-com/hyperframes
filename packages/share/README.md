# @hyperframes/share

Node-only sharing kernel for Desktop, the CLI and local Studio's server. All hosts use the same review project, link settings, video versions and persisted retry state. This package does not render videos, sign users in, or define plan policy.

```js
import {
  bindShareHost,
  reviewClient,
  signedInRequest,
  projectFingerprint,
  shareForReview,
  addVersion,
  reviewStatus,
  reviewVersion,
} from "@hyperframes/share";

bindShareHost({
  normalize: realpathSync,
  channelSite: "https://hyperframes.dev",
  signinSites: ["https://hyperframes.dev"],
  reviewUploadOrigins: ["https://review-bucket.s3.us-east-1.amazonaws.com"],
  signedInRequest,
  projectFingerprint,
  latestExportFile, // (dir) => { path, fingerprint, id } | null
  ffBinary, // ('ffprobe') => executable path
});
const client = reviewClient({ access, signedInEmail });
const share = await shareForReview({ projectPath, title, client, audience: "public" });
await addVersion({ projectPath, title, client, onProgress });
const [current, version] = await Promise.all([
  reviewStatus({ projectPath, client }),
  reviewVersion(projectPath),
]);
```

`access(refusedToken?)` returns `{ token, heygen, heygenApi, owner }` or null. It is read for every request. A refused bearer is passed back so the host can refresh it. `heygen` is the review API base. A host can inject its own `signedInRequest` to retain network tracing. `execFile` can likewise be injected to retain native process policy.

Video uploads require exact storage origins from trusted host configuration. Set `reviewUploadOrigins` on the host or supply a comma-separated `HYPERFRAMES_REVIEW_UPLOAD_ORIGINS` environment variable. Configure the bucket-specific HTTPS origins used by the signer. Use URL origins without paths, trailing slashes, or wildcards. Local tests can explicitly allow an HTTP origin on `127.0.0.1`. An empty list refuses every video upload.

Before first registration the host must obtain explicit audience consent. For a video share, prepare a current MP4, call `shareForReview`, then await `addVersion` and check the latest ready version before reporting success. `shareForReview` registers or enables the link. Hosts can pass `beforeOpen(projectId)` to prepare or validate other review content, such as a synced storyboard. The hook runs under the review lock after registration is saved, only for the first opening or when reopening a revoked link, before link or audience changes. An already-open link returns its status without running the hook. If preparation fails, retry uses the same registration, so the hook must be safe to retry. Keep the hook short because it holds the review lock. That lock is not reentrant: the hook must not call same-project review-lock operations such as `shareForReview`, `setReviewAccess`, `turnOffReviewLink`, `removeReviewProject`, or review-switch operations; they would wait on the hook itself. Use direct client requests for preparation instead.

`addFirstVersion` starts background work and is for long-lived hosts only. `open: () => boolean` on `addVersion` bounds the polling lifetime without discarding the saved operation. `filesForExport(projectPath, renderedFingerprint)` optionally supplies an already-synced matching snapshot. Omit it for ordinary video sharing.

`reviewClient` exposes workspace capabilities, project listing/removal, grants, revision-checked access changes and export operations. `setReviewAccess`, `turnOffReviewLink`, and `removeReviewProject` retain the Desktop behavior. Enabling a revoked link produces a new URL. Disabling keeps the project and comments; removal is a separate operation.

Hosts can sync a renamed project with `client.updateTitle(id, { title, expected_title })`. An optional `fromReview` hook on `addVersion` supplies feedback attribution after sign-in on each send. Pass the same hook to `recheckHeld` or `refreshReviewExport` to clear the recorded activity when a pending version becomes ready.

If a create request had no confirmed outcome, a later refusal keeps the original request and its idempotency key. The original request may still create a version. When the server has no more specific recovery instruction, check the review page and export a new video with different settings before adding another version.

Identity remains in the project’s generated review.json metadata (or the existing backend-specific filename); pending export requests remain in the generated review-export.json metadata. No bearer is stored there. A copied folder must deliberately reset sharing identity when creating a new project; a renamed folder retains it. A malformed/unreadable record fails instead of silently registering a new project. The error identifies the metadata file and asks the owner to restore a backup or contact support to reconnect the existing share; deleting the file can discard recovery state or consume another slot.

Metadata mutations and version uploads use separate cross-process locks under `.hyperframes`. Locks publish complete owner metadata with a hard link or, on volumes that reject hard links, an atomic rename of a directory containing the owner record. The kernel reclaims a recorded owner only when the same machine proves that process is dead. Older clients may report a filesystem error while a fallback directory is held. An empty legacy lock file still requires manual recovery after stopping all sharing processes that can access the project. Interrupted upload operations resume with their saved idempotency keys. Concurrent identical uploads re-read the completed version under the lock and do not create another version.

`snapshotProject` skips symlinks by default, retaining Desktop watcher, change-set and saved-render compatibility; `snapshotFiles` also skips symlink entries. Set `followSymlinks: true` for a link-aware full snapshot. The CLI-facing `projectFingerprint` opts into following linked media (with cycle detection), so edited linked files invalidate its cached render. Both comparisons ignore HTML ID stamps. Export/history metadata, caches, hidden folders and installed packages are excluded. Hosts must record the fingerprint of the actual rendered source and must not relabel an old render with a newer fingerprint.

Public type exports include `ShareHost`, `ReviewClient`, `ReviewShare`, `VersionRequest`, and `Wire`, plus `@hyperframes/share/types/reviewWire` and `types/share`. Per-module entry points preserve Desktop imports during adoption.
