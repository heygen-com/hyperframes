// Injected into every frame before its scripts; records, never changes (except ?blocked=1: unmuted play() rejects).
// On window.__pb per frame: media events, video frames, per-rAF samples against the playhead, AudioParam calls, edges,
// an output tap. Times are epoch ms.
(() => {
  const qs = new URLSearchParams(location.search);
  const blocked =
    (window.parent !== window ? window.top.__pbBlocked : qs.get("blocked") === "1") === true;
  if (window.parent === window && qs.get("blocked") === "1") window.__pbBlocked = true;
  const epoch = (perfNow) =>
    performance.timeOrigin + (perfNow === undefined ? performance.now() : perfNow);
  const pb = (window.__pb = {
    kind: window.parent === window ? "host" : "comp",
    events: [], // [t, id, type, currentTime]
    frames: [], // [t(display), id, mediaTime, presentedFrames, visible]
    samples: [], // [t, id, currentTime, paused, seeking, rate, visible, playhead]
    params: [], // [t, ctxTime, nodeId, param, call, time, value]
    edges: [], // [fromId, toId]
    sources: [], // [nodeId, elementId]
    tap: [], // [frame, sampleRate, rms, hf, marker, block, arrivalEpoch]
    ctxs: [], // [t, ctxTime, outputTime, outputPerf]
    rejects: 0,
  });

  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => {
    if (!ids.has(o)) ids.set(o, nextId++);
    return ids.get(o);
  };
  const mediaId = (el) => el.id || `${el.tagName.toLowerCase()}-${idOf(el)}`;

  // ---- autoplay-blocked mode
  if (blocked && window.parent !== window) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted) {
        pb.rejects++;
        return Promise.reject(new DOMException("blocked for the measurement", "NotAllowedError"));
      }
      return play.call(this);
    };
  }

  // ---- media registry, element events, frame callbacks
  const seen = new WeakSet();
  const media = [];
  const playhead = () => {
    try {
      return window.__player && typeof window.__player.getTime === "function"
        ? window.__player.getTime()
        : null;
    } catch {
      return null;
    }
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
  };
  const adopt = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    media.push(el);
    const id = mediaId(el);
    for (const type of [
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "waiting",
      "stalled",
      "ratechange",
      "ended",
      "loadeddata",
      "canplay",
    ]) {
      el.addEventListener(type, () => pb.events.push([epoch(), id, type, el.currentTime]));
    }
    if (el.tagName === "VIDEO" && typeof el.requestVideoFrameCallback === "function") {
      const cb = (now, meta) => {
        pb.frames.push([
          epoch(meta.expectedDisplayTime || now),
          id,
          meta.mediaTime,
          meta.presentedFrames,
          visible(el) ? 1 : 0,
        ]);
        el.requestVideoFrameCallback(cb);
      };
      el.requestVideoFrameCallback(cb);
    }
    if (window.parent === window) tapElementStream(el);
  };
  // Parent-page proxies are created by script and never attached, so adopt them when they play.
  if (window.parent === window) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      adopt(this);
      return play.call(this);
    };
  }
  const scan = () => document.querySelectorAll("video,audio").forEach(adopt);
  new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", scan);
  const sampler = () => {
    const t = epoch();
    const ph = playhead();
    for (const el of media) {
      pb.samples.push([
        t,
        mediaId(el),
        el.currentTime,
        el.paused ? 1 : 0,
        el.seeking ? 1 : 0,
        el.playbackRate,
        visible(el) ? 1 : 0,
        ph,
      ]);
    }
    if (firstCtx && pb.ctxs.length < 20000) {
      const ts = firstCtx.getOutputTimestamp
        ? firstCtx.getOutputTimestamp()
        : { contextTime: 0, performanceTime: 0 };
      pb.ctxs.push([t, firstCtx.currentTime, ts.contextTime, epoch(ts.performanceTime)]);
    }
    requestAnimationFrame(sampler);
  };
  requestAnimationFrame(sampler);

  // ---- AudioParam calls and graph edges
  let firstCtx = null;
  const paramOwner = new WeakMap();
  const gainDesc = Object.getOwnPropertyDescriptor(GainNode.prototype, "gain");
  if (gainDesc && gainDesc.get) {
    Object.defineProperty(GainNode.prototype, "gain", {
      ...gainDesc,
      get() {
        const p = gainDesc.get.call(this);
        paramOwner.set(p, idOf(this));
        return p;
      },
    });
  }
  for (const call of [
    "setValueAtTime",
    "linearRampToValueAtTime",
    "exponentialRampToValueAtTime",
    "setTargetAtTime",
    "cancelScheduledValues",
    "setValueCurveAtTime",
  ]) {
    const orig = AudioParam.prototype[call];
    AudioParam.prototype[call] = function (...args) {
      pb.params.push([
        epoch(),
        firstCtx ? firstCtx.currentTime : null,
        paramOwner.get(this) ?? null,
        "gain",
        call,
        args[1] ?? args[0],
        typeof args[0] === "number" ? args[0] : null,
      ]);
      return orig.apply(this, args);
    };
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    const origCreate = Ctx.prototype.createMediaElementSource;
    Ctx.prototype.createMediaElementSource = function (el) {
      firstCtx = firstCtx || this;
      const node = origCreate.call(this, el);
      pb.sources.push([idOf(node), mediaId(el)]);
      return node;
    };
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...rest) {
      firstCtx = firstCtx || this.context;
      pb.edges.push([
        idOf(this),
        target instanceof AudioNode
          ? target === this.context.destination
            ? "destination"
            : idOf(target)
          : "param",
      ]);
      if (target === this.context.destination) tapPending(this);
      return origConnect.call(this, target, ...rest);
    };
  }

  // ---- output tap: an AudioWorklet reporting level, high-frequency energy and the file position heard
  const tapCode = `
    class PbTap extends AudioWorkletProcessor {
      constructor() { super(); this.n = 0; this.buf = new Float32Array(4800); this.prev = 0; this.hf = 0; this.sq = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        for (let i = 0; i < ch.length; i++) {
          const x = ch[i]; this.buf[this.n++] = x; this.sq += x * x; const d = x - this.prev; this.hf += d * d; this.prev = x;
          if (this.n === 4800) { this.flush(); }
        }
        return true;
      }
      goertzel(f) {
        const w = 2 * Math.PI * f / sampleRate, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
        for (let i = 0; i < this.n; i++) { const s = this.buf[i] + c * s1 - s2; s2 = s1; s1 = s; }
        return s1 * s1 + s2 * s2 - c * s1 * s2;
      }
      flush() {
        let mk = -1, mv = 0, bk = -1, bv = 0;
        for (let k = 0; k < 32; k++) { const p = this.goertzel(600 + 60 * k); if (p > mv) { mv = p; mk = k; } }
        for (let k = 0; k < 24; k++) { const p = this.goertzel(3000 + 100 * k); if (p > bv) { bv = p; bk = k; } }
        const rms = Math.sqrt(this.sq / this.n);
        this.port.postMessage([currentFrame, sampleRate, rms, this.hf / this.n, rms > 0.004 ? mk : -1, rms > 0.004 ? bk : -1]);
        this.n = 0; this.sq = 0; this.hf = 0;
      }
    }
    registerProcessor("pb-tap", PbTap);`;
  const taps = new Map(); // ctx -> {node?, pending: []}
  const tapFor = (ctx) => {
    let t = taps.get(ctx);
    if (t) return t;
    t = { node: null, pending: [] };
    taps.set(ctx, t);
    const url = URL.createObjectURL(new Blob([tapCode], { type: "application/javascript" }));
    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        t.node = new AudioWorkletNode(ctx, "pb-tap", { numberOfOutputs: 0 });
        t.node.port.onmessage = (e) => pb.tap.push([...e.data, epoch()]);
        for (const n of t.pending) AudioNode.prototype.connect.call(n, t.node);
        t.pending = [];
      })
      .catch((e) => pb.events.push([epoch(), "tap", "error", String(e)]));
    return t;
  };
  function tapPending(node) {
    const t = tapFor(node.context);
    if (t.node) AudioNode.prototype.connect.call(node, t.node);
    else t.pending.push(node);
  }
  function tapElementStream(el) {
    const start = () => {
      if (el.__pbTapped || typeof el.captureStream !== "function") return;
      el.__pbTapped = true;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(el.captureStream());
      const t = tapFor(ctx);
      if (t.node) src.connect(t.node);
      else t.pending.push(src);
    };
    el.addEventListener("playing", start);
  }

  window.__pbDump = () => ({
    kind: pb.kind,
    t0: epoch(),
    events: pb.events,
    frames: pb.frames,
    samples: pb.samples,
    params: pb.params,
    edges: pb.edges,
    sources: pb.sources,
    tap: pb.tap,
    ctxs: pb.ctxs,
    rejects: pb.rejects,
  });
})();
