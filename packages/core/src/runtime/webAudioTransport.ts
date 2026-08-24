import { attachElementFxChain, readElementAutomation, type ElementFxHandle } from "./audioFx.js";
import {
  clearParamLane,
  scheduleParamLane,
  volumeLane,
  type AutomationTiming,
} from "../audio/audioFxAutomation.js";
import { VOLUME_RANGE } from "../audioAutomation.js";
import {
  audioGroupOf,
  isAudibleUnderSolo,
  readAudioGroupVolume,
  resolveGroupElement,
} from "../audioGroups.js";
import { swallow } from "./diagnostics";
import { clampAudioGain } from "../audioGain.js";
import { getDebugSurface } from "./globals.js";
import { readElementPlaybackRate } from "./media.js";

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
}

/**
 * The render puts every track volume through `clampVolume`, which is
 * `clampAudioGain` — ceiling MAX_AUDIO_GAIN (+12 dB, ~3.98), not unity. Preview
 * has to agree or the two diverge on exactly the attribute this bus exists to
 * honour: an authored `<hf-audio-group data-volume="2">` previewed at 1.0 and
 * exported at 2.0, up to 6 dB quieter in the audition than in the file, and
 * 12 dB at the ceiling. Preview was also self-inconsistent — the same
 * parameter's automation lane is bounded by `VOLUME_RANGE.max`, which IS
 * MAX_AUDIO_GAIN, so an envelope could reach 3.98 where the static fader could
 * not pass 1.0. `clampAudioGain` still floors at 0, so a negative value cannot
 * invert polarity in preview while rendering silent. Compositions are
 * hand-authorable, so out-of-range values do not need a slider to be reachable.
 */
function clampGroupVolume(volume: number): number {
  return clampAudioGain(volume);
}

/**
 * Breadcrumb for the per-element-mute handoff: the transport just claimed a track
 * that was audibly playing through the HTMLMedia fallback. Quiet unless
 * `__hfDebug` — a hook for diagnosing the race if it ever regresses.
 */
function logFallbackHandoff(el: HTMLMediaElement, priorMuted: boolean): void {
  if (priorMuted || el.paused || !getDebugSurface().__hfDebug) return;
  // eslint-disable-next-line no-console -- intentional debug surface
  console.debug(
    "[hyperframes] webAudioTransport claimed fallback-playing element:",
    el.currentSrc || el.getAttribute("src") || "",
  );
}

/**
 * Start a buffer source, bounding it to the clip's authored window
 * (`data-duration`) so a trimmed clip stops at its edge instead of running the
 * buffer to the source file's natural end. `clipSourceLen` is the clip span in
 * buffer seconds; the third `start()` arg is the portion to play from the
 * offset. An infinite `clipDuration` plays unbounded (legacy behavior).
 *
 * Returns false when the playhead is already past the clip end (nothing to
 * play); the caller should discard the source.
 */
function startBoundedSource(
  node: AudioBufferSourceNode,
  opts: {
    elapsed: number;
    mediaStart: number;
    scheduledAt: number;
    globalRate: number;
    mediaRate: number;
    clipDuration: number;
  },
): boolean {
  const { elapsed, mediaStart, scheduledAt, globalRate, mediaRate, clipDuration } = opts;
  const hasBound = Number.isFinite(clipDuration) && clipDuration > 0;
  const clipSourceLen = clipDuration * mediaRate;
  if (elapsed >= 0) {
    const sourceElapsed = elapsed * mediaRate;
    const remaining = clipSourceLen - sourceElapsed;
    if (hasBound && remaining <= 0) return false;
    if (hasBound) node.start(0, sourceElapsed + mediaStart, remaining);
    else node.start(0, sourceElapsed + mediaStart);
    return true;
  }
  const delay = -elapsed / globalRate;
  if (hasBound) node.start(scheduledAt + delay, mediaStart, clipSourceLen);
  else node.start(scheduledAt + delay, mediaStart);
  return true;
}

/**
 * The volume lane rides the fader, after the effects — where a DAW puts it,
 * and the order the render bakes it in.
 *
 * Typed against the attribute reader rather than `HTMLMediaElement` so a group
 * bus (an `<hf-audio-group>`, not a media element) can ride the same path.
 */
function scheduleVolumeLane(
  el: { getAttribute?(name: string): string | null },
  gainNode: GainNode,
  timing: AutomationTiming,
): void {
  const lane = volumeLane(readElementAutomation(el));
  if (!lane) return;
  scheduleParamLane([{ param: gainNode.gain }], lane, VOLUME_RANGE.scale, timing);
}

type ScheduledSourceBase = {
  el: HTMLMediaElement;
  gainNode: GainNode;
  /** Dedicated solo stage so toggles never overwrite authored volume ramps. */
  soloGain: GainNode;
  /** FX chain spliced between source and gain, when the element carries one. */
  fx?: ElementFxHandle | null;
  compositionStart: number;
  mediaStart: number;
  scheduledAt: number;
  priorMuted: boolean;
  priorVolume: number;
  mediaPlaybackRate: number;
  // The clip had a finite window, so start() was given a fixed duration in
  // buffer-sample seconds. That bound can't be rescaled in place on a rate
  // change — callers must stopAll()+reschedule (see hasBoundedActiveSources).
  bounded: boolean;
};

export type ScheduledSource = ScheduledSourceBase &
  (
    | { sourceKind: "buffer"; sourceNode: AudioBufferSourceNode }
    | { sourceKind: "media-element"; sourceNode: MediaElementAudioSourceNode }
  );

function isBufferSource(
  source: ScheduledSource,
): source is ScheduledSourceBase & { sourceKind: "buffer"; sourceNode: AudioBufferSourceNode } {
  return source.sourceKind === "buffer";
}

export class WebAudioTransport {
  private _ctx: AudioContext | null = null;
  private _bufferCache = new Map<string, AudioBuffer>();
  private _failedSrcs = new Set<string>();
  private _mediaElementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private _activeSources: ScheduledSource[] = [];
  private _masterGain: GainNode | null = null;
  private _masterVolume = 1;
  private _masterMuted = false;
  // One shared bus per group id, lazily built the first time a member of that
  // group is scheduled. Lives for the session (mirrors `_masterGain`'s own
  // lifecycle) rather than being torn down on every `stopAll()`, so replaying
  // a group does not rebuild its chain; only `destroy()` disposes these.
  private _groups = new Map<
    string,
    {
      input: GainNode;
      /** Post-FX fader: `data-volume` plus the volume lane. */
      fader: GainNode;
      muteGain: GainNode;
      /** Kept so `setRate` can re-aim this bus's FX automation, the way it does
       *  every source's — its docblock claims it already did. */
      fx: ElementFxHandle | null;
      /** Play generation the current envelopes were booked against. */
      generation: number;
      reanchor(timing: AutomationTiming): void;
      dispose(): void;
    }
  >();
  // Composition-time reference frame: at AudioContext time `_rateAnchorCtx`,
  // composition time was `_rateAnchorComp`, and time has been advancing at
  // `_rate` composition-seconds per wallclock-second since.
  private _rateAnchorCtx = 0;
  private _rateAnchorComp = 0;
  private _rate = 1;
  private _paused = true;
  private _playGeneration = 0;
  // Session-only preview state pushed by Studio. Never serialized.
  private _soloed: ReadonlySet<string> = new Set();

  async init(): Promise<boolean> {
    try {
      this._ctx = new AudioContext();
      this._masterGain = this._ctx.createGain();
      this._masterGain.connect(this._ctx.destination);
      this.applyMasterGain();
      return true;
    } catch {
      return false;
    }
  }

  get context(): AudioContext | null {
    return this._ctx;
  }

  getTime(): number {
    if (!this._ctx || this._paused) return -1;
    return this._rateAnchorComp + (this._ctx.currentTime - this._rateAnchorCtx) * this._rate;
  }

  async decodeAudioElement(el: HTMLMediaElement): Promise<AudioBuffer | null> {
    const src = el.currentSrc || el.getAttribute("src");
    if (!src) return null;
    if (this._bufferCache.has(src)) return this._bufferCache.get(src)!;
    if (this._failedSrcs.has(src)) return null;
    if (!this._ctx) return null;

    // Fetch the bytes. A network error or non-OK status (e.g. a 404 for an
    // asset that simply has not been uploaded yet) is TRANSIENT — return null
    // WITHOUT blacklisting, so the next play/seek generation retries once the
    // asset becomes available. (Previously these were added to `_failedSrcs`,
    // which is never cleared, permanently silencing a merely-late track.)
    let arrayBuffer: ArrayBuffer;
    try {
      // `no-store`: a retry must actually re-request the asset — not replay a
      // cached 404/stale response from the failed attempt that we chose not to
      // blacklist.
      const response = await fetch(src, { cache: "no-store" });
      if (!response.ok) {
        swallow("webAudioTransport.fetch", new Error(`${response.status} ${src}`));
        return null;
      }
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      swallow("webAudioTransport.fetch", err);
      return null;
    }

    // A decode failure means the bytes themselves are unusable (corrupt or an
    // unsupported codec) — that IS permanent, so blacklist to avoid re-decoding
    // the same bad payload on every generation.
    try {
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
      this._bufferCache.set(src, audioBuffer);
      return audioBuffer;
    } catch (err) {
      this._failedSrcs.add(src);
      swallow("webAudioTransport.decode", err);
      return null;
    }
  }

  startGeneration(): number {
    this._playGeneration += 1;
    return this._playGeneration;
  }

  currentGeneration(): number {
    return this._playGeneration;
  }

  /** Connect one source through its own solo stage and then into its group bus
   * (or master for an ungrouped clip). Resolving the group first preserves one
   * shared bus while solo remains strictly per member. */
  private connectThroughSolo(
    ctx: AudioContext,
    masterGain: GainNode,
    el: HTMLMediaElement,
    gainNode: GainNode,
    timing: { scheduledAt: number; compositionTime: number; rate: number },
  ): GainNode {
    const destination =
      this.resolveDestination(el, timing.scheduledAt, timing.compositionTime, timing.rate) ??
      masterGain;
    const soloGain = ctx.createGain();
    soloGain.gain.value = isAudibleUnderSolo(this._soloed, el.id, audioGroupOf(el)) ? 1 : 0;
    gainNode.connect(soloGain);
    soloGain.connect(destination);
    return soloGain;
  }

  /**
   * Route the browser's pitch-preserving HTMLMediaElement transport through the
   * same FX, automation, element-gain, and master graph used by final audio.
   * The media element remains the source-time/rate owner; Web Audio is strictly
   * downstream and therefore never resamples it for Studio global speed.
   */
  async scheduleMediaElementPlayback(
    el: HTMLMediaElement,
    compositionStart: number,
    _mediaStart: number,
    compositionTime: number,
    volume: number,
    generation: number,
    rate = 1,
  ): Promise<ScheduledSource | null> {
    if (!this._ctx || !this._masterGain) return null;
    if (generation !== this._playGeneration) return null;

    try {
      if (this._ctx.state === "suspended") await this._ctx.resume();
      if (generation !== this._playGeneration) return null;

      let sourceNode = this._mediaElementSources.get(el);
      if (!sourceNode) {
        sourceNode = this._ctx.createMediaElementSource(el);
        this._mediaElementSources.set(el, sourceNode);
      }

      const safeRate = normalizeRate(rate);
      const gainNode = this._ctx.createGain();
      gainNode.gain.value = volume;
      const scheduledAt = this._ctx.currentTime;
      const elapsed = compositionTime - compositionStart;
      const timing: AutomationTiming = { scheduledAt, elapsed, rate: safeRate };
      const fx = attachElementFxChain(this._ctx, el, sourceNode, gainNode, timing);
      // The group bus, not master, for a member — same as the decoded-buffer
      // path. This transport is the PRIMARY one for audio (the decode path is
      // its fallback), so routing it at master would have left every grouped
      // track bypassing the bus whose whole premise is that a group is one
      // signal.
      const soloGain = this.connectThroughSolo(this._ctx, this._masterGain, el, gainNode, {
        scheduledAt,
        compositionTime,
        rate: safeRate,
      });
      scheduleVolumeLane(el, gainNode, timing);

      this._rate = safeRate;
      this._rateAnchorCtx = scheduledAt;
      this._rateAnchorComp = compositionTime;

      const scheduled: ScheduledSource = {
        fx,
        el,
        sourceNode,
        sourceKind: "media-element",
        gainNode,
        soloGain,
        compositionStart,
        mediaStart: _mediaStart,
        scheduledAt,
        priorMuted: el.muted,
        priorVolume: el.volume,
        mediaPlaybackRate: readElementPlaybackRate(el),
        bounded: false,
      };
      // Chrome applies HTMLMediaElement.volume before MediaElementAudioSource.
      // Keep that upstream stage at unity so the existing downstream gain is
      // the single owner of author × user volume and automation.
      el.volume = 1;
      this._activeSources.push(scheduled);
      this._paused = false;
      return scheduled;
    } catch (err) {
      swallow("webAudioTransport.mediaElementSource", err);
      return null;
    }
  }

  /**
   * The gain a grouped member's signal should land on, building it on first
   * use. A group's clock is COMPOSITION time (design doc §1.3) — it has no
   * `data-start`, and a missing start parses as 0, which is exactly
   * composition time — so its chain and volume lane are scheduled once here
   * against that zero-offset timing, not the member's own clip-local timing.
   * A group id with no matching `<hf-audio-group>` element still gets a bus
   * (flat, no chain) so a hand-authored `data-audio-group` degrades to a
   * plain sum rather than losing the member's audio.
   */
  private groupInput(groupId: string, doc: Document, timing: AutomationTiming): GainNode | null {
    const existing = this._groups.get(groupId);
    if (existing) {
      // The bus outlives `stopAll()` on purpose, so a replay or a seek reuses
      // this graph — but its envelopes were committed to the FIRST pass's
      // absolute context times. Left alone they hold their last value forever,
      // which for a fade-out is silence for the rest of the session. Re-anchor
      // once per play generation, not once per member scheduled.
      if (existing.generation !== this._playGeneration) {
        // Stamped only on success, and isolated: this runs inside
        // `schedulePlayback`, whose catch turns any throw into `return null` —
        // i.e. a bus problem would silently drop the MEMBER from the pass. And
        // stamping first would consume the generation, so no later member of
        // the same group would retry and the bus would keep the previous pass's
        // envelopes: finding 11 unfixed on exactly the pass that failed.
        try {
          existing.reanchor(timing);
          existing.generation = this._playGeneration;
        } catch (err) {
          swallow("webAudioTransport.groupReanchor", err);
        }
      }
      return existing.input;
    }
    if (!this._ctx || !this._masterGain) return null;

    const input = this._ctx.createGain();
    // Stable point the FX chain (or, when there's none, the dry passthrough —
    // see `attachElementFxChain`'s `detach()`) always lands on before master,
    // regardless of whether a chain is attached/detached/rebuilt later. The
    // mute gain splices in BEFORE `output`, between the FX chain and here.
    const output = this._ctx.createGain();
    output.connect(this._masterGain);

    // Tag-checked, and re-resolved on every reanchor below rather than frozen:
    // a bus whose element does not exist yet (studio group creation, or a
    // sub-composition that loads later) kept the `getAttribute: () => null`
    // stub for the whole session, so its fader, chain and mute never reached
    // preview while the export honoured all three.
    const resolveEl = (): Element | null => resolveGroupElement(doc, groupId);
    const groupEl = resolveEl();
    const muteGain = this._ctx.createGain();
    muteGain.gain.value = groupEl?.hasAttribute("data-hidden") ? 0 : 1;
    muteGain.connect(output);
    // The group's fader, POST-FX: `data-volume` is the static position and the
    // volume lane rides it, which is where a DAW puts it and the order the
    // render bakes it in (`scheduleVolumeLane`'s own contract). Scheduling it
    // on `input` instead put the fader ahead of the effects, so any nonlinear
    // group effect — a compressor, the Giant preset — previewed differently
    // than it rendered.
    const fader = this._ctx.createGain();
    fader.gain.value = clampGroupVolume(readAudioGroupVolume(groupEl));
    fader.connect(muteGain);
    const fx = attachElementFxChain(
      this._ctx,
      groupEl ?? { getAttribute: () => null },
      input,
      fader,
      timing,
    );
    if (groupEl) scheduleVolumeLane(groupEl, fader, timing);

    this._groups.set(groupId, {
      input,
      fader,
      muteGain,
      fx,
      generation: this._playGeneration,
      reanchor: (at: AutomationTiming) => {
        // Cleared BEFORE the value write, and unconditionally. `scheduleVolumeLane`
        // clears as part of scheduling, but returns early when the group no
        // longer has a lane — and a scheduled envelope outranks a `.value`
        // write, so deleting a group's automation mid-session otherwise left
        // the previous pass's ramps still owning the param (for a fade-out,
        // silence) for the rest of the session.
        clearParamLane([{ param: fader.gain }]);
        // Re-resolved, not the element captured at build time — see `resolveEl`.
        const live = resolveEl();
        fader.gain.value = clampGroupVolume(readAudioGroupVolume(live));
        muteGain.gain.value = live?.hasAttribute("data-hidden") ? 0 : 1;
        fx?.reanchor(at);
        if (live) scheduleVolumeLane(live, fader, at);
      },
      dispose: () => {
        try {
          fx?.dispose();
          input.disconnect();
          fader.disconnect();
          muteGain.disconnect();
          output.disconnect();
        } catch {
          // Already torn down.
        }
      },
    });
    return input;
  }

  /**
   * Group mute, preview side — a separate gain from `input`'s volume fader
   * so a mute toggle never fights `scheduleVolumeLane`'s ramps on the
   * same param (the same hazard the design doc flags for §2.1). A no-op
   * until the group has an active member: at that point `groupInput` reads
   * the element's own `data-hidden` for its initial value, so there is
   * nothing to catch up on here.
   */
  setGroupMuted(groupId: string, muted: boolean): void {
    const group = this._groups.get(groupId);
    if (!group) return;
    try {
      group.muteGain.gain.value = muted ? 0 : 1;
    } catch (err) {
      swallow("webAudioTransport.setGroupMuted", err);
    }
  }

  /** Master, unless `el` belongs to a group — then that group's bus (built on
   *  first use, per `groupInput`). */
  private resolveDestination(
    el: HTMLMediaElement,
    scheduledAt: number,
    compositionTime: number,
    safeRate: number,
  ): GainNode | null {
    if (!this._masterGain) return null;
    const groupId = audioGroupOf(el);
    if (!groupId) return this._masterGain;
    const groupTiming: AutomationTiming = { scheduledAt, elapsed: compositionTime, rate: safeRate };
    return this.groupInput(groupId, el.ownerDocument, groupTiming) ?? this._masterGain;
  }

  /**
   * The graph goes with it. Splicing alone left the FX handle alive and then
   * UNREACHABLE — `stopAll()` disposes by walking `_activeSources`, which the
   * splice just emptied of this entry. Every clip that finished naturally
   * leaked its MutationObserver for the session, and each one still answered
   * later `data-fx-chain` edits by rebuilding a whole graph (impulse response,
   * chorus/phaser oscillators started and never stopped) around a dead
   * source. Not disposed when the index is already -1: `stopAll()` has
   * already done it, and `stop()` is what fired this event.
   */
  private handleSourceEnded(
    sourceNode: AudioBufferSourceNode,
    scheduled: ScheduledSource,
    el: HTMLMediaElement,
    priorMuted: boolean,
  ): void {
    const idx = this._activeSources.indexOf(scheduled);
    if (idx === -1) return;
    this._activeSources.splice(idx, 1);
    el.muted = priorMuted;
    try {
      sourceNode.disconnect();
      scheduled.fx?.dispose();
      scheduled.gainNode.disconnect();
      scheduled.soloGain.disconnect();
    } catch {
      // Already torn down.
    }
    if (this._activeSources.length === 0) this._paused = true;
  }

  // Pre-existing size (110 lines before this diff, which shrank it to under
  // 95 via two extractions — see `handleSourceEnded`/`resolveDestination`);
  // the remainder is inherently sequential graph-wiring, not a nested
  // decision tree, and further splitting would cost more readability than it
  // buys. Same call the B2 step took on `TimelineLogicalRow`.
  // fallow-ignore-next-line complexity
  async schedulePlayback(
    el: HTMLMediaElement,
    buffer: AudioBuffer,
    compositionStart: number,
    mediaStart: number,
    compositionTime: number,
    volume: number,
    generation: number,
    rate = 1,
    clipDuration = Number.POSITIVE_INFINITY,
  ): Promise<ScheduledSource | null> {
    if (!this._ctx || !this._masterGain) return null;
    if (generation !== this._playGeneration) return null;

    try {
      if (this._ctx.state === "suspended") {
        await this._ctx.resume();
      }
      if (generation !== this._playGeneration) return null;

      const safeRate = normalizeRate(rate);
      const mediaRate = readElementPlaybackRate(el);
      const sourceRate = safeRate * mediaRate;

      const sourceNode = this._ctx.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.playbackRate.value = sourceRate;

      const gainNode = this._ctx.createGain();
      gainNode.gain.value = volume;

      const elapsed = compositionTime - compositionStart;
      const scheduledAt = this._ctx.currentTime;
      const timing: AutomationTiming = { scheduledAt, elapsed, rate: safeRate };

      // Splice the element's FX chain between the decoded source and its gain,
      // so effects see the raw signal and volume automation rides on their
      // output — the same order the offline render uses. Preview and render run
      // the identical graph builders, so what is heard here is what is written.
      const fx = attachElementFxChain(this._ctx, el, sourceNode, gainNode, timing);
      const soloGain = this.connectThroughSolo(this._ctx, this._masterGain, el, gainNode, {
        scheduledAt,
        compositionTime,
        rate: safeRate,
      });

      scheduleVolumeLane(el, gainNode, timing);

      this._rate = safeRate;
      this._rateAnchorCtx = scheduledAt;
      this._rateAnchorComp = compositionTime;

      if (
        !startBoundedSource(sourceNode, {
          elapsed,
          mediaStart,
          scheduledAt,
          globalRate: safeRate,
          mediaRate,
          clipDuration,
        })
      ) {
        // Playhead already past the clip end — discard the nodes we built.
        sourceNode.disconnect();
        fx?.dispose();
        gainNode.disconnect();
        soloGain.disconnect();
        return null;
      }

      const priorMuted = el.muted;
      el.muted = true;
      logFallbackHandoff(el, priorMuted);

      const scheduled: ScheduledSource = {
        fx,
        el,
        sourceNode,
        sourceKind: "buffer",
        gainNode,
        soloGain,
        compositionStart,
        mediaStart,
        scheduledAt,
        priorMuted,
        priorVolume: el.volume,
        mediaPlaybackRate: mediaRate,
        bounded: Number.isFinite(clipDuration) && clipDuration > 0,
      };
      this._activeSources.push(scheduled);
      this._paused = false;

      sourceNode.addEventListener("ended", () =>
        this.handleSourceEnded(sourceNode, scheduled, el, priorMuted),
      );

      return scheduled;
    } catch (err) {
      swallow("webAudioTransport.schedule", err);
      return null;
    }
  }

  /**
   * Rebases the composition-time reference frame before swapping rate so
   * `getTime()` stays continuous across the change. Sources scheduled to
   * start in the future keep their original wallclock start time — callers
   * that need rate-correct future starts should `stopAll()` and reschedule.
   *
   * Each source's FX automation is re-aimed too. Lanes are committed to
   * absolute context times when the source is scheduled, so bumping only
   * `playbackRate` left every automated parameter running its original plan
   * over audio moving at a different speed. The `stopAll()`+reschedule recovery
   * in the runtime is no help here: it only fires for bounded sources, and a
   * project-level music bed with no `data-duration` is unbounded, so it never
   * recovered at all.
   */
  setRate(rate: number): boolean {
    const safeRate = normalizeRate(rate);
    if (safeRate === this._rate) return false;
    if (this._ctx && !this._paused) {
      this._rateAnchorComp = this.getTime();
      this._rateAnchorCtx = this._ctx.currentTime;
    }
    this._rate = safeRate;
    for (const source of this._activeSources) {
      try {
        if (isBufferSource(source)) {
          source.sourceNode.playbackRate.value = safeRate * source.mediaPlaybackRate;
        }
        source.fx?.setRate(safeRate);
      } catch (err) {
        swallow("webAudioTransport.setRate", err);
      }
    }
    // Group buses are not in `_activeSources` — they outlive it — so their FX
    // automation needs re-aiming here too, or a rate change leaves a group's
    // envelopes running the old plan over audio at the new speed.
    for (const group of this._groups.values()) {
      try {
        group.fx?.setRate(safeRate);
      } catch (err) {
        swallow("webAudioTransport.setRate.group", err);
      }
    }
    return true;
  }

  // A bounded source's wall-clock duration was baked into start()'s duration
  // arg at its original rate; a later rate change can't rescale it in place, so
  // the caller must stopAll()+reschedule to keep trimmed clips ending on time.
  hasBoundedActiveSources(): boolean {
    return this._activeSources.some((s) => isBufferSource(s) && s.bounded);
  }

  stopAll(): void {
    for (const source of this._activeSources) {
      try {
        if (isBufferSource(source)) source.sourceNode.stop();
        source.sourceNode.disconnect();
        source.fx?.dispose();
        source.gainNode.disconnect();
        source.soloGain.disconnect();
      } catch {
        // already stopped
      }
      if (isBufferSource(source)) source.el.muted = source.priorMuted;
      else source.el.volume = source.priorVolume;
    }
    this._activeSources = [];
    this._paused = true;
  }

  setVolume(volume: number): void {
    this._masterVolume = Math.max(0, Math.min(1, volume));
    this.applyMasterGain();
  }

  /**
   * The per-element gain carries the clip's AUTHOR gain, which reaches
   * MAX_AUDIO_GAIN — so it is clamped against that ceiling, not the spec's
   * [0,1]. `setVolume` above is the opposite case and stays spec-clamped: the
   * user's master volume is a fader, not a gain.
   *
   * Clamping this one at unity capped every static above-unity `data-volume` on
   * the preview path while the render honoured it — the exact preview/render
   * divergence this ceiling exists to close. Automation lanes hid it, because
   * they schedule ramps onto the param directly and never pass through here.
   */
  setElementVolume(el: HTMLMediaElement, volume: number): void {
    const safeVolume = clampAudioGain(volume);
    for (const source of this._activeSources) {
      if (source.el !== el) continue;
      try {
        if (source.sourceKind === "media-element") source.el.volume = 1;
        source.gainNode.gain.value = safeVolume;
      } catch (err) {
        swallow("webAudioTransport.setElementVolume", err);
      }
    }
  }

  setMuted(muted: boolean): void {
    this._masterMuted = muted;
    this.applyMasterGain();
  }

  /** Update every active source without rebuilding the graph. Group ids solo
   * all members through the shared audibility predicate. */
  setSolo(soloed: ReadonlySet<string>): void {
    this._soloed = soloed;
    for (const source of this._activeSources) {
      try {
        source.soloGain.gain.value = isAudibleUnderSolo(
          this._soloed,
          source.el.id,
          audioGroupOf(source.el),
        )
          ? 1
          : 0;
      } catch (err) {
        swallow("webAudioTransport.setSolo", err);
      }
    }
  }

  private applyMasterGain(): void {
    if (this._masterGain) this._masterGain.gain.value = this._masterMuted ? 0 : this._masterVolume;
  }

  isActive(): boolean {
    return this._activeSources.length > 0 && !this._paused;
  }

  /** Whether the transport currently plays THIS element (the runtime mutes it to
   *  avoid double audio; an unclaimed track stays audible). */
  ownsElement(el: HTMLMediaElement): boolean {
    return !this._paused && this._activeSources.some((s) => s.el === el && isBufferSource(s));
  }

  /** Whether this element's native signal currently flows through the WebAudio graph. */
  routesElement(el: HTMLMediaElement): boolean {
    return !this._paused && this._activeSources.some((source) => source.el === el);
  }

  destroy(): void {
    this.stopAll();
    for (const group of this._groups.values()) group.dispose();
    this._groups.clear();
    this._bufferCache.clear();
    this._failedSrcs.clear();
    this._mediaElementSources = new WeakMap();
    if (this._ctx) {
      try {
        void this._ctx.close();
      } catch {
        // ignore
      }
    }
    this._ctx = null;
    this._masterGain = null;
    this._masterVolume = 1;
    this._masterMuted = false;
  }
}
