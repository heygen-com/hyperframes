# Transparent Proxy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #2462 safe and predictable for hostile codecs without adding a second media runtime.

**Architecture:** Keep the FFmpeg subprocess proxy boundary, but centralize codec/alpha policy and project-path identity. Bound every long-lived resource (queue, failure memory, probe memory, caller wait, and disk cache), make publish outcomes explicit, and keep proxy work off browser-safe happy paths.

**Tech Stack:** TypeScript, Node.js filesystem/process APIs, FFmpeg/ffprobe, Vitest, oxlint/oxfmt.

---

## File map

- `packages/studio-server/src/helpers/mediaProxyPolicy.ts`: one codec/alpha decision function.
- `packages/studio-server/src/helpers/projectMediaPath.ts`: canonical project-relative path resolution and containment.
- `packages/studio-server/src/helpers/proxyCache.ts`: cache accounting and bounded LRU cleanup.
- `packages/studio-server/src/helpers/proxyTranscoder.ts`: bounded queue, TTL failures, pixel/color normalization.
- `packages/studio-server/src/helpers/mediaCodecMap.ts`: cheap candidate filtering and bounded probe cache.
- `packages/studio-server/src/helpers/mediaProxyPreview.ts`: inject only when a map is non-empty.
- `packages/studio-server/src/routes/preview.ts`: typed 503/timeout responses and policy-safe rescue.
- `packages/cli/src/utils/staticProjectServer.ts`: matching static-server behavior.
- `packages/cli/src/utils/publishProxyBake.ts`: structured bake manifest and bounded waits.
- `packages/cli/src/utils/checkBrowser.ts`: bounded prewarm and stable diagnostic codes.
- `packages/cli/src/commands/preview.ts`: complete flag/config forwarding.
- `packages/cli/src/commands/play.ts`: stream proxy files instead of buffering.
- `.gitignore`: exclude `.transcode-cache/`.

### Task 1: Normalize proxy output for browser playback

**Files:**
- Modify: `packages/studio-server/src/helpers/proxyTranscoder.ts`
- Test: `packages/studio-server/src/helpers/proxyTranscoder.test.ts`

- [ ] **Step 1: Write failing argv tests**

Add tests asserting every transcode includes opaque 8-bit H.264 output and SDR color tags:

```ts
expect(argv).toEqual(expect.arrayContaining([
  "-vf", expect.stringContaining("format=yuv420p"),
  "-pix_fmt", "yuv420p",
  "-colorspace", "bt709",
  "-color_primaries", "bt709",
  "-color_trc", "bt709",
]));
```

- [ ] **Step 2: Verify RED**

Run: `bun run --cwd packages/studio-server test -- proxyTranscoder.test.ts`

Expected: FAIL because current argv has no pixel-format or color normalization.

- [ ] **Step 3: Implement normalized output**

Build the FFmpeg video filter once:

```ts
const BROWSER_PROXY_FILTER =
  "zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p";
```

Use it with `-pix_fmt yuv420p` and BT.709 output tags. Preserve the existing scale constraint and audio mapping.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test, format, lint, and typecheck. Commit:
`fix(media): normalize hostile codec proxies for browsers`

### Task 2: Centralize alpha/codec policy and eliminate happy-path work

**Files:**
- Create: `packages/studio-server/src/helpers/mediaProxyPolicy.ts`
- Create: `packages/studio-server/src/helpers/mediaProxyPolicy.test.ts`
- Modify: `packages/studio-server/src/helpers/mediaCodecMap.ts`
- Modify: `packages/studio-server/src/helpers/mediaProxyPreview.ts`
- Modify: `packages/studio-server/src/routes/preview.ts`
- Test: corresponding existing tests

- [ ] **Step 1: Write failing policy and no-op tests**

Define the expected contract:

```ts
export type ProxyDecision =
  | { action: "original"; reason: "browser-safe" }
  | { action: "proxy"; reason: "hostile-codec" }
  | { action: "unsupported"; reason: "alpha" };

export function decideMediaProxy(metadata: MediaMetadata): ProxyDecision;
```

Test mapped and unlisted alpha as `unsupported`, hostile opaque media as `proxy`, and safe media as `original`. Add a preview test asserting video-free/safe HTML is byte-identical and does not call ffprobe.

- [ ] **Step 2: Verify RED**

Run studio-server policy, codec-map, and preview tests. Expected: missing module and current unconditional injection/probe failures.

- [ ] **Step 3: Implement the shared policy**

Route initial scan, prewarm, mapped fallback, and unlisted rescue through `decideMediaProxy`. Probe unknown media before rescue. Return explicit unsupported-alpha telemetry without calling `resolveProxy`.

- [ ] **Step 4: Add cheap candidate filtering**

Parse HTML source paths first; if there are no local video candidates, return an empty map without ffprobe. Inject `data-hf-media-codec-map` only when the map has entries.

- [ ] **Step 5: Verify GREEN and commit**

Run focused tests, format, lint, typecheck. Commit:
`fix(media): unify alpha-safe proxy policy`

### Task 3: Bound queue, failure memory, caller waits, and probe memory

**Files:**
- Modify: `packages/studio-server/src/helpers/proxyTranscoder.ts`
- Modify: `packages/studio-server/src/helpers/mediaCodecMap.ts`
- Modify: `packages/studio-server/src/routes/preview.ts`
- Modify: `packages/cli/src/utils/staticProjectServer.ts`
- Modify: `packages/cli/src/utils/checkBrowser.ts`
- Modify: `packages/cli/src/utils/publishProxyBake.ts`
- Test: existing focused tests

- [ ] **Step 1: Write failing resource-bound tests**

Cover:

```ts
expect(() => enqueueWhenQueueHasReached(32)).toThrow(ProxyQueueFullError);
await expect(secondAttemptAfterFailureTtl()).resolves.toBe(proxyPath);
expect(failedTranscodeCount()).toBeLessThanOrEqual(256);
await expect(withProxyWaitTimeout(never, 50)).rejects.toBeInstanceOf(ProxyWaitTimeoutError);
expect(probeCache.size).toBeLessThanOrEqual(512);
```

Add route tests mapping queue-full to HTTP 503 with `Retry-After: 1`.

- [ ] **Step 2: Verify RED**

Run proxyTranscoder, preview route, static server, checkBrowser, and publish bake tests.

- [ ] **Step 3: Implement typed lifecycle bounds**

Add:

```ts
const MAX_TRANSCODE_QUEUE = 32;
const FAILURE_TTL_MS = 30_000;
const MAX_FAILURE_ENTRIES = 256;
const MAX_PROBE_CACHE_ENTRIES = 512;
export class ProxyQueueFullError extends Error {}
export class ProxyWaitTimeoutError extends Error {}
```

Store failures as `{ error, expiresAt }`, prune expired/old entries on access, reject queue overflow, and use one global probe semaphore. Add a caller timeout helper that stops waiting without canceling shared in-flight work.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `fix(media): bound proxy lifecycle resources`

### Task 4: Canonicalize project paths and enforce containment

**Files:**
- Create: `packages/studio-server/src/helpers/projectMediaPath.ts`
- Create: `packages/studio-server/src/helpers/projectMediaPath.test.ts`
- Modify: `packages/studio-server/src/helpers/mediaCodecMap.ts`
- Modify: `packages/studio-server/src/helpers/proxyTranscoder.ts`

- [ ] **Step 1: Write failing path tests**

Test exact path, unique case fallback, NFC/NFD fallback, ambiguous normalized collision, `../` escape, and symlink escape.

```ts
await expect(resolveProjectMediaPath(root, "clip.mp4")).resolves.toBe(actualClip);
await expect(resolveProjectMediaPath(root, "../secret.mov")).rejects.toThrow("outside project");
await expect(resolveProjectMediaPath(root, "CAFÉ.mov")).rejects.toThrow("ambiguous");
```

- [ ] **Step 2: Verify RED**

Run the new test; expect missing resolver.

- [ ] **Step 3: Implement exact-first canonical resolution**

Index files by `relative.replaceAll(path.sep, "/").normalize("NFC").toLowerCase()`. Use fallback only for one match. Compare `realpath` values with a trailing-separator containment check before returning.

- [ ] **Step 4: Wire callers, verify, and commit**

Commit: `fix(media): resolve proxy sources safely across filesystems`

### Task 5: Bound and ignore the transcode cache

**Files:**
- Create: `packages/studio-server/src/helpers/proxyCache.ts`
- Create: `packages/studio-server/src/helpers/proxyCache.test.ts`
- Modify: `packages/studio-server/src/helpers/proxyTranscoder.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing eviction tests**

Create old/new/in-flight cache entries and assert:

```ts
expect(result.removed).toContain(oldestPath);
expect(existsSync(inFlightPath)).toBe(true);
expect(result.bytesAfter).toBeLessThanOrEqual(maxBytes);
```

Also assert stale `.tmp` removal and rate-limited repeated sweeps.

- [ ] **Step 2: Verify RED**

Run the new cache test; expect missing module.

- [ ] **Step 3: Implement opportunistic LRU cleanup**

Use default 30-day idle age and 10 GiB cap, overrideable by environment. Exclude in-flight cache paths. Warn but do not fail preview on cleanup errors. Add `.transcode-cache/` to `.gitignore`.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `fix(media): bound transparent proxy cache growth`

### Task 6: Complete flags, publish diagnostics, streaming, and extensions

**Files:**
- Modify: `packages/cli/src/commands/preview.ts`
- Modify: `packages/cli/src/utils/staticProjectServer.ts`
- Modify: `packages/cli/src/utils/publishProxyBake.ts`
- Modify: `packages/cli/src/commands/publish.ts`
- Modify: `packages/cli/src/commands/play.ts`
- Modify: `packages/cli/src/utils/checkBrowser.ts`
- Modify: `packages/studio-server/src/helpers/mediaMetadata.ts`
- Modify: `packages/studio-server/src/routes/media.ts`
- Test: corresponding existing tests

- [ ] **Step 1: Write failing contract tests**

Assert `--proxy` and `--no-proxy` reach dev/local-studio/static servers, play uses `createReadStream`, extensions include `.mxf/.mts/.m2ts/.ts`, and check keeps its stable public code while adding proxy details.

Define publish result:

```ts
export interface ProxyBakeManifest {
  proxied: string[];
  skippedAlpha: string[];
  failed: Array<{ path: string; error: string }>;
}
```

Test hostile non-alpha failures stop publish with the manifest while alpha skips remain explicit.

- [ ] **Step 2: Verify RED**

Run preview, static server, publish, play, checkBrowser, and media metadata tests.

- [ ] **Step 3: Implement the contracts**

Forward the resolved boolean through all spawn paths, stream proxy files, extend video suffixes, retain the existing top-level check code, and return/surface `ProxyBakeManifest`.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `fix(media): close proxy CLI and publish gaps`

### Task 7: Replace coverage illusions with real invariants

**Files:**
- Modify: `packages/cli/src/utils/publishProject.e2e.test.ts`
- Modify: `packages/cli/src/utils/publishProject.test.ts`
- Modify: `packages/cli/src/utils/publishProxyBake.test.ts`
- Modify: `packages/studio-server/src/helpers/mediaProxyPreview.ts`
- Test: preview script escaping and runtime fallback suites

- [ ] **Step 1: Add a real hostile-media fixture test**

Generate a one-frame HEVC file with the discovered test FFmpeg binary:

```ts
await execa(ffmpegPath, [
  "-f", "lavfi", "-i", "color=size=16x16:duration=0.04",
  "-c:v", "libx265", "-pix_fmt", "yuv420p10le", fixturePath,
]);
```

Assert ffprobe reports HEVC, publish bake creates a proxy, and direct render/cloud archive builders contain original bytes with no `_proxy/` entries.

- [ ] **Step 2: Add escaping and malformed-URL tests**

Assert `</script>`, U+2028/U+2029, malformed URLs, VP9 Safari classification, and cover-art plus real-video track selection.

- [ ] **Step 3: Verify RED, implement minimal fixes, verify GREEN**

Run the focused E2E and unit suites. Expected final result: all new invariants pass.

- [ ] **Step 4: Full verification and commit**

Run:

```bash
bun run lint
bun run format:check
bun run --filter @hyperframes/studio-server test
bun run --filter @hyperframes/cli test
bun run build
```

Commit: `test(media): lock transparent proxy invariants`

### Task 8: Final review and merge gate

- [ ] Push the material #2462 head.
- [ ] Update the PR body with the approved design, source Slack mapping, and verification.
- [ ] CC Wenbo and Miao because the PR includes skill-facing changes.
- [ ] Request exact-head adversarial reviews from Via and Rames.
- [ ] Resolve every human review thread and reproduce any behavioral objection.
- [ ] Wait for every required check to complete successfully.
- [ ] Reconfirm mergeability, dependency order (#2453), current-head stamps, and no unresolved feedback.
- [ ] Merge only after every gate passes; CC Miguel with the merge commit.
