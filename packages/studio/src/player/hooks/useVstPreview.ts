import { useEffect, useRef, type RefObject } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { TransportMsg, UseVstHostResult } from "../../hooks/useVstHost";
import { STUDIO_VST_ENABLED } from "../../components/editor/manualEditingAvailability";
import {
  collectVstChainAudioEls,
  dbg,
  decodePcmFrame,
  isLoadAborted,
  reconcileRemovedTracks,
  removeFromTrackOrder,
  reseekLoadedTracks,
  resumeSuspendedContexts,
  runVstLoadScan,
  teardownTrack,
  type LoadedVstTrack,
} from "./useVstPreviewHelpers";

export { decodePcmFrame } from "./useVstPreviewHelpers";

const DRIFT_CHECK_INTERVAL_MS = 500;
const RESTART_DELAY_MS = 2000;

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
  /** trackIds with a `loadChain` call currently in flight — see `isTrackAlreadyHandled`'s doc-comment for why this exists. */
  const pendingTrackIdsRef = useRef<Set<string>>(new Set());
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

  // `usePlayerStore`'s `currentTime` is a Zustand field the RAF playback loop
  // deliberately only syncs "once at end" (see useTimelinePlayerLoop.ts) —
  // updating it every frame would trigger a React re-render 60x/second. The
  // actual continuously-updating playhead is `liveTime`, a separate
  // subscribe/notify pub-sub built for exactly this (see playerStore.ts).
  // Reading `usePlayerStore.getState().currentTime` here for drift-checking
  // or a transport "play" position would see a value frozen at whatever it
  // was when playback last stopped — for a fresh play from the start, that's
  // permanently 0, so every drift check sees the sidecar's real, advancing
  // position as fully drifted and forces a reseek back to 0 every tick.
  const liveTimeRef = useRef(0);
  useEffect(() => {
    const unsubscribe = liveTime.subscribe((t) => {
      liveTimeRef.current = t;
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Re-run the DOM scans whenever the timeline's elements change — the
  // reliable existing signal that the preview DOM was reloaded/edited.
  const elements = usePlayerStore((s) => s.elements);
  // Also re-run when the FX panel adds/removes/swaps a chain file: that rewrite
  // is invisible to `elements`, so the panel bumps this counter to drive the
  // load effect's content-diff reconcile (see playerStore's vstChainRevision).
  const vstChainRevision = usePlayerStore((s) => s.vstChainRevision);

  // ── Lazily start the sidecar once a vst-chain track appears ─────────────
  useEffect(() => {
    if (!STUDIO_VST_ENABLED) return;
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

    // Reconcile before (re)loading — see `reconcileRemovedTracks`'s
    // doc-comment. Runs even when no vst-chain elements remain (a full
    // removal), so the dry element gets unmuted.
    reconcileRemovedTracks(audioEls, loadedTracksRef.current, trackOrderRef.current);

    if (audioEls.length === 0) return;

    const workletModuleUrl = new URL("../lib/vstStreamWorklet.js", import.meta.url).href;
    let cancelled = false;

    void runVstLoadScan({
      audioEls,
      projectId,
      api,
      workletModuleUrl,
      showToast,
      sendTransport,
      loadedTracks: loadedTracksRef.current,
      trackOrder: trackOrderRef.current,
      pendingTrackIds: pendingTrackIdsRef.current,
      isAborted: () => isLoadAborted(cancelled, suspendedRef.current),
      isSuspended: () => suspendedRef.current,
      liveTimeSec: () => liveTimeRef.current,
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, status, api, elements, vstChainRevision, iframeRef, sendTransport, showToast]);

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
      dbg("transport", { isPlaying: state.isPlaying, loaded: loadedTracksRef.current.size });
      if (loadedTracksRef.current.size === 0) return;
      const timeSec = liveTimeRef.current;
      if (state.isPlaying) {
        resumeSuspendedContexts(loadedTracksRef.current.values());
      }
      const msg: TransportMsg = state.isPlaying
        ? { action: "play", timeSec, rate: state.playbackRate }
        : { action: "pause" };
      sendTransport(msg);
      // Realign the client rings on BOTH transitions. Play: to the integer
      // sample position the sidecar starts streaming from (it just seeked to
      // `timeSec`), and — via reset → setDriftBaseline — anchor drift
      // measurement to this moment so the one-time play→first-frame latency
      // isn't misread as drift. Sending transport FIRST, then resetting,
      // keeps the worklet ring's expected position matching the frames now
      // on their way; without this reset a stale ring from a previous run
      // rejects every new frame. Pause: the sidecar streams `_PUMP_LEAD_SEC`
      // (~0.5s) of audio AHEAD of the playhead as a jitter cushion, all of it
      // sitting in the worklet ring — pausing only stops the pump, so
      // without a flush the ring audibly drains that buffered lead for up to
      // a second after the pause click. The reset zero-fills the ring, so
      // pause is silent immediately; the next play reseeks anyway.
      reseekLoadedTracks(loadedTracksRef.current.values(), timeSec);
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
      // TEMP DEBUG — remove after diagnosis
      const w = window as unknown as { __vstPcm?: { n: number; dropped: number } };
      w.__vstPcm = w.__vstPcm ?? { n: 0, dropped: 0 };
      w.__vstPcm.n += 1;
      if (loadedTracksRef.current.size === 0) {
        w.__vstPcm.dropped += 1;
        return;
      }
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
      w.__vstPcm.dropped += 1;
    });
  }, [onPcmFrame]);

  // ── Periodic drift check ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (loadedTracksRef.current.size === 0) return;
      const timeSec = liveTimeRef.current;
      const drifted = Array.from(loadedTracksRef.current.values()).some((track) =>
        track.driftTracker.needsResync(timeSec),
      );
      if (!drifted) return;
      // The sidecar coalesces repeated seeks server-side — no client-side
      // coalescing needed here.
      sendTransport({ action: "seek", timeSec });
      reseekLoadedTracks(loadedTracksRef.current.values(), timeSec);
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
      dbg("disconnect", { wasAlreadySuspended: suspendedRef.current });
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
