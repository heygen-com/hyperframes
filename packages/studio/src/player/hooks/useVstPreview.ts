import { useEffect, useRef, type RefObject } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useVstHost, type TransportMsg } from "../../hooks/useVstHost";
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
  trackOrder: string[],
  workletModuleUrl: string,
): Promise<LoadedVstTrack | null> {
  const chainPath = el.getAttribute("data-vst-chain");
  if (!chainPath) return null;
  const chain = await fetchChainFile(projectId, chainPath);
  if (!chain) return null; // no index consumed — safe to retry next scan
  const dryWavPath = el.currentSrc || el.src;

  try {
    await api.loadChain(trackId, chain, dryWavPath);
  } catch {
    return null; // sidecar rejected the chain (e.g. missing plugin) — retryable
  }

  // The sidecar assigns trackIndex by call-order of load-chain (see
  // stream.py's `TrackStream(len(self._tracks), ...)`) — reserve the slot
  // here, matching that order, regardless of whether local wiring below
  // succeeds (a local failure must never be retried, or the two indices
  // would desync).
  trackOrder.push(trackId);
  const trackIndex = trackOrder.length - 1;
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
 * disconnect, falls back to the original dry audio and surfaces a toast,
 * attempting one automatic sidecar restart.
 *
 * Deliberately self-contained: scans the iframe DOM for vst-chain tracks and
 * owns its own `useVstHost()` instance, so mounting it is a one-line addition
 * at the call site (see useTimelinePlayer.ts) with no restructuring of the
 * existing player.
 */
export function useVstPreview(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  projectId: string | undefined,
  showToast?: (message: string, tone?: "error" | "info") => void,
): void {
  const { status, api, ensureStarted, onPcmFrame, sendTransport, onDisconnect } = useVstHost();

  const loadedTracksRef = useRef<Map<string, LoadedVstTrack>>(new Map());
  const trackOrderRef = useRef<string[]>([]);
  const restartAttemptedRef = useRef(false);

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
    if (!projectId || status !== "ready" || !api) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const audioEls = collectVstChainAudioEls(doc);
    if (audioEls.length === 0) return;

    const workletModuleUrl = new URL("../lib/vstStreamWorklet.js", import.meta.url).href;
    let cancelled = false;

    void (async () => {
      for (const el of audioEls) {
        if (cancelled) return;
        const trackId = resolveVstTrackId(el);
        // Skip a track that's either fully loaded already, or already
        // reserved a server-side trackIndex from a prior loadChain success
        // this session (see loadVstTrack — a local-wiring failure AFTER that
        // point is never safe to retry, or the two indices would desync).
        if (loadedTracksRef.current.has(trackId) || trackOrderRef.current.includes(trackId)) {
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
        if (cancelled) {
          void loaded?.audioContext.close();
          return;
        }
        if (loaded) loadedTracksRef.current.set(trackId, loaded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, status, api, elements, iframeRef]);

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
      if (loadedTracksRef.current.size === 0) return;
      const tracks = Array.from(loadedTracksRef.current.values());
      loadedTracksRef.current.clear();
      trackOrderRef.current.length = 0;
      for (const track of tracks) {
        void teardownTrack(track);
      }
      showToast?.("VST plugin host disconnected — reverted to unprocessed audio.", "error");

      if (restartAttemptedRef.current) return;
      restartAttemptedRef.current = true;
      setTimeout(() => {
        void ensureStartedRef.current().catch(() => {
          // Second attempt also failed — stay dry until the user reopens the
          // FX panel (a fresh ensureStarted() call from that surface, once
          // wired, re-enters the "idle" gate above).
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
