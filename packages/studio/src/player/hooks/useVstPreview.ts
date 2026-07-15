import { useEffect, useRef, type RefObject } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { TransportMsg, UseVstHostResult } from "../../hooks/useVstHost";
import type { VstHostApi } from "../../components/editor/propertyPanelVstSection";
import { isRecord, parseChainFile, type ChainFileJson } from "../../utils/vstChainFile";
import { VstRingBuffer } from "../lib/vstRingBuffer";

const VST_SAMPLE_RATE = 48000;
const DRIFT_CHECK_INTERVAL_MS = 500;
/** Tracking-only ring buffer per track (drift bookkeeping) — 1s of headroom. */
const DRIFT_TRACKER_CAPACITY_SAMPLES = VST_SAMPLE_RATE;
const RESTART_DELAY_MS = 2000;

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

function collectVstChainAudioEls(doc: Document): HTMLAudioElement[] {
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
    response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const content = readFileContent(body);
  if (content === null) return null;
  return parseChainFile(content);
}

// ── Loaded-track bookkeeping ──────────────────────────────────────────────

interface LoadedVstTrack {
  audioEl: HTMLAudioElement;
  audioContext: AudioContext;
  workletNode: AudioWorkletNode;
  /** Wire-format trackIndex — the sidecar's call-order of load-chain (see stream.py's `TrackStream(len(self._tracks), ...)`). */
  trackIndex: number;
  originalMuted: boolean;
  /** Tracks expected write position / drift only — never read for playback. */
  driftTracker: VstRingBuffer;
}

async function teardownTrack(track: LoadedVstTrack): Promise<void> {
  track.audioEl.muted = track.originalMuted;
  try {
    await track.audioContext.close();
  } catch {
    /* already closed */
  }
}

function reseekLoadedTracks(tracks: Iterable<LoadedVstTrack>, timeSec: number): void {
  const samplePos = timeSec * VST_SAMPLE_RATE;
  for (const track of tracks) {
    track.workletNode.port.postMessage({ type: "reset", samplePos });
    track.driftTracker.reset(samplePos);
  }
}

/** Removes `ids` from `order` in place — the unmount-cleanup effect below captures the array once and relies on it never being reassigned. */
function removeFromTrackOrder(order: string[], ids: readonly string[]): void {
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (ids.includes(order[i])) order.splice(i, 1);
  }
}

/** True once EITHER this specific effect run was cancelled (re-render/unmount) OR the whole hook has been permanently suspended by a disconnect (see `suspendedRef`). */
function isLoadAborted(cancelled: boolean, suspended: boolean): boolean {
  return cancelled || suspended;
}

/** A track is already spoken for this session if it's fully loaded, or has already reserved a server-side trackIndex via a prior `loadChain` success (see `loadVstTrack` — a local-wiring failure AFTER that point is never safe to retry, or the two indices would desync). */
function isTrackAlreadyHandled(
  trackId: string,
  loadedTracks: ReadonlyMap<string, LoadedVstTrack>,
  trackOrder: readonly string[],
): boolean {
  return loadedTracks.has(trackId) || trackOrder.includes(trackId);
}

/** Creates the AudioContext + vst-stream worklet node for one loaded track. */
async function createTrackPlaybackNode(
  el: HTMLAudioElement,
  trackIndex: number,
  workletModuleUrl: string,
): Promise<LoadedVstTrack | null> {
  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContext({ sampleRate: VST_SAMPLE_RATE });
    await audioContext.audioWorklet.addModule(workletModuleUrl);
    const workletNode = new AudioWorkletNode(audioContext, "vst-stream", {
      outputChannelCount: [2],
    });
    workletNode.connect(audioContext.destination);
    const originalMuted = el.muted;
    el.muted = true;
    return {
      audioEl: el,
      audioContext,
      workletNode,
      trackIndex,
      originalMuted,
      driftTracker: new VstRingBuffer(DRIFT_TRACKER_CAPACITY_SAMPLES, VST_SAMPLE_RATE),
    };
  } catch {
    void audioContext?.close();
    return null; // chain loaded server-side, but local playback wiring failed — stays dry
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
): Promise<LoadedVstTrack | null> {
  const chainPath = el.getAttribute("data-vst-chain");
  if (!chainPath) return null;
  const chain = await fetchChainFile(projectId, chainPath);
  if (!chain) return null; // no index consumed — safe to retry next scan
  const dryWavPath = el.currentSrc || el.src;

  let trackIndex: number;
  try {
    // Resolves with the sidecar-assigned wire trackIndex for this load (see
    // useVstHost's `assignNextTrackIndex`) — authoritative for THIS call, but
    // can go stale if anyone (including this same hook, on a later scan)
    // reloads this trackId again; the `onChainLoaded` subscription below
    // keeps it current for the lifetime of the loaded track.
    trackIndex = await api.loadChain(trackId, chain, dryWavPath);
  } catch {
    return null; // sidecar rejected the chain (e.g. missing plugin) — retryable
  }

  // Marks this trackId as having reserved a server-side slot, regardless of
  // whether local wiring below succeeds (a local failure must never be
  // retried, or a fresh loadChain would desync from what the sidecar already
  // holds for this trackId).
  attemptedTrackIds.push(trackId);
  return createTrackPlaybackNode(el, trackIndex, workletModuleUrl);
}

/**
 * Streams live VST-processed audio into the preview.
 *
 * When at least one timeline `<audio data-vst-chain="...">` element is
 * present and the sidecar (`useVstHost`) is ready: loads each track's chain,
 * mutes the dry element, and plays the sidecar's processed PCM through a
 * `vst-stream` AudioWorklet instead — kept in sync with the transport
 * (play/pause/seek) and a periodic drift check. On a sidecar crash/
 * disconnect, falls back to the original dry audio, surfaces a toast, and
 * attempts one automatic sidecar reconnect for the shared connection's sake
 * — but VST STREAMING ITSELF STAYS PERMANENTLY SUSPENDED for the rest of
 * this hook instance's lifetime after the FIRST disconnect for ANY reason
 * (see `suspendedRef` below): the sidecar's own track-index assignment can
 * silently misroute or drop audio across a reconnect in ways this client
 * cannot fully predict (see `useVstHost`'s doc-comments), so this hook
 * intentionally never resumes streaming on its own — only a fresh mount
 * (i.e. reloading the composition preview) does.
 *
 * Takes its `useVstHost()` instance as a parameter rather than calling the
 * hook itself: the FX property panel (`propertyPanelVstSection.tsx`) also
 * needs a `VstHostApi`, and the sidecar's wire protocol can't tell two
 * independent WebSocket connections apart safely (see `onChainLoaded`'s
 * doc-comment) — so the whole app shares exactly one connection, mounted
 * once in `NLEProvider` (`NLEContext.tsx`) and exposed to every consumer,
 * including this hook, via context.
 */
export function useVstPreview(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  projectId: string | undefined,
  vstHost: UseVstHostResult,
  showToast?: (message: string, tone?: "error" | "info") => void,
): void {
  const { status, api, ensureStarted, onPcmFrame, sendTransport, onDisconnect, onChainLoaded } =
    vstHost;

  const loadedTracksRef = useRef<Map<string, LoadedVstTrack>>(new Map());
  const trackOrderRef = useRef<string[]>([]);
  const restartAttemptedRef = useRef(false);
  // Set permanently the FIRST time this hook instance observes a disconnect
  // (via `onDisconnect`, below) — never reset back to `false` for the rest of
  // this hook instance's lifetime, even once the sidecar reconnects.
  //
  // Earlier attempts (see git history) tried to track, per track, whether
  // reloading that SPECIFIC trackId post-reconnect was safe:
  // round 1 mirrored the sidecar's index assignment and detected collisions
  // after the fact; round 2 added a `Set` of trackIds snapshotted as "unsafe"
  // from `loadedTracksRef` right before a disconnect clears it. Both rounds
  // of review found a real gap: there is no complete way to enumerate "every
  // track whose state might be compromised" from outside the sidecar, because
  // the sidecar's own index-assignment rule (`self._tracks.pop(track_id,
  // None)` then `TrackStream(len(self._tracks), ...)` in server.py) can
  // reassign colliding indices on ANY reload, and a WS disconnect does not
  // reliably tell the client whether the sidecar process (and its `_tracks`
  // dict) is the same one from before or a fresh restart (see useVstHost's
  // `handleDisconnect` doc-comment) — so a track that was never in
  // `loadedTracksRef` (e.g. one whose local wiring was still in flight, or
  // one that doesn't exist in the DOM yet) is just as unsafe to load as one
  // that was.
  //
  // Rather than trying a third time to enumerate every in-flight state
  // correctly, this flag makes the rule deliberately blunt and provably
  // complete: once ANY disconnect has been observed, NOTHING streams through
  // this hook instance again, ever — not a previously-loaded track, not a
  // previously-attempted-but-failed one, and not a track that only appears in
  // the DOM after the disconnect. See the "Load chains" effect below, which
  // checks this flag before doing anything, and the crash-fallback effect,
  // which sets it.
  const suspendedRef = useRef(false);

  // Re-run the DOM scans whenever the timeline's elements change — the
  // reliable existing signal that the preview DOM was reloaded/edited.
  const elements = usePlayerStore((s) => s.elements);

  // ── Lazily start the sidecar once a vst-chain track appears ─────────────
  useEffect(() => {
    if (!projectId || status !== "idle") return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    if (collectVstChainAudioEls(doc).length === 0) return;
    void ensureStarted();
  }, [projectId, status, elements, iframeRef, ensureStarted]);

  // Clears the "already attempted one auto-restart" flag once the sidecar is
  // healthy again, so a LATER disconnect still gets its own one retry.
  useEffect(() => {
    if (status === "ready") restartAttemptedRef.current = false;
  }, [status]);

  // ── Load chains + mute dry elements + spin up worklets ───────────────────
  useEffect(() => {
    // `suspendedRef` is the blunt, permanent gate: once ANY disconnect has
    // been observed by this hook instance, refuse to load ANY track — not
    // just ones this effect has already seen — for the rest of this hook's
    // lifetime (see suspendedRef's doc-comment above).
    if (!projectId || status !== "ready" || !api || suspendedRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const audioEls = collectVstChainAudioEls(doc);
    if (audioEls.length === 0) return;

    const workletModuleUrl = new URL("../lib/vstStreamWorklet.js", import.meta.url).href;
    let cancelled = false;

    void (async () => {
      for (const el of audioEls) {
        // Re-check on every iteration (not just once, above): a disconnect
        // can land while this loop is mid-flight awaiting a previous
        // track's `loadVstTrack` call.
        if (isLoadAborted(cancelled, suspendedRef.current)) return;
        const trackId = resolveVstTrackId(el);
        if (isTrackAlreadyHandled(trackId, loadedTracksRef.current, trackOrderRef.current)) {
          continue;
        }
        const loaded = await loadVstTrack(
          el,
          trackId,
          projectId,
          api,
          trackOrderRef.current,
          workletModuleUrl,
        );
        // A disconnect can land while `loadVstTrack` above was in flight —
        // including AFTER its server-side `load-chain` succeeded and its
        // local AudioContext/AudioWorkletNode wiring finished (which mutes
        // `el` as a side effect, see createTrackPlaybackNode). Tear down
        // fully via `teardownTrack` (not just close the AudioContext) so a
        // track resolved mid-disconnect doesn't get left muted with no
        // processed audio ever routed to it — a "half-loaded", permanently
        // silent state.
        if (isLoadAborted(cancelled, suspendedRef.current)) {
          if (loaded) void teardownTrack(loaded);
          return;
        }
        if (loaded) loadedTracksRef.current.set(trackId, loaded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, status, api, elements, iframeRef]);

  // ── Resync trackIndex if anyone reloads an already-loaded track's chain ──
  // This connection is now shared with the FX property panel (see the
  // module doc-comment): if the panel — or any other future caller sharing
  // this `useVstHost()` instance — reloads a chain for a trackId this hook
  // already streams, the sidecar reassigns that track's wire trackIndex
  // (`useVstHost`'s `assignNextTrackIndex`, mirroring stream.py's
  // `TrackStream(len(self._tracks), ...)`). A trackIndex cached from the
  // initial load would silently misroute PCM frames from then on, so update
  // it from the broadcast event instead of trusting that stale value.
  useEffect(() => {
    return onChainLoaded((trackId, trackIndex) => {
      const track = loadedTracksRef.current.get(trackId);
      if (!track) return; // not a track this hook streams — nothing to resync

      // The sidecar's own index-assignment rule can (by design — see
      // assignNextTrackIndex's doc-comment) hand two DIFFERENT trackIds the
      // same numeric index right after a reload (a brief dict-shrink from
      // popping the reloaded key). The wire frame carries only that number,
      // so once two loaded tracks collide on it, PCM can no longer be
      // demultiplexed correctly for either. Rather than silently misroute
      // audio to the wrong worklet, treat both sides of the collision as
      // unsafe: revert them to dry playback and let a later DOM scan retry.
      const collision = Array.from(loadedTracksRef.current.entries()).find(
        ([otherId, other]) => otherId !== trackId && other.trackIndex === trackIndex,
      );
      if (collision) {
        const [otherId, otherTrack] = collision;
        loadedTracksRef.current.delete(trackId);
        loadedTracksRef.current.delete(otherId);
        removeFromTrackOrder(trackOrderRef.current, [trackId, otherId]);
        void teardownTrack(track);
        void teardownTrack(otherTrack);
        showToast?.(
          "VST track routing conflict detected — reverted affected tracks to unprocessed audio.",
          "error",
        );
        return;
      }

      track.trackIndex = trackIndex;
    });
  }, [onChainLoaded, showToast]);

  // ── Transport: play/pause ─────────────────────────────────────────────────
  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.isPlaying === prev.isPlaying) return;
      if (loadedTracksRef.current.size === 0) return;
      const msg: TransportMsg = state.isPlaying
        ? { action: "play", timeSec: state.currentTime, rate: state.playbackRate }
        : { action: "pause" };
      sendTransport(msg);
    });
  }, [sendTransport]);

  // ── Transport: seeks — same requestedSeekTime useTimelinePlayer consumes ─
  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.requestedSeekTime === null || state.requestedSeekTime === prev.requestedSeekTime) {
        return;
      }
      if (loadedTracksRef.current.size === 0) return;
      const timeSec = state.requestedSeekTime;
      sendTransport({ action: "seek", timeSec });
      reseekLoadedTracks(loadedTracksRef.current.values(), timeSec);
    });
  }, [sendTransport]);

  // ── PCM frame routing ──────────────────────────────────────────────────────
  useEffect(() => {
    return onPcmFrame((buf) => {
      if (loadedTracksRef.current.size === 0) return;
      const frame = decodePcmFrame(buf);
      for (const track of loadedTracksRef.current.values()) {
        if (track.trackIndex !== frame.trackIndex) continue;
        track.driftTracker.push(frame.samplePos, frame.left, frame.right);
        track.workletNode.port.postMessage(
          { type: "pcm", samplePos: frame.samplePos, left: frame.left, right: frame.right },
          [frame.left.buffer, frame.right.buffer],
        );
        return;
      }
      // No loaded track claims this trackIndex — drop the frame.
    });
  }, [onPcmFrame]);

  // ── Periodic drift check ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (loadedTracksRef.current.size === 0) return;
      const { currentTime } = usePlayerStore.getState();
      const drifted = Array.from(loadedTracksRef.current.values()).some((track) =>
        track.driftTracker.needsResync(currentTime),
      );
      if (!drifted) return;
      // The sidecar coalesces repeated seeks server-side — no client-side
      // coalescing needed here.
      sendTransport({ action: "seek", timeSec: currentTime });
      reseekLoadedTracks(loadedTracksRef.current.values(), currentTime);
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sendTransport]);

  // Read via ref (not the closed-over `ensureStarted`) inside the deferred
  // restart below: `ensureStarted`'s identity — and its internal `status`
  // read — changes on every status transition, including the very one
  // disconnect just caused. A closure captured at disconnect time would
  // still see the pre-disconnect "ready" status 2s later and short-circuit
  // (useVstHost's `ensureStarted` treats stale-`status===ready` + a still-
  // non-null `socketRef.current`, which disconnect never nils out, as
  // already-connected). The ref always resolves to the latest closure.
  const ensureStartedRef = useRef(ensureStarted);
  ensureStartedRef.current = ensureStarted;

  // ── Crash fallback ──────────────────────────────────────────────────────────
  useEffect(() => {
    return onDisconnect(() => {
      const wasAlreadySuspended = suspendedRef.current;
      // Permanent, one-way: the very first disconnect this hook instance
      // ever observes suspends VST streaming for the rest of its lifetime
      // (see suspendedRef's doc-comment above) — set BEFORE tearing anything
      // down so the "Load chains" effect's in-flight re-checks (above) see it
      // as soon as possible, and regardless of whether any track happened to
      // be loaded at this exact moment.
      suspendedRef.current = true;

      // Tear down anything actually loaded right now (if this is the first
      // disconnect) down to dry playback. On a later disconnect this is a
      // no-op in practice — nothing gets loaded once suspended, so
      // `loadedTracksRef` stays empty — but running it unconditionally costs
      // nothing and needs no extra branch.
      const tracks = Array.from(loadedTracksRef.current.values());
      loadedTracksRef.current.clear();
      trackOrderRef.current.length = 0;
      for (const track of tracks) {
        void teardownTrack(track);
      }

      // Only the transition into suspension is newsworthy — a later
      // disconnect (which can only happen after suspension already latched)
      // doesn't need a second toast or another restart attempt.
      if (wasAlreadySuspended) return;

      // NOTE: there is currently no "reopen the FX panel" (or any other)
      // trigger that calls `ensureStarted()` again for this hook — this
      // suspension is NOT recoverable within the lifetime of this mounted
      // hook instance. The only way to stream VST audio again is a fresh
      // mount of `useVstPreview` (i.e. reloading/remounting the composition
      // preview), which gets its own fresh `suspendedRef`. An earlier version
      // of this comment claimed reopening the FX panel would re-trigger
      // `ensureStarted()` "once wired" — grepping propertyPanelVstSection.tsx
      // shows no such call exists, and NLEProvider (which mounts both
      // `useVstHost` and this hook exactly once per studio session, not keyed
      // by projectId or refreshKey — see NLEContext.tsx) never remounts on
      // its own, so that recovery path was aspirational, not real.
      showToast?.(
        "VST plugin host disconnected — reverted to unprocessed audio. " +
          "VST preview is now disabled for the rest of this session; reload the preview to re-enable it.",
        "error",
      );

      if (restartAttemptedRef.current) return;
      restartAttemptedRef.current = true;
      setTimeout(() => {
        void ensureStartedRef.current().catch(() => {
          // Second attempt also failed. Regardless of outcome, THIS hook's
          // streaming stays suspended (see suspendedRef) — but the
          // underlying `useVstHost` connection is shared with the FX panel
          // (see the module doc-comment), so still worth one retry for that
          // other consumer's sake even though it can't unstick this hook.
        });
      }, RESTART_DELAY_MS);
    });
  }, [onDisconnect, showToast]);

  // ── Unmount cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Captured once: both refs hold long-lived data (not DOM nodes) mutated
    // in place for the life of this hook, so reading them here — rather
    // than re-reading `.current` inside the returned cleanup closure below —
    // still reflects every track loaded up to the moment of unmount.
    const tracks = loadedTracksRef.current;
    const trackOrder = trackOrderRef.current;
    return () => {
      for (const track of tracks.values()) {
        void teardownTrack(track);
      }
      tracks.clear();
      trackOrder.length = 0;
    };
  }, []);
}
