/**
 * Pure/stateless helpers for `useVstPreview.ts`: wire-format decode, DOM
 * scanning, the loaded-track bookkeeping record + its lifecycle functions,
 * and the per-track chain-load pipeline (fetch chain → resolve local wav
 * path → `loadChain` → wire up local playback). None of these read or write
 * React state directly — the hook passes in whatever refs/values they need
 * and applies their results.
 */
import { usePlayerStore } from "../store/playerStore";
import type { TransportMsg } from "../../hooks/useVstHost";
import type { VstHostApi } from "../../components/editor/propertyPanelVstSection";
import { isRecord, parseChainFile, type ChainFileJson } from "../../utils/vstChainFile";
import { VstRingBuffer } from "../lib/vstRingBuffer";

// TEMP DEBUG — remove after diagnosis. Persists a lifecycle trace on window
// so a failing run can be read back from the console after the fact.
export function dbg(e: string, d?: unknown): void {
  const w = window as unknown as { __vstTrace?: unknown[] };
  w.__vstTrace = w.__vstTrace ?? [];
  w.__vstTrace.push({ t: Math.round(performance.now()), e, d });
}

// ── Wire-format decode ────────────────────────────────────────────────────
// Mirrors the sidecar's `encode_frame` (packages/vst-host/.../stream.py):
// little-endian u32 trackIndex, f64 samplePos, then interleaved f32 stereo.

export interface DecodedPcmFrame {
  trackIndex: number;
  samplePos: number;
  left: Float32Array;
  right: Float32Array;
}

export function decodePcmFrame(buf: ArrayBuffer): DecodedPcmFrame {
  const view = new DataView(buf);
  const trackIndex = view.getUint32(0, true);
  const samplePos = view.getFloat64(4, true);
  const interleaved = new Float32Array(buf, 12);
  const n = Math.floor(interleaved.length / 2);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = interleaved[2 * i];
    right[i] = interleaved[2 * i + 1];
  }
  return { trackIndex, samplePos, left, right };
}

// ── DOM scan — mirrors timelineIframeHelpers' contentDocument reach-in ──

function resolveVstTrackId(el: HTMLAudioElement): string {
  return el.id || el.getAttribute("data-hf-id") || el.getAttribute("data-vst-chain") || "track";
}

export function collectVstChainAudioEls(doc: Document): HTMLAudioElement[] {
  return Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[data-vst-chain]"));
}

function readFileContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.content === "string" ? value.content : null;
}

/** Same fetch idiom as propertyPanelVstSection.tsx's readChainFile. */
async function fetchChainFile(projectId: string, path: string): Promise<ChainFileJson | null> {
  let response: Response;
  try {
    // `no-store`: the FX panel may have just rewritten this file; a cached GET
    // would make the content-diff below miss the change and skip the reload.
    response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const content = readFileContent(body);
  if (content === null) return null;
  return parseChainFile(content);
}

/** Project-relative asset path from a resolved `/preview/*` URL — the part
 *  the static asset route (packages/studio-server/src/routes/preview.ts)
 *  resolves against `project.dir`. */
function projectRelativeAssetPath(previewUrl: string): string | null {
  const marker = "/preview/";
  const idx = previewUrl.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(previewUrl.slice(idx + marker.length).split("?")[0] ?? "");
}

/**
 * The sidecar is a native process on the same host — it opens audio via
 * pedalboard's `AudioFile`, which needs a real filesystem path, not the
 * `/preview/*` HTTP URL the dry `<audio>` element plays from (that URL isn't
 * openable as a file at all, let alone the right one). Resolves it via the
 * server's `/vst/wav-path` endpoint, which does the same `resolveWithinProject`
 * join the static route itself uses.
 */
async function resolveLocalWavPath(projectId: string, previewUrl: string): Promise<string | null> {
  const subPath = projectRelativeAssetPath(previewUrl);
  if (!subPath) return null;
  let response: Response;
  try {
    response = await fetch(
      `/api/vst/wav-path?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(subPath)}`,
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.path === "string" ? body.path : null;
}

// ── Loaded-track bookkeeping ──────────────────────────────────────────────

export interface LoadedVstTrack {
  audioEl: HTMLAudioElement;
  audioContext: AudioContext;
  workletNode: AudioWorkletNode;
  /** Wire-format trackIndex — the sidecar's call-order of load-chain (see stream.py's `TrackStream(len(self._tracks), ...)`). */
  trackIndex: number;
  /** The dry file's real sample rate (see `LoadChainResult`'s doc-comment) —
   *  this track's `audioContext` and `driftTracker` are both anchored to it,
   *  so samplePos↔seconds conversions for THIS track must use it, not any
   *  other track's rate or a shared constant. */
  sampleRate: number;
  originalMuted: boolean;
  /** `JSON.stringify` of the chain this track was loaded from. The FX panel
   *  rewrites a chain file IN PLACE (same `data-vst-chain` path) on add /
   *  remove / swap, so the element identity is unchanged — this is how the
   *  load effect detects the contents changed and reloads instead of leaving
   *  the first-loaded effect streaming forever. */
  chainKey: string;
  /** Tracks expected write position / drift only — never read for playback. */
  driftTracker: VstRingBuffer;
  /** Latest underrun telemetry posted by the worklet (see vstStreamWorklet.js).
   *  `totalSamples` is the cumulative count of zero-filled (ring-starved)
   *  samples; during steady playback it MUST stay flat — a rising value means
   *  the sidecar isn't keeping the ring fed (degraded/choppy audio). */
  underrun: { totalSamples: number; atTime: number };
}

export async function teardownTrack(track: LoadedVstTrack): Promise<void> {
  track.audioEl.muted = track.originalMuted;
  try {
    await track.audioContext.close();
  } catch {
    /* already closed */
  }
}

export function reseekLoadedTracks(tracks: Iterable<LoadedVstTrack>, timeSec: number): void {
  for (const track of tracks) {
    // MUST floor to an integer sample: the sidecar streams frames whose
    // `samplePos` is `int(timeSec * sample_rate)` (see stream.py `seek`), and
    // the ring buffer's `push` accepts a block only if its `samplePos`
    // exactly equals the expected position. A fractional reset target
    // (`3.02s * 44100 = 133182.9…`) can never equal the sidecar's integer
    // positions, so every pushed block is rejected — the ring starves, the
    // worklet zero-fills (degraded audio), and `resyncNeeded` latches on,
    // forcing this same broken reseek again on the next drift check.
    const samplePos = Math.floor(timeSec * track.sampleRate);
    track.workletNode.port.postMessage({ type: "reset", samplePos });
    track.driftTracker.reset(samplePos, timeSec);
  }
}

/**
 * Each track's `AudioContext` (created in `createTrackPlaybackNode`, well
 * before any play click — right when its chain finishes loading) starts
 * `"suspended"` under the browser's autoplay policy and never resumes on its
 * own. PCM frames still arrive and route to the worklet correctly even while
 * suspended — the context just silently drops them instead of producing
 * sound, so playback looks completely healthy from the wire protocol's side
 * while staying inaudible. Resuming here, at the actual transport "play"
 * transition (a real user gesture), is the one point guaranteed to satisfy
 * the policy.
 */
export function resumeSuspendedContexts(tracks: Iterable<LoadedVstTrack>): void {
  for (const track of tracks) {
    dbg("resume", { trackIndex: track.trackIndex, state: track.audioContext.state });
    if (track.audioContext.state === "suspended") void track.audioContext.resume();
  }
}

/** Removes `ids` from `order` in place — the unmount-cleanup effect below captures the array once and relies on it never being reassigned. */
export function removeFromTrackOrder(order: string[], ids: readonly string[]): void {
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (ids.includes(order[i])) order.splice(i, 1);
  }
}

/** True once EITHER this specific effect run was cancelled (re-render/unmount) OR the whole hook has been permanently suspended by a disconnect (see `suspendedRef`). */
export function isLoadAborted(cancelled: boolean, suspended: boolean): boolean {
  return cancelled || suspended;
}

/** A track is already spoken for this session if it's fully loaded, has already reserved a server-side trackIndex via a prior `loadChain` success (see `loadVstTrack` — a local-wiring failure AFTER that point is never safe to retry, or the two indices would desync), or has a `loadChain` call currently in flight. That last case matters because the "Load chains" effect below can re-run (its dependency array includes `elements`, which can change several times in quick succession right after mount, before any prior run's async work has settled) — without this check, an overlapping re-run would issue a SECOND `loadChain` for the same trackId while the first is still pending, and `useVstHost`'s own supersede-guard would then reject that first (still-legitimate) attempt, so the track never finishes loading at all. */
function isTrackAlreadyHandled(
  trackId: string,
  loadedTracks: ReadonlyMap<string, LoadedVstTrack>,
  trackOrder: readonly string[],
  pendingTrackIds: ReadonlySet<string>,
): boolean {
  return loadedTracks.has(trackId) || trackOrder.includes(trackId) || pendingTrackIds.has(trackId);
}

/** Creates the AudioContext + vst-stream worklet node for one loaded track. */
async function createTrackPlaybackNode(
  el: HTMLAudioElement,
  trackIndex: number,
  sampleRate: number,
  workletModuleUrl: string,
  chainKey: string,
): Promise<LoadedVstTrack | null> {
  let audioContext: AudioContext | null = null;
  try {
    // Must match the dry file's real rate — the sidecar streams PCM at that
    // rate, not a fixed constant (see `LoadChainResult`'s doc-comment).
    audioContext = new AudioContext({ sampleRate });
    await audioContext.audioWorklet.addModule(workletModuleUrl);
    const workletNode = new AudioWorkletNode(audioContext, "vst-stream", {
      outputChannelCount: [2],
    });
    workletNode.connect(audioContext.destination);
    const originalMuted = el.muted;
    el.muted = true;
    const track: LoadedVstTrack = {
      audioEl: el,
      audioContext,
      workletNode,
      trackIndex,
      sampleRate,
      originalMuted,
      chainKey,
      // 1s of headroom for drift bookkeeping (tracking-only — never read for
      // playback), sized to this track's own real rate.
      driftTracker: new VstRingBuffer(sampleRate, sampleRate),
      underrun: { totalSamples: 0, atTime: 0 },
    };
    workletNode.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === "underrun") {
        track.underrun = { totalSamples: data.totalSamples, atTime: data.atTime };
        // TEMP DEBUG — remove after diagnosis
        dbg("underrun", { totalSamples: data.totalSamples, atTime: data.atTime });
      }
    };
    dbg("wire:track-ready", { trackIndex, sampleRate, ctxState: audioContext.state });
    return track;
  } catch (err) {
    dbg("wire:failed", String(err));
    void audioContext?.close();
    return null; // chain loaded server-side, but local playback wiring failed — stays dry
  }
}

// ── loadVstTrack pipeline ─────────────────────────────────────────────────

interface ResolvedChainSource {
  chain: ChainFileJson;
  wavPath: string;
}

/** Fetches the chain file + resolves the dry element's local wav path — the
 *  two prerequisites `loadVstTrack` needs before it can call `api.loadChain`.
 *  Returns `null` (safe to retry next scan — no server-side index consumed
 *  yet) on any resolution failure. */
async function resolveChainSource(
  el: HTMLAudioElement,
  trackId: string,
  projectId: string,
): Promise<ResolvedChainSource | null> {
  const chainPath = el.getAttribute("data-vst-chain");
  if (!chainPath) {
    dbg("load:no-chain-attr", trackId);
    return null;
  }
  const chain = await fetchChainFile(projectId, chainPath);
  if (!chain) {
    dbg("load:chain-fetch-failed", { trackId, chainPath });
    return null; // no index consumed — safe to retry next scan
  }
  const dryWavUrl = el.currentSrc || el.src;
  const wavPath = await resolveLocalWavPath(projectId, dryWavUrl);
  if (!wavPath) {
    dbg("load:wav-path-failed", { trackId, dryWavUrl });
    return null; // can't resolve to a local file — safe to retry next scan
  }
  return { chain, wavPath };
}

interface LoadChainOutcome {
  trackIndex: number;
  sampleRate: number;
  stable: boolean;
}

/** Calls the sidecar's `loadChain`, translating a rejection into `null`
 *  (retryable — no index was ever consumed). */
async function callLoadChain(
  api: VstHostApi,
  trackId: string,
  chain: ChainFileJson,
  wavPath: string,
): Promise<LoadChainOutcome | null> {
  try {
    // Resolves with the sidecar-assigned wire trackIndex for this load (see
    // useVstHost's `assignNextTrackIndex`) — authoritative for THIS call, but
    // can go stale if anyone (including this same hook, on a later scan)
    // reloads this trackId again; the `onChainLoaded` subscription (in
    // useVstPreview) keeps it current for the lifetime of the loaded track.
    // `sampleRate` is the dry file's real rate (see `LoadChainResult`'s
    // doc-comment).
    const { trackIndex, sampleRate, stable } = await api.loadChain(trackId, chain, wavPath);
    dbg("load:chain-loaded", { trackId, trackIndex, sampleRate, stable });
    return { trackIndex, sampleRate, stable };
  } catch (err) {
    dbg("load:loadChain-rejected", { trackId, err: String(err) });
    return null; // sidecar rejected the chain (e.g. missing plugin) — retryable
  }
}

/**
 * Fetches + loads one track's chain and, on success, spins up its playback
 * node. Returns `null` if the track should stay dry (fetch/parse failure,
 * loadChain rejection, or local wiring failure) — the caller leaves the
 * element unmuted in every `null` case.
 */
async function loadVstTrack(
  el: HTMLAudioElement,
  trackId: string,
  projectId: string,
  api: VstHostApi,
  attemptedTrackIds: string[],
  workletModuleUrl: string,
  showToast?: (message: string, tone?: "error" | "info") => void,
): Promise<LoadedVstTrack | null> {
  const source = await resolveChainSource(el, trackId, projectId);
  if (!source) return null;

  const outcome = await callLoadChain(api, trackId, source.chain, source.wavPath);
  if (!outcome) return null;

  // Marks this trackId as having reserved a server-side slot, regardless of
  // whether local wiring below succeeds (a local failure must never be
  // retried, or a fresh loadChain would desync from what the sidecar already
  // holds for this trackId).
  attemptedTrackIds.push(trackId);

  // The sidecar couldn't host this chain without producing NaN/Inf/runaway
  // output (see its `probe_chain_stability`). Leave the element on its dry
  // audio — streaming an unstable chain is silence at best — and tell the
  // user which plugin is at fault rather than failing silently.
  if (!outcome.stable) {
    const label = source.chain.plugins[0]?.name ?? "This VST effect";
    showToast?.(
      `${label} isn't compatible with the offline VST host — playing the original audio instead.`,
      "error",
    );
    return null;
  }

  return createTrackPlaybackNode(
    el,
    outcome.trackIndex,
    outcome.sampleRate,
    workletModuleUrl,
    JSON.stringify(source.chain),
  );
}

// ── Load-effect scan (per-DOM-scan reconcile + load loop) ────────────────

/** Tears down any loaded track whose element is no longer a live vst-chain
 *  element — its chain was removed in the FX panel, or a preview reload
 *  replaced the DOM node. Clearing it from `trackOrder` (which doubles as
 *  the "already attempted" set, see `isTrackAlreadyHandled`) is what lets
 *  the SAME trackId reload when it reappears with a different chain — i.e.
 *  how add / remove / swap in the panel actually takes audible effect. Runs
 *  even when no vst-chain elements remain (a full removal), so the dry
 *  element gets unmuted. */
export function reconcileRemovedTracks(
  liveAudioEls: readonly HTMLAudioElement[],
  loadedTracks: Map<string, LoadedVstTrack>,
  trackOrder: string[],
): void {
  const liveEls = new Set<HTMLAudioElement>(liveAudioEls);
  for (const [trackId, track] of Array.from(loadedTracks.entries())) {
    if (!liveEls.has(track.audioEl)) {
      loadedTracks.delete(trackId);
      removeFromTrackOrder(trackOrder, [trackId]);
      void teardownTrack(track);
    }
  }
}

type TrackLoadDecision = "aborted" | "skip" | "proceed";

/**
 * Decides what the load loop should do next for one DOM element, BEFORE
 * calling `loadVstTrack`:
 *  - "aborted": the effect run was cancelled/suspended while this check was
 *    async (re-fetching the chain file below) — the caller must stop the
 *    whole scan, not just this element.
 *  - "skip": either this trackId is already loaded with unchanged chain
 *    contents, or it's already handled by `isTrackAlreadyHandled` (loaded /
 *    reserved / in flight) — nothing to do this scan.
 *  - "proceed": either this trackId is new, or its loaded chain's contents
 *    changed (the FX panel rewrote the same `data-vst-chain` path — this
 *    tears the stale track down as a side effect) — the caller should now
 *    call `loadVstTrack`.
 *
 * Comparing chain CONTENTS — not just element identity — is what makes
 * switching effects actually switch, instead of the first-loaded effect
 * streaming forever.
 */
async function decideTrackLoadAction(
  el: HTMLAudioElement,
  trackId: string,
  projectId: string,
  loadedTracks: Map<string, LoadedVstTrack>,
  trackOrder: string[],
  pendingTrackIds: ReadonlySet<string>,
  isAborted: () => boolean,
): Promise<TrackLoadDecision> {
  const existing = loadedTracks.get(trackId);
  if (existing) {
    const chainPath = el.getAttribute("data-vst-chain");
    const current = chainPath ? await fetchChainFile(projectId, chainPath) : null;
    if (isAborted()) return "aborted";
    if (current && JSON.stringify(current) === existing.chainKey) return "skip"; // unchanged
    // Changed (or unreadable): tear the old track down and fall through to
    // reload from the current chain.
    loadedTracks.delete(trackId);
    removeFromTrackOrder(trackOrder, [trackId]);
    void teardownTrack(existing);
    return "proceed";
  }
  if (isTrackAlreadyHandled(trackId, loadedTracks, trackOrder, pendingTrackIds)) {
    return "skip";
  }
  return "proceed";
}

/**
 * Cancellation branch of the per-track load loop. A disconnect can land
 * while `loadVstTrack` was in flight — including AFTER its server-side
 * `load-chain` succeeded and its local AudioContext/AudioWorkletNode wiring
 * finished (which mutes the element as a side effect, see
 * `createTrackPlaybackNode`). Tear down fully via `teardownTrack` (not just
 * close the AudioContext) so a track resolved mid-disconnect doesn't get
 * left muted with no processed audio ever routed to it — a "half-loaded",
 * permanently silent state.
 *
 * Cancellation (an effect re-run superseding this one — timeline `elements`
 * churn right after mount does this routinely) must not strand the track:
 * the superseding run already scanned and SKIPPED this trackId (the
 * `pendingTrackIds` guard, while our load was in flight), and `loadVstTrack`
 * reserved it in `trackOrder` (the "already attempted" set) — so with no
 * further action, no later run would ever retry it. The track would sit
 * permanently silent: chain loaded server-side, nothing streaming
 * client-side (live-traced: `wire:track-ready` fires, then transport sees
 * `loaded: 0` forever). Drop the reservation and poke the load effect to
 * rescan against the CURRENT DOM (the element this run captured may be a
 * dead node if the reload was an iframe swap — that's why the loaded track
 * is torn down rather than adopted). Suspension is the exception:
 * permanently suspended means never retry, by design.
 */
function handleCancelledTrackLoad(
  loaded: LoadedVstTrack | null,
  trackId: string,
  trackOrder: string[],
  suspended: boolean,
): void {
  if (loaded) void teardownTrack(loaded);
  if (!suspended) {
    removeFromTrackOrder(trackOrder, [trackId]);
    usePlayerStore.getState().bumpVstChainRevision();
  }
}

/**
 * Registers a freshly loaded track and, if playback is already running,
 * catches it up immediately. The transport play/pause effect only reacts to
 * `isPlaying` CHANGING — if playback was already running by the time this
 * track finished its async load (chain fetch + loadChain + local
 * AudioContext/worklet wiring can easily outlast a quick click), that
 * transition already fired and found the loaded-tracks map empty, so it
 * silently skipped sending "play". Catch this track up to the current
 * transport state now, or it never streams for the rest of this playback
 * run.
 */
function applyNewlyLoadedTrack(
  loaded: LoadedVstTrack,
  trackId: string,
  loadedTracks: Map<string, LoadedVstTrack>,
  sendTransport: (msg: TransportMsg) => void,
  liveTimeSec: number,
): void {
  loadedTracks.set(trackId, loaded);
  const { isPlaying, playbackRate } = usePlayerStore.getState();
  if (isPlaying) {
    resumeSuspendedContexts([loaded]);
    sendTransport({ action: "play", timeSec: liveTimeSec, rate: playbackRate });
    reseekLoadedTracks([loaded], liveTimeSec);
  }
}

export interface LoadScanParams {
  audioEls: readonly HTMLAudioElement[];
  projectId: string;
  api: VstHostApi;
  workletModuleUrl: string;
  showToast?: (message: string, tone?: "error" | "info") => void;
  sendTransport: (msg: TransportMsg) => void;
  loadedTracks: Map<string, LoadedVstTrack>;
  trackOrder: string[];
  pendingTrackIds: Set<string>;
  /** Re-checked live on every iteration (not just once) — a disconnect can
   *  land while this loop is mid-flight awaiting a previous track's
   *  `loadVstTrack` call. */
  isAborted: () => boolean;
  isSuspended: () => boolean;
  liveTimeSec: () => number;
}

/** Runs one DOM-scan's worth of track loads sequentially, one element at a
 *  time — see `decideTrackLoadAction`, `handleCancelledTrackLoad`, and
 *  `applyNewlyLoadedTrack` for what happens at each stage. */
export async function runVstLoadScan(params: LoadScanParams): Promise<void> {
  const {
    audioEls,
    projectId,
    api,
    workletModuleUrl,
    showToast,
    sendTransport,
    loadedTracks,
    trackOrder,
    pendingTrackIds,
    isAborted,
    isSuspended,
    liveTimeSec,
  } = params;

  for (const el of audioEls) {
    if (isAborted()) return;
    const trackId = resolveVstTrackId(el);

    const decision = await decideTrackLoadAction(
      el,
      trackId,
      projectId,
      loadedTracks,
      trackOrder,
      pendingTrackIds,
      isAborted,
    );
    if (decision === "aborted") return;
    if (decision === "skip") continue;

    pendingTrackIds.add(trackId);
    let loaded: LoadedVstTrack | null;
    try {
      loaded = await loadVstTrack(
        el,
        trackId,
        projectId,
        api,
        trackOrder,
        workletModuleUrl,
        showToast,
      );
    } finally {
      pendingTrackIds.delete(trackId);
    }

    if (isAborted()) {
      handleCancelledTrackLoad(loaded, trackId, trackOrder, isSuspended());
      return;
    }

    if (loaded) {
      applyNewlyLoadedTrack(loaded, trackId, loadedTracks, sendTransport, liveTimeSec());
    }
  }
}
