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

Video and source uploads require exact storage origins from trusted host configuration. Set `reviewUploadOrigins` on the host or supply a comma-separated `HYPERFRAMES_REVIEW_UPLOAD_ORIGINS` environment variable. Configure the bucket-specific HTTPS origins used by the signer. Use URL origins without paths, trailing slashes, or wildcards. Local tests can explicitly allow an HTTP origin on `127.0.0.1`. An empty list refuses every upload.

Before first registration the host must obtain explicit audience consent and prepare a current MP4. `shareForReview` registers/enables the link; it does not imply playable media. Await `addVersion`, then check the server project/latest ready version before reporting success. `addFirstVersion` starts background work and is for long-lived hosts only. `open: () => boolean` on `addVersion` bounds the polling lifetime without discarding the saved operation. `filesForExport(projectPath, renderedFingerprint)` optionally supplies an already-synced matching snapshot. Omit it for ordinary video sharing.

`reviewClient` exposes workspace capabilities, project listing/removal, grants, revision-checked access changes and export operations. `setReviewAccess`, `turnOffReviewLink`, and `removeReviewProject` retain the Desktop behavior. Enabling a revoked link produces a new URL. Disabling keeps the project and comments; removal is a separate operation.

Hosts can sync a renamed project with `client.updateTitle(id, { title, expected_title })`. An optional `fromReview` hook on `addVersion` supplies feedback attribution after sign-in on each send. Pass the same hook to `recheckHeld` or `refreshReviewExport` to clear the recorded activity when a pending version becomes ready.

Identity remains in the project’s generated review.json metadata (or the existing backend-specific filename); pending export requests remain in the generated review-export.json metadata. No bearer is stored there. A copied folder must deliberately reset sharing identity when creating a new project; a renamed folder retains it. A malformed/unreadable record fails instead of silently registering a new project. The error identifies the metadata file and asks the owner to restore a backup or contact support to reconnect the existing share; deleting the file can discard recovery state or consume another slot.

Metadata mutations and version uploads use separate cross-process locks under `.hyperframes`. Locks normally publish complete owner metadata with a hard link. Volumes that reject hard links use exclusive file creation instead; contenders wait while the owner metadata is written. An interrupted empty/malformed fallback lock is not automatically stolen. A lock is reclaimed only when the same machine proves its owner process is dead; live, foreign-machine and malformed locks are not stolen. Interrupted upload operations resume with their saved idempotency keys. Concurrent identical uploads re-read the completed version under the lock and do not create another version.

`snapshotProject` skips symlinks by default, retaining Desktop watcher, change-set and saved-render compatibility; `snapshotFiles` also skips symlink entries. Set `followSymlinks: true` for a link-aware full snapshot. The CLI-facing `projectFingerprint` opts into following linked media (with cycle detection), so edited linked files invalidate its cached render. Both comparisons ignore HTML ID stamps. Export/history metadata, caches, hidden folders and installed packages are excluded. Hosts must record the fingerprint of the actual rendered source and must not relabel an old render with a newer fingerprint.

Public type exports include `ShareHost`, `ReviewClient`, `ReviewShare`, `VersionRequest`, and `Wire`, plus `@hyperframes/share/types/reviewWire` and `types/share`. Per-module entry points preserve Desktop imports during adoption.

## Source snapshots

`shareSources({access, spaceId})` prepares editable source for a rendered version:

```js
const sources = shareSources({ access, spaceId });
const result = await sources.prepare(projectPath, renderedFingerprint);
if (result.at === "ready") {
  await addVersion({
    projectPath,
    title,
    client,
    filesForExport: sources.filesForExport,
    requireSource: true,
  });
}
```

Handle `unavailable.reason` before creating the video version. Plan ineligibility
can use video-only; changed source, conflicts and unexpected upload failures need
an explicit choice to omit source. The CLI exposes `--video-only` for that choice.
`filesForExport` only validates already-prepared source; it does not upload.

The adapter uses the portable-source-v4 capture/manifest rules and
multipart transport. The pinned policy, Unicode 15.1 registry (with its license),
and manifest test vectors are checked into this repository. Source is captured through
verified file handles; upload bytes are streamed and checked against their hash.
Workspace limits, upload receipts and published snapshot identity are checked.
Pending uploads retain their original idempotency key across retries. A conflict
is never auto-resolved. When local source changes, the adapter cancels an older
pending upload before starting another; uploads under verification are preserved.
A stalled storage PUT stops after 60 seconds without progress and can retry with
the same upload identity.

Default state uses `.hyperframes/share-sync.<backend-hash>.json`, with strict
account/backend/realpath binding, private atomic writes, and a process lock.
Hosts can inject a compatible `store` or read-only `existingBinding` resolver.
An external Desktop binding is reused only when exact and settled; this adapter
never writes Desktop's binding or starts a second upload on its behalf.

Source sharing requires an authorized account and a workspace that supports editable project files.
Source-plan/feature eligibility remains server controlled. Automated fixtures do
not establish live entitlement, moderation, source download or outside-editor
acceptance. See [the source guide](https://hyperframes.heygen.com/developers/share-source).

Tests run locally without an account or service credentials:

```bash
node --test packages/share/tests/*.test.mjs
bun run --cwd packages/share build
```

The bundled Unicode data records SHA-256 hashes for its inputs in `sources`.
Those files are published in the [Unicode 15.1 database](https://www.unicode.org/Public/15.1.0/ucd/).
Keep the included Unicode license with redistributed data. The pinned version
keeps path comparison consistent across Node versions and operating systems.
