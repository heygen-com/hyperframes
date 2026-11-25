import { WebAudioTransport } from "@hyperframes/core/runtime/web-audio-transport";
import { bytesOfSource, decodesFirst } from "@hyperframes/core/runtime/decodes-first";
import type { ProxyEntry } from "./parent-media.js";

// A sealed film's frame never gets the tap's user activation, so its AudioContext cannot start and WebKit plays its
// audio from elements that start late. The player has the tap: it plays the film's listed audio clips here from
// decoded buffers, and the film's picture follows this audio clock.

/** Decode fetches stay on the host that served the copy: no redirect elsewhere, cookies only to it. */
const DECODE_FETCH: RequestInit = { method: "GET", credentials: "same-origin", redirect: "error" };
/** Re-anchors the film to the audio clock often enough that the audio device's drift never shows. */
const CLOCK_POST_MS = 250;
const METADATA_WAIT_MS = 5000;
/** A group's bus lives on a film element the parent cannot read, so its members keep their native copy. */
const NATIVE_ONLY_ATTRS = ["data-audio-group"] as const;
const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

export interface ParentAudioHost {
  copies: () => readonly ProxyEntry[];
  sendControl: (action: string, extra?: Record<string, unknown>) => void;
  getCurrentTime: () => number;
  getPlaybackRate: () => number;
  getVolume: () => number;
  getMuted: () => boolean;
  isPaused: () => boolean;
  /** A context the host opened inside a tap before this code had loaded; handed over once. */
  takeTapContext?: () => AudioContext | null;
}

export class ParentAudio {
  private _transport: WebAudioTransport | null = null;
  private _clockTimer: ReturnType<typeof setInterval> | null = null;
  private _unlock: (() => void) | null = null;

  constructor(private readonly _host: ParentAudioHost) {}

  /** Tells the film which clips play here; the first call also asks it for its list. */
  postClaims(): void {
    const clips = this._host
      .copies()
      .flatMap((m) => (m.claimed && m.listedKey ? [m.listedKey] : []));
    this._host.sendControl("set-parent-audio", { clips });
  }

  /** Inside the tap: wake the context, then put every clip that decodes on a buffer at the playhead. */
  play(): void {
    if (this._host.getPlaybackRate() !== 1) return this.release();
    const transport = this._open();
    if (!transport) return;
    if (transport.context?.state !== "running") {
      void transport.context?.resume().catch(() => {});
      this._armUnlock(transport);
    }
    // A list that changed mid-play reschedules the whole mix, as the runtime does for a hidden clip.
    transport.stopAll();
    const gen = transport.currentGeneration();
    for (const entry of this._host.copies()) void this._start(transport, entry, gen);
  }

  pause(): void {
    this._transport?.stopAll();
    this._stopClock();
  }

  /** Every clip back to the film's own elements: a speed other than 1x keeps pitch only there. */
  release(): void {
    this.pause();
    const claimed = this._host.copies().filter((m) => m.claimed);
    for (const m of claimed) m.claimed = false;
    if (claimed.length > 0) this.postClaims();
  }

  setRate(rate: number): void {
    if (rate !== 1) this.release();
  }

  setVolume(volume: number): void {
    this._transport?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    this._transport?.setMuted(muted);
  }

  /** A new film: its copies are rebuilt, so nothing here is claimed any more. */
  reset(): void {
    this.pause();
    this._disarmUnlock();
  }

  destroy(): void {
    this.reset();
    this._transport?.destroy();
    this._transport = null;
  }

  private _open(): WebAudioTransport | null {
    this._transport ??= new WebAudioTransport({
      fetchInit: DECODE_FETCH,
      busDocument: null,
      context: this._host.takeTapContext?.() ?? undefined,
    });
    if (!this._transport.open()) return null;
    this._transport.setVolume(this._host.getVolume());
    this._transport.setMuted(this._host.getMuted());
    return this._transport;
  }

  private async _start(
    transport: WebAudioTransport,
    entry: ProxyEntry,
    gen: number,
  ): Promise<void> {
    if (!(await decodesHere(transport, entry)) || gen !== transport.currentGeneration()) return;
    const buffer = await transport.decodeAudioElement(entry.el);
    if (!buffer || gen !== transport.currentGeneration() || this._host.isPaused()) return;
    const volume = Number.parseFloat(entry.el.getAttribute("data-volume") ?? "");
    const scheduled = await transport.schedulePlayback(
      entry.el,
      buffer,
      entry.start,
      entry.mediaStart,
      () => this._time(transport),
      Number.isFinite(volume) ? volume : 1,
      gen,
      1,
      entry.duration,
    );
    if (!scheduled) return;
    this._claim(entry);
    this._startClock(transport);
  }

  private _claim(entry: ProxyEntry): void {
    if (entry.claimed) return;
    entry.claimed = true;
    entry.el.pause();
    this.postClaims();
  }

  /** The audio clock once a buffer plays; until then the film's time, which the first buffer starts from. */
  private _time(transport: WebAudioTransport): number {
    const time = transport.getTime();
    return time >= 0 ? time : this._host.getCurrentTime();
  }

  private _startClock(transport: WebAudioTransport): void {
    this._postClock(transport);
    this._clockTimer ??= setInterval(() => this._postClock(transport), CLOCK_POST_MS);
  }

  // `time` is exactly what unsealed's clock follows (`getTime()`, no latency correction), and `at` is read in
  // the same task, so the two modes put the picture on the same expression.
  private _postClock(transport: WebAudioTransport): void {
    const time = transport.getTime();
    if (time < 0) return;
    const at = performance.timeOrigin + performance.now();
    this._host.sendControl("audio-clock", { time, rate: this._host.getPlaybackRate(), at });
  }

  private _stopClock(): void {
    if (this._clockTimer !== null) clearInterval(this._clockTimer);
    if (this._clockTimer !== null) this._host.sendControl("audio-clock", { time: null });
    this._clockTimer = null;
  }

  // A host that played without a tap: the first tap anywhere on its page starts the waiting buffers.
  private _armUnlock(transport: WebAudioTransport): void {
    if (this._unlock) return;
    const unlock = () => {
      this._disarmUnlock();
      void transport.context?.resume().catch(() => {});
    };
    for (const type of UNLOCK_EVENTS) document.addEventListener(type, unlock, { capture: true });
    this._unlock = unlock;
  }

  private _disarmUnlock(): void {
    const unlock = this._unlock;
    if (!unlock) return;
    for (const type of UNLOCK_EVENTS) document.removeEventListener(type, unlock, { capture: true });
    this._unlock = null;
  }
}

/** Unsealed's verdict (`decodesFirst`), on a copy from the host's own origin carrying nothing native-only. */
async function decodesHere(transport: WebAudioTransport, entry: ProxyEntry): Promise<boolean> {
  const { el } = entry;
  if (!entry.listedKey || entry.mastered || el.tagName !== "AUDIO" || !fromThisHost(el.src))
    return false;
  if (NATIVE_ONLY_ATTRS.some((name) => el.hasAttribute(name))) return false;
  if (el.readyState < HTMLMediaElement.HAVE_METADATA) await metadataOf(el);
  await bytesOfSource(el.src);
  return decodesFirst(el, transport);
}

function fromThisHost(src: string): boolean {
  try {
    return new URL(src).origin === location.origin;
  } catch {
    return false;
  }
}

function metadataOf(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener("loadedmetadata", done);
      el.removeEventListener("error", done);
      resolve();
    };
    const timer = setTimeout(done, METADATA_WAIT_MS);
    el.addEventListener("loadedmetadata", done);
    el.addEventListener("error", done);
  });
}
