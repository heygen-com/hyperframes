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

  // Decoder counters only, no per-frame probe or wrappers: separates the probe's own cost from the player's.
  if (cfg.countersOnly) {
    // Odd-numbered videos ignore the runtime's rate steering, so both halves of one page can be compared.
    const all = videos();
    const unsteerable = new Set(all.filter((_, i) => i % 2 === 1));
    const proto = win.HTMLMediaElement.prototype;
    const rateDescriptor = Object.getOwnPropertyDescriptor(proto, "playbackRate");
    Object.defineProperty(proto, "playbackRate", {
      ...rateDescriptor,
      set(value) {
        if (!unsteerable.has(this)) rateDescriptor.set.call(this, value);
      },
    });
    const frameReads = { videoFrameCallbacks: 0, videoDraws: 0 };
    const videoProto = win.HTMLVideoElement.prototype;
    if (videoProto.requestVideoFrameCallback) {
      const request = videoProto.requestVideoFrameCallback;
      videoProto.requestVideoFrameCallback = function (...args) {
        frameReads.videoFrameCallbacks++;
        return request.apply(this, args);
      };
    }
    for (const Ctx of [
      win.CanvasRenderingContext2D,
      win.WebGLRenderingContext,
      win.WebGL2RenderingContext,
    ]) {
      for (const method of ["drawImage", "texImage2D", "texSubImage2D"]) {
        const original = Ctx?.prototype?.[method];
        if (!original) continue;
        Ctx.prototype[method] = function (...args) {
          if (args.some((a) => a instanceof win.HTMLVideoElement)) frameReads.videoDraws++;
          return original.apply(this, args);
        };
      }
    }
    const lag = () => all.map((v) => runtime.getTime() - v.currentTime);
    // The player's parent-page media proxies: owner, count and state, and an option to empty them first.
    const proxies = () => host._media?._entries ?? [];
    if (cfg.emptyProxies) {
      for (const entry of proxies()) {
        entry.el.removeAttribute("src");
        entry.el.load();
      }
    }
    // Display scale 1 makes the runtime drop its below-1x raster hints (previewRasterHints.ts).
    const rasterMarks = () =>
      iframe.contentDocument.querySelectorAll("[data-hf-preview-raster]").length;
    const marksBefore = rasterMarks();
    if (cfg.fullRaster) {
      win.postMessage(
        { source: "hf-parent", type: "control", action: "set-display-scale", scale: 1 },
        "*",
      );
      await sleep(300);
    }
    const marksAtPlay = rasterMarks();
    // Animations still running in the player's own UI at play time, e.g. a loader overlay left mid-hide.
    const loader = host.shadowRoot.querySelector(".hfp-shader-loader");
    const uiState = {
      runningAnimations: host.shadowRoot.getAnimations().filter((a) => a.playState === "running")
        .length,
      loaderVisible: loader?.classList.contains("hfp-visible") === true,
      loaderHiding: loader?.classList.contains("hfp-hiding") === true,
    };
    if (cfg.removeLoader) loader?.remove();
    const hostOps = { play: 0, seek: 0 };
    const hostProto = window.HTMLMediaElement.prototype;
    const hostPlay = hostProto.play;
    hostProto.play = function (...args) {
      hostOps.play++;
      return hostPlay.apply(this, args);
    };
    const hostTime = Object.getOwnPropertyDescriptor(hostProto, "currentTime");
    Object.defineProperty(hostProto, "currentTime", {
      ...hostTime,
      set(value) {
        hostOps.seek++;
        hostTime.set.call(this, value);
      },
    });
    host.play();
    await until(() => runtime.isPlaying(), 5_000, "isPlaying");
    const before = decoded();
    const quality = (v) => v.getVideoPlaybackQuality();
    const startQuality = new Map(videos().map((v) => [v, quality(v)]));
    const steeredTicks = new Map(videos().map((v) => [v, 0]));
    let ticks = 0;
    const rateSampler = setInterval(() => {
      ticks++;
      for (const v of videos())
        if (Math.abs(v.playbackRate - 1) > 1e-6) steeredTicks.set(v, steeredTicks.get(v) + 1);
    }, 100);
    await sleep(1000);
    const lagEarly = lag();
    const proxyState = {
      owner: host._media?._audioOwner === "parent" ? 1 : 0,
      count: proxies().length,
      playing: proxies().filter((e) => !e.el.paused).length,
    };
    await sleep(cfg.playMs - 1000);
    const lagLate = lag();
    clearInterval(rateSampler);
    const after = decoded();
    host.pause();
    return {
      countersOnly: true,
      videoCount: videos().length,
      decoded: { dropped: after.dropped - before.dropped, total: after.total - before.total },
      frameReads,
      proxyState,
      rasterMarks: { before: marksBefore, atPlay: marksAtPlay },
      uiState,
      hostOps,
      perVideo: all.map((v, i) => {
        const a = startQuality.get(v);
        const b = quality(v);
        return {
          dropped: b.droppedVideoFrames - a.droppedVideoFrames,
          total: b.totalVideoFrames - a.totalVideoFrames,
          steeredFraction: ticks ? steeredTicks.get(v) / ticks : 0,
          rateBlocked: unsteerable.has(v),
          lagEarly: lagEarly[i],
          lagLate: lagLate[i],
        };
      }),
    };
  }

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
  const mediaReads = {};
  for (const prop of [
    "currentTime",
    "buffered",
    "played",
    "seekable",
    "readyState",
    "paused",
    "duration",
    "seeking",
    "ended",
    "volume",
    "muted",
    "playbackRate",
    "networkState",
    "error",
  ]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, {
      ...d,
      get() {
        if (countOps) mediaReads[prop] = (mediaReads[prop] ?? 0) + 1;
        return d.get.call(this);
      },
    });
  }
  let audioCaptures = 0;
  const AudioCtx = win.AudioContext || win.webkitAudioContext;
  if (AudioCtx) {
    const capture = AudioCtx.prototype.createMediaElementSource;
    AudioCtx.prototype.createMediaElementSource = function (el) {
      audioCaptures++;
      return capture.call(this, el);
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
    mediaReads,
    audioCaptures,
    rateLog,
    seeks,
  };
}
