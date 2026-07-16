# Transparent Proxy Hardening Design

## Context

PR #2462 adds transparent authoring proxies for browser-hostile codecs. Its server-side
FFmpeg architecture is the correct foundation: Chrome Headless Shell cannot decode HEVC
through WebCodecs, and MediaBunny server support ultimately wraps FFmpeg through NodeAV.
The review found lifecycle, policy, and coverage gaps that must be resolved before merge.

## Goals

- Preserve transparent preview recovery for hostile HEVC and ProRes media.
- Never destroy alpha as an accidental fallback.
- Bound CPU, memory, queue, cache, and caller wait time.
- Apply one proxy policy consistently across scan, runtime rescue, check, and publish.
- Make path lookup safe across Unicode/case differences without allowing project escapes.
- Make partial publish behavior explicit and test render/publish separation with real media.
- Preserve the existing system-FFmpeg subprocess boundary and zero new media runtime dependency.

## Non-goals

- Replacing FFmpeg with MediaBunny or NodeAV in this PR.
- Proxying alpha-bearing media to opaque H.264.
- Changing final render inputs or silently publishing incomplete hostile-media coverage.

## Architecture

### 1. Canonical project media identity

Create one resolver used by codec-map lookup and proxy resolution:

1. Resolve the authored path exactly first.
2. Build a project-relative index normalized to POSIX separators, Unicode NFC, and lowercase.
3. Use the normalized fallback only when it maps to exactly one file; ambiguous case/Unicode
   collisions fail explicitly.
4. Resolve symlinks with real paths and reject any source outside the real project root.

The codec map stores canonical relative identities so scan and runtime rescue cannot disagree.

### 2. One alpha-aware proxy policy

Centralize the decision into a single policy function consumed by:

- initial scan and prewarm,
- mapped runtime recovery,
- unlisted/runtime rescue,
- check-browser recovery,
- publish bake.

Unknown/unlisted media is probed before transcoding. Alpha-bearing media is returned as an
explicit unsupported result and is never sent through the opaque H.264 proxy path. Browser-safe
mapped media follows the same policy at every runtime fallback tier.

### 3. Bounded transcode lifecycle

- Keep the two-process transcode semaphore.
- Add a bounded wait queue and a typed overload error mapped to HTTP 503 plus Retry-After.
- Deduplicate in-flight work by canonical cache key.
- Cache transient failures only for a short TTL; keep FFmpeg-unavailable recoverable immediately.
- Give publish/check callers explicit bounded waits. Caller timeout does not cancel shared work;
  it returns a typed timeout while the deduplicated transcode may finish and warm the cache.
- Preserve subprocess timeout/SIGKILL and atomic temp-then-rename behavior.

### 4. Bounded cache

Maintain cache metadata from file stat data and sweep opportunistically at a rate-limited cadence.
Defaults:

- 30-day maximum idle age,
- 10 GiB maximum total size,
- oldest-accessed entries removed first,
- active/in-flight entries excluded,
- stale temp files removed separately.

Environment/config overrides allow constrained machines to lower the cap. Cache cleanup failures
are warnings, never preview failures.

### 5. Complete CLI/config plumbing

Carry the resolved proxy setting through regular preview, dev, local-studio, and static server
spawn paths. Both positive and negative CLI flags override config consistently. Add contract tests
that exercise the final staticProjectServer arguments instead of only parser-level values.

### 6. Explicit publish outcome

Publish bake returns a structured manifest containing proxied, intentionally skipped, and failed
assets. Hostile non-alpha failures stop publish with the asset list; alpha skips remain explicit.
Callers surface the manifest in diagnostics so an incomplete publish cannot become a silent black
frame. Final render/cloud-render archive creation remains on the original-media path.

### 7. Regression coverage

Tests must cover:

- unlisted alpha rescue never invoking H.264 transcode,
- transient failure expiry,
- queue overload and HTTP 503 mapping,
- case/Unicode fallback plus ambiguity rejection,
- symlink/project containment,
- publish/check caller timeout,
- complete proxy flag forwarding,
- cache size/age eviction while preserving in-flight entries,
- publish manifest behavior,
- reactive/tertiary policy parity,
- bounded probe caches and global probe concurrency,
- preview-script escaping,
- a real hostile-codec fixture proving publish bake changes authoring archives while
  render/cloud-render archives remain byte-identical and proxy-free.

## Alternatives

### Explicit pre-bake only

This removes on-demand queueing but loses transparent cold-preview recovery. Rejected because it
regresses the core authoring experience #2462 is meant to provide.

### MediaBunny replacement or hybrid

Browser MediaBunny inherits WebCodecs HEVC limits; its ProRes path adds a WASM extension and its
server path adds NodeAV native bindings over FFmpeg. It would remove little application lifecycle
code while weakening subprocess isolation. Rejected for this PR; a metadata-only spike can be
evaluated independently later.

## Rollout and merge gate

The material head requires fresh adversarial review from Via and Rames, all required CI green,
mergeable/dependency-clean state, and no unresolved human feedback. Skill-facing files already in
the PR require Wenbo and Miao visibility before merge.
