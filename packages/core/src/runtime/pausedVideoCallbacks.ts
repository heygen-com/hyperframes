type Frame = Pick<VideoFrameCallbackMetadata, "mediaTime" | "width" | "height">;
type Pending = { callback: VideoFrameRequestCallback; native: number | null };
type State = {
  pending: Map<number, Pending>;
  frame: Frame | null;
  count: number;
  nativeCount: number;
  synthetic: boolean;
  dirty: boolean;
};
type Request = typeof HTMLVideoElement.prototype.requestVideoFrameCallback;
type Cancel = typeof HTMLVideoElement.prototype.cancelVideoFrameCallback;
type Registry = { states: WeakMap<HTMLVideoElement, State>; request: Request; cancel: Cancel };
type TrackedRequest = Request & { __hfPausedCallbacks?: Registry };

const registry = () =>
  (HTMLVideoElement.prototype.requestVideoFrameCallback as TrackedRequest)?.__hfPausedCallbacks;

function stateFor(owner: Registry, video: HTMLVideoElement): State {
  let state = owner.states.get(video);
  if (!state) {
    state = {
      pending: new Map(),
      frame: null,
      count: 0,
      nativeCount: 0,
      synthetic: false,
      dirty: false,
    };
    owner.states.set(video, state);
  }
  return state;
}

function requestNative(
  owner: Registry,
  video: HTMLVideoElement,
  state: State,
  pending: Pending,
  id: () => number,
): number {
  return owner.request.call(video, function (this: unknown, now, metadata) {
    pending.native = null;
    const advance = Math.max(0, metadata.presentedFrames - state.nativeCount);
    state.nativeCount = metadata.presentedFrames;
    if (state.frame) return;
    state.pending.delete(id());
    if (!state.synthetic) {
      state.count = metadata.presentedFrames;
      pending.callback.call(this, now, metadata);
      return;
    }
    state.count += advance;
    pending.callback.call(this, now, { ...metadata, presentedFrames: state.count });
  });
}

/** Install before authored scripts: Three's VideoTexture registers its first callback in its constructor. */
export function installPausedVideoCallbacks(): void {
  const proto = HTMLVideoElement.prototype;
  const request = proto.requestVideoFrameCallback as TrackedRequest;
  if (typeof request !== "function" || request.__hfPausedCallbacks) return;
  const owner: Registry = {
    states: new WeakMap(),
    request,
    cancel: proto.cancelVideoFrameCallback,
  };
  const patched: TrackedRequest = function (this: HTMLVideoElement, callback) {
    const state = stateFor(owner, this);
    const pending: Pending = { callback, native: null };
    const id = requestNative(owner, this, state, pending, () => id);
    pending.native = id;
    state.pending.set(id, pending);
    return id;
  };
  patched.__hfPausedCallbacks = owner;
  proto.requestVideoFrameCallback = patched;
  proto.cancelVideoFrameCallback = function (id) {
    const pending = owner.states.get(this)?.pending.get(id);
    if (!pending) return owner.cancel.call(this, id);
    owner.states.get(this)?.pending.delete(id);
    if (pending.native !== null) owner.cancel.call(this, pending.native);
  };
}

export function stagePausedVideoCallbacks(video: HTMLVideoElement, frame: Frame): void {
  const owner = registry();
  if (!owner) return;
  const state = stateFor(owner, video);
  state.frame = frame;
  state.dirty = true;
}

/** Notify once before composition redraw; callbacks registered from a callback wait for the next frame. */
export function flushPausedVideoCallbacks(video: HTMLVideoElement): void {
  const owner = registry();
  const state = owner?.states.get(video);
  if (!owner || !state?.frame || !state.dirty) return;
  state.dirty = false;
  state.synthetic = true;
  state.count++;
  const now = performance.now();
  const metadata: VideoFrameCallbackMetadata = {
    ...state.frame,
    presentedFrames: state.count,
    presentationTime: now,
    expectedDisplayTime: now,
    processingDuration: 0,
  };
  for (const [id, pending] of [...state.pending]) {
    if (!state.pending.delete(id)) continue;
    if (pending.native !== null) owner.cancel.call(video, pending.native);
    try {
      pending.callback.call(undefined, now, metadata);
    } catch (error) {
      reportError(error);
    }
  }
}

export function releasePausedVideoCallbacks(video: HTMLVideoElement): void {
  const owner = registry();
  const state = owner?.states.get(video);
  if (!owner || !state) return;
  state.frame = null;
  state.dirty = false;
  for (const [id, pending] of state.pending) {
    if (pending.native === null)
      pending.native = requestNative(owner, video, state, pending, () => id);
  }
}

/** Recovery must observe native frames even while authored callbacks still see staged pixels. */
export function observeNativeVideoFrames(
  video: HTMLVideoElement,
  onFrame: () => boolean,
): () => void {
  const owner = registry();
  const request = owner?.request ?? video.requestVideoFrameCallback;
  const cancel = owner?.cancel ?? video.cancelVideoFrameCallback;
  let handle: number | null = null;
  let stopped = false;
  let playingAt: number | null = video.paused ? null : video.currentTime;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== null && typeof cancel === "function") cancel.call(video, handle);
    video.removeEventListener("playing", playing);
    video.removeEventListener("timeupdate", progress);
  };
  const arm = () => {
    if (!stopped && typeof request === "function") handle = request.call(video, presented);
  };
  const presented = () => {
    handle = null;
    if (stopped) return;
    if (onFrame()) stop();
    else arm();
  };
  const playing = () => {
    playingAt = video.currentTime;
  };
  const progress = () => {
    if (stopped || playingAt === null || video.paused || video.currentTime === playingAt) return;
    if (onFrame()) stop();
  };
  video.addEventListener("playing", playing);
  video.addEventListener("timeupdate", progress);
  arm();
  return stop;
}
