// Runs inside the perf server's host page in any browser; run.ts sends this function's source over WebDriver.
// Resolves with raw per-frame samples so every browser is scored by the same code in run.ts.
export async function bench(cfg) {
  const now = () => performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  async function until(pred, timeoutMs, what) {
    const end = now() + timeoutMs;
    while (!pred()) {
      if (now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
      await sleep(10);
    }
  }

  await until(() => window.__playerReady || window.__playerError, 60_000, "player ready");
  if (window.__playerError) throw new Error(`player error: ${window.__playerError}`);
  await until(() => window.__playerAssetsReady, 60_000, "player assetsready");
  const host = document.getElementById("player");
  const iframe = host.shadowRoot.querySelector("iframe");
  const win = iframe.contentWindow;
  const runtime = win.__player;
  const videos = () => Array.from(iframe.contentDocument.querySelectorAll("video"));
  const shown = (v) => {
    const s = win.getComputedStyle(v);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
  };
  const decoded = () =>
    videos().reduce(
      (acc, v) => {
        const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        if (q) {
          acc.dropped += q.droppedVideoFrames;
          acc.total += q.totalVideoFrames;
        }
        return acc;
      },
      { dropped: 0, total: 0 },
    );
  const mediaErrors = () =>
    videos()
      .filter((v) => v.error)
      .map((v) =>
        `${v.currentSrc.split("/").pop()}: ${v.error.code} ${v.error.message || ""}`.trim(),
      );

  // The composition's own rAF callbacks (the runtime tick) are timed, so work splits into script and rendering.
  let compositionScriptMs = 0;
  const compositionRaf = win.requestAnimationFrame.bind(win);
  win.requestAnimationFrame = (callback) =>
    compositionRaf((ts) => {
      const start = now();
      try {
        callback(ts);
      } finally {
        compositionScriptMs += now() - start;
      }
    });

  // A message posted from a rAF callback is delivered after that frame's style, layout and paint,
  // so (delivery - callback start) is the frame's main-thread work, runtime tick included.
  function recordFrames(durationMs) {
    const frames = [];
    const channel = new MessageChannel();
    let pending = null;
    channel.port1.onmessage = () => {
      if (pending) {
        pending.work = now() - pending.start;
        pending.script = compositionScriptMs;
      }
      compositionScriptMs = 0;
      pending = null;
    };
    return new Promise((resolve) => {
      const end = now() + durationMs;
      function tick(ts) {
        const frame = { ts, start: now(), work: null, script: null, comp: runtime.getTime() };
        frames.push(frame);
        pending = frame;
        channel.port2.postMessage(0);
        if (now() < end) requestAnimationFrame(tick);
        else setTimeout(() => resolve(frames), 50);
      }
      requestAnimationFrame(tick);
    });
  }

  // What the runtime does to its media during playback; a seek or rate change resets a decoder.
  const mediaOps = { seek: 0, rate: 0, play: 0, pause: 0, load: 0 };
  let countOps = false;
  const rateLog = [];
  const proto = win.HTMLMediaElement.prototype;
  for (const [prop, key] of [
    ["currentTime", "seek"],
    ["playbackRate", "rate"],
  ]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, {
      ...d,
      set(value) {
        if (countOps) mediaOps[key]++;
        if (countOps && key === "rate" && rateLog.length < 40) {
          rateLog.push({ at: Math.round(now()), from: this.playbackRate, to: value });
        }
        d.set.call(this, value);
      },
    });
  }
  for (const method of ["play", "pause", "load"]) {
    const original = proto[method];
    proto[method] = function (...args) {
      if (countOps) mediaOps[method]++;
      return original.apply(this, args);
    };
  }

  const idle = await recordFrames(1000);

  host.play();
  await until(() => runtime.isPlaying(), 5_000, "isPlaying");
  countOps = true;
  const decodedBefore = decoded();
  const droppedTimeline = [];
  const sampler = setInterval(
    () => droppedTimeline.push(decoded().dropped - decodedBefore.dropped),
    500,
  );
  const startTimes = new Map(videos().map((v) => [v, v.currentTime]));
  const play = await recordFrames(cfg.playMs);
  const videoStates = videos().map((v) => ({
    src: v.currentSrc.split("/").pop(),
    readyState: v.readyState,
    networkState: v.networkState,
    paused: v.paused,
    advanced: Math.round((v.currentTime - (startTimes.get(v) ?? 0)) * 100) / 100,
    bufferedEnd: v.buffered.length
      ? Math.round(v.buffered.end(v.buffered.length - 1) * 10) / 10
      : 0,
    shown: shown(v),
  }));
  clearInterval(sampler);
  const decodedAfter = decoded();
  countOps = false;
  host.pause();
  await until(() => !runtime.isPlaying(), 5_000, "pause");

  // Seek to paint: the timeline reports the target, then every shown video has presented
  // a frame for it (requestVideoFrameCallback, or settled after two frames), then one paint.
  const duration = runtime.getDuration();
  const seeks = [];
  for (const fraction of cfg.seekFractions) {
    const target = Math.round(duration * fraction * 30) / 30;
    const presented = new Set();
    for (const v of videos()) {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => presented.add(v));
    }
    const t0 = now();
    host.seek(target);
    let timedOut = false;
    try {
      await until(() => Math.abs(runtime.getTime() - target) < 0.05, 5_000, `time ${target}`);
      await nextFrame();
      await nextFrame();
      await until(
        () =>
          videos()
            .filter((v) => shown(v) && !v.error)
            .every((v) => presented.has(v) || (!v.seeking && v.readyState >= 2)),
        5_000,
        `video frames at ${target}`,
      );
    } catch {
      timedOut = true;
    }
    await nextFrame();
    seeks.push({ target, ms: now() - t0, timedOut });
    await sleep(100);
  }

  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    videoCount: videos().length,
    mediaErrors: mediaErrors(),
    idle: idle.map((f) => f.ts),
    frames: play.map((f) => ({ ts: f.ts, work: f.work, script: f.script, comp: f.comp })),
    decoded: {
      dropped: decodedAfter.dropped - decodedBefore.dropped,
      total: decodedAfter.total - decodedBefore.total,
    },
    droppedTimeline,
    videoStates,
    mediaOps,
    rateLog,
    seeks,
  };
}
