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

Before first registration the host must obtain explicit audience consent and prepare a current MP4. `shareForReview` registers/enables the link; it does not imply playable media. Await `addVersion`, then check the server project/latest ready version before reporting success. `addFirstVersion` starts background work and is for long-lived hosts only. `open: () => boolean` on `addVersion` bounds the polling lifetime without discarding the saved operation. `filesForExport(projectPath, renderedFingerprint)` optionally supplies an already-synced matching snapshot. Omit it for ordinary video sharing.

`reviewClient` exposes workspace capabilities, project listing/removal, grants, revision-checked access changes and export operations. `setReviewAccess`, `turnOffReviewLink`, and `removeReviewProject` retain the Desktop behavior. Enabling a revoked link produces a new URL. Disabling keeps the project and comments; removal is a separate operation.

Identity remains in `.hyperframes/review.json` (or the existing backend-specific filename); pending export requests remain in `.hyperframes/review-export.json`. No bearer is stored there. A copied folder must deliberately reset sharing identity when creating a new project; a renamed folder retains it. A malformed/unreadable record fails instead of silently registering a new project.

Metadata mutations and version uploads use separate cross-process locks under `.hyperframes`. Locks are acquired atomically with complete owner metadata. A lock is reclaimed only when the same machine proves its owner process is dead; live, foreign-machine and malformed locks are not stolen. Interrupted upload operations resume with their saved idempotency keys. Concurrent identical uploads re-read the completed version under the lock and do not create another version.

`projectFingerprint`, `snapshotProject`, and `snapshotFingerprint` use the same HTML-stamp-insensitive source comparison as Desktop. Export/history metadata, caches, hidden folders and installed packages are excluded. Hosts must record the fingerprint of the actual rendered source and must not relabel an old render with a newer fingerprint.

Public type exports include `ShareHost`, `ReviewClient`, `ReviewShare`, `VersionRequest`, and `Wire`, plus `@hyperframes/share/types/reviewWire` and `types/share`. Per-module entry points preserve Desktop imports during adoption.
