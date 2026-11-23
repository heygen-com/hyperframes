import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { frameSamplerScript, quadOf, scoreTeleport, startFrames } from "./teleport.mjs";
import { entry, score } from "./report.mjs";

// The composition root drawn 1:1 at the origin, and a 100 px box whose centre the pointer holds.
const root = [
  [0, 0],
  [1920, 0],
  [1920, 1080],
  [0, 1080],
];
const box = (x, y = 0) => [
  [x, y],
  [x + 100, y],
  [x + 100, y + 100],
  [x, y + 100],
];
/** The pointer at `px`, the box drawn at `bx` (default: under the pointer). */
const frame = (px, down, bx = px, by = 0) => ({
  t: px,
  pointer: [px + 50, 50],
  down,
  root,
  quad: box(bx, by),
  size: [100, 100],
  clip: "none",
});
const steps = (n, size) => Array.from({ length: n }, (_, i) => (i + 1) * size);
const drag = [
  frame(0, false),
  frame(0, true),
  ...steps(5, 10).map((x) => frame(x, true)),
  frame(50, false),
];

describe("scoreTeleport", () => {
  const waitingDrag = drag.map((f) => ({ ...f, quad: box(0), waitingQuad: f.quad }));
  it("tracks the waiting outline until the element catches up after release", () => {
    expect(scoreTeleport("move", [...waitingDrag, frame(50, false)])).toMatchObject({
      max: 0,
      pass: true,
    });
  });
  it("rejects a jumping outline while the element waits", () => {
    const jumped = waitingDrag.map((f, i) => (i === 4 ? { ...f, waitingQuad: box(f.t + 37) } : f));
    expect(scoreTeleport("move", [...jumped, frame(50, false)]).pass).toBe(false);
  });
  it("rejects an element that lands away from the outline after waiting", () => {
    expect(scoreTeleport("move", [...waitingDrag, frame(50, false, 55)]).pass).toBe(false);
  });
  it("passes a box that follows the pointer every frame", () => {
    expect(scoreTeleport("move", drag)).toMatchObject({ max: 0, pass: true });
  });

  it("passes a box drawn one frame late", () => {
    const late = drag.map((f, i) => (i > 1 ? frame(f.t, f.down, drag[i - 1].t) : f));
    expect(scoreTeleport("move", [...late, frame(50, false)]).pass).toBe(true);
  });

  it("passes a box that holds two frames, then catches up in one", () => {
    const caught = drag.map((f, i) => (i === 3 ? frame(f.t, true, drag[2].t) : f));
    expect(scoreTeleport("move", caught)).toMatchObject({ max: 0, pass: true });
  });

  it("still catches a one-frame 37 px jump while the pointer moves 10 px a frame", () => {
    const jumped = drag.map((f, i) => (i === 4 ? frame(f.t, true, f.t + 37) : f));
    expect(scoreTeleport("move", jumped)).toMatchObject({ pass: false, frame: 4 });
  });

  // The pointer-up as the sampler records it, the moment it happens: frame(px) puts the pointer at px + 50.
  const upAt = (t, px) => ({ t, up: [px + 50, 50] });
  // The next element's selection click: its press painted before any frame showed this drag's pointer-up.
  const clickElsewhere = (bx) => [
    upAt(50.5, 50),
    frame(240, true, bx),
    upAt(240.5, 240),
    frame(260, false, bx),
  ];
  const held = drag.slice(0, -1);

  it("ends a drag at its pointer-up, so the pointer travelling on to the next element fails nothing", () => {
    expect(scoreTeleport("move", [...held, ...clickElsewhere(50)])).toMatchObject({
      max: 0,
      pass: true,
    });
  });

  it("still catches the box jumping after that pointer-up", () => {
    const r = scoreTeleport("move", [
      ...held,
      ...clickElsewhere(50).slice(0, 2),
      frame(260, false, 150),
    ]);
    expect(r).toMatchObject({ pass: false, max: 100 });
  });

  it("ends the drag at a pointer-up even when no frame painted while the button was held", () => {
    const unseen = (bx) => [
      frame(0, false),
      upAt(1, 50),
      frame(120, false, bx),
      frame(200, false, bx),
    ];
    expect(scoreTeleport("move", unseen(50)).pass).toBe(true);
    expect(scoreTeleport("move", unseen(0))).toMatchObject({ pass: false, max: 50 });
  });

  it("fails a box that keeps following the pointer after release", () => {
    const after = [60, 70, 80].map((x) => frame(x, false));
    const r = scoreTeleport("move", [...held, upAt(50.5, 50), ...after]);
    expect(r).toMatchObject({ kind: "off", pass: false, max: 30 });
  });

  it("catches a mid-drag snap back to where the drag started, on the pointer's own path", () => {
    const snapped = drag.map((f, i) => (i === 4 ? frame(30, true, 0) : f));
    const r = scoreTeleport("move", snapped);
    expect(r).toMatchObject({ kind: "jump", pass: false });
    expect(r.trace[4].points[0]).toMatchObject({ jump: 10, off: 0 });
  });

  it("catches a box that leaves the path at the pointer's speed", () => {
    const drifting = drag.slice(0, -1).map((f, i) => (i > 1 ? frame(f.t, true, 10, f.t - 10) : f));
    expect(scoreTeleport("move", drifting)).toMatchObject({ kind: "off", pass: false });
  });

  it("holds the box at the release point, not anywhere the drag passed", () => {
    // 0.4 px steps keep every frame under the jump limit; after release the box creeps back along the path.
    const held = steps(25, 0.4).map((x) => frame(x, true));
    const back = steps(25, 0.4).map((d) => frame(10, false, 10 - d));
    const r = scoreTeleport("move", [frame(0, false), frame(0, true), ...held, ...back]);
    expect(r).toMatchObject({ kind: "off", pass: false });
  });

  it("holds the element still during a crop while the outline follows", () => {
    const outline = (x) => [
      [0, 0],
      [x + 100, 0],
      [x + 100, 100],
      [0, 100],
    ];
    const crop = (x, down, shift = 0) => ({
      ...frame(0, down, shift),
      pointer: [x + 100, 50],
      outline: outline(x),
    });
    const frames = [crop(0, false), crop(0, true), crop(10, true), crop(20, true), crop(20, false)];
    expect(scoreTeleport("crop", frames).pass).toBe(true);
    expect(
      scoreTeleport(
        "crop",
        frames.map((f, i) => (i === 3 ? crop(20, true, 5) : f)),
      ).max,
    ).toBe(5);
  });

  it("fails a drag whose frames could not be measured", () => {
    const teleport = scoreTeleport("move", [{ t: 0, pointer: null, down: true }]);
    const r = {
      tracking: { max: 0 },
      pressJump: 0,
      teleport,
      drop: 0,
      reload: 0,
      render: 0,
      undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0 },
      undoTimeout: null,
      smooth: { intervals: [16], work: [2], control: { intervals: [16], work: [2] } },
      unsettled: [],
    };
    expect(score({}, r).checks.teleport).toBe(false);
    // baseline.json holds the verdict under `teleport` and the number apart, so the key never means a size.
    expect(entry(score({ id: "move-x" }, r))).toMatchObject({ teleport: false, teleportPx: null });
  });
});

describe("quadOf", () => {
  // A top-level element 120.375 px wide: offsetWidth rounds to 120, so the edge must come from computed style.
  const element = (style) => {
    const view = { getComputedStyle: (n) => n.style };
    view.top = view;
    return {
      ownerDocument: { defaultView: view },
      parentElement: null,
      getRootNode: () => ({}),
      offsetWidth: 120,
      offsetHeight: 80,
      getBoundingClientRect: () => ({ left: 100, top: 0, width: 120.375, height: 80 }),
      style: { transform: "none", rotate: "none", scale: "none", ...style },
    };
  };

  it("puts the right edge at the fractional width", () => {
    const quad = quadOf(element({ boxSizing: "border-box", width: "120.375px", height: "80px" }));
    expect(quad[1][0]).toBeCloseTo(220.375, 6);
  });

  it("adds padding and border to a content-box size", () => {
    const style = { boxSizing: "content-box", width: "100.375px", height: "60px" };
    const sides = {
      paddingLeft: "8px",
      paddingRight: "8px",
      borderLeftWidth: "2px",
      borderRightWidth: "2px",
    };
    const quad = quadOf(
      element({
        ...style,
        ...sides,
        paddingTop: "9px",
        paddingBottom: "9px",
        borderTopWidth: "1px",
        borderBottomWidth: "1px",
      }),
    );
    expect(quad[1][0]).toBeCloseTo(220.375, 6);
    expect(quad[2][1]).toBeCloseTo(80, 6);
  });
});

describe("frameSamplerScript", () => {
  it("counts the pointer as down only while its button is held, and records each release as it happens", () => {
    const on = {};
    const window = { addEventListener: (type, f) => (on[type] = f) };
    window.top = window;
    const page = {
      window,
      document: { createElement: () => ({ style: {} }) },
      ResizeObserver: class {
        observe() {}
      },
      requestAnimationFrame: () => 0,
      performance: { now: () => 0 },
    };
    runInNewContext(frameSamplerScript, page);
    const rec = window.__editBenchFrames;
    rec.on = true;
    on.pointerdown({ clientX: 1, clientY: 1, buttons: 1, isTrusted: true });
    on.pointermove({ clientX: 2, clientY: 1, buttons: 1, isTrusted: true });
    expect(rec).toMatchObject({ down: true });
    on.pointerup({ clientX: 2, clientY: 1, buttons: 0, isTrusted: true });
    on.pointermove({ clientX: 90, clientY: 1, buttons: 0, isTrusted: true });
    expect(rec).toMatchObject({ down: false, pointer: [90, 1] });
    expect(rec.samples.map((x) => x.up)).toEqual([[2, 1]]);
    on.pointermove({ clientX: 5, clientY: 5, buttons: 0, isTrusted: false });
    expect(rec, "the bench's own stray move is not the pointer").toMatchObject({
      pointer: [90, 1],
    });
  });

  it("runs beside a page script that declares the same names, and leaves them alone", () => {
    const page = { window: {} };
    page.window.top = {};
    runInNewContext("const linear = 1; let quadOf = 2;", page);
    expect(() => runInNewContext(frameSamplerScript, page)).not.toThrow();
    expect(runInNewContext("[linear, quadOf]", page)).toEqual([1, 2]);
  });
});

describe("frameSamplerScript in a sealed preview", () => {
  const style = {
    transform: "none",
    rotate: "none",
    scale: "none",
    width: "1920px",
    height: "1080px",
    boxSizing: "content-box",
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
  };
  const topDocument = { querySelector: () => null };
  const topWindow = { getComputedStyle: () => style };
  topWindow.top = topWindow;
  topDocument.defaultView = topWindow;

  const BOXES = {
    "#target": { rect: { x: 100, y: 200, width: 100, height: 50 }, angle: 0, corners: null },
    '[data-composition-id="main"]': {
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      angle: 0,
      corners: null,
    },
  };
  const geometry = (handle, x = 0) => {
    const { rect, ...rest } = BOXES[handle];
    return {
      ...rest,
      rect: { ...rect, x: rect.x + x },
      source: null,
      clipPath: null,
      visible: true,
      members: null,
    };
  };

  // The frame's document and location throw, as a cross-origin frame's do; only postMessage reaches it.
  function sealedFrame(studioReplies, watchHeld = null) {
    const channel = new MessageChannel();
    const asked = [];
    channel.port1.onmessage = async ({ data: { id, kind, params } }) => {
      asked.push({ kind, params });
      if (kind === "watch-geometry" && watchHeld) await watchHeld;
      const result =
        kind === "query"
          ? {
              matches: BOXES[params.selector] ? [{ handle: params.selector }] : [],
              truncated: false,
            }
          : kind === "watch-geometry"
            ? { watching: params.handles.length }
            : kind === "computed-styles"
              ? { styles: { width: "100px", height: "50px", "box-sizing": "border-box" } }
              : null;
      channel.port1.postMessage({ v: 1, id, ok: true, result });
    };
    const win = {
      get document() {
        throw new Error("cross-origin");
      },
      get location() {
        throw new Error("cross-origin");
      },
      postMessage(message) {
        if (message.type !== "editing-connect") return;
        // Studio already holds the port when the bench's handoff arrives: both listen on it.
        channel.port2.onmessage = ({ data }) => studioReplies.push(data);
        queueMicrotask(() =>
          on.message({
            source: win,
            data: { source: "hf-preview", type: "editing-port", v: 1 },
            ports: [channel.port2],
          }),
        );
      },
    };
    const on = {};
    const iframe = {
      src: "http://studio.test/preview/index.html",
      contentWindow: win,
      ownerDocument: topDocument,
      clientLeft: 0,
      clientTop: 0,
      parentElement: null,
      getRootNode: () => ({}),
      checkVisibility: () => true,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    };
    // A push as the frame sends one each time it paints, stamped `at` on the shared clock.
    const push = (at, x = 0) =>
      channel.port1.postMessage({
        v: 1,
        event: "geometry",
        at,
        elements: [geometry("#target", x), geometry('[data-composition-id="main"]')],
      });
    const close = () => (channel.port1.close(), channel.port2.close());
    return { iframe, on, asked, push, close, channel };
  }

  // Runs the page script in a top page whose previews are `iframe`; ticks stand in for painted frames.
  function samplerFor(iframe, on) {
    let tick = () => {};
    const clock = { now: 0 };
    const studio = { waiting: null };
    const frames = [];
    const window = { addEventListener: (type, f) => (on[type] = f) };
    window.top = window;
    const page = {
      window,
      document: {
        querySelectorAll: () => [].concat(iframe),
        querySelector: (selector) => (selector.includes("press-waiting") ? studio.waiting : null),
        createElement: () => ({ style: {}, isConnected: true }),
        documentElement: { append() {} },
      },
      ResizeObserver: class {
        constructor(f) {
          tick = f;
        }
        observe() {}
      },
      requestAnimationFrame: (f) => frames.push(f),
      performance: { timeOrigin: 1_000, now: () => clock.now },
      setTimeout,
      clearTimeout,
      URL,
      DOMMatrix: class {},
    };
    runInNewContext(frameSamplerScript, page);
    const rec = window.__editBenchFrames;
    Object.assign(rec, { on: true, selector: "#target", samples: [], marks: [0], history: [] });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    // Ticks until the frame is asked to watch, so its pushes have somewhere to land.
    const watching = async (asked) => {
      for (let i = 0; i < 50 && !asked.some((a) => a.kind === "watch-geometry"); i++) {
        tick();
        await settle();
      }
      for (let i = 0; i < 5; i++) {
        tick();
        await settle();
      }
    };
    const move = (x, buttons = 1) =>
      on.pointermove({ isTrusted: true, clientX: x, clientY: 225, buttons });
    const frame = () => frames.splice(0).forEach((f) => f());
    const pageApi = {
      evaluate: (f, arg) => runInNewContext(`(${f})(${JSON.stringify(arg)})`, page),
    };
    return { rec, tick, clock, settle, watching, move, studio, frame, pageApi };
  }

  it("measures the element from the preview's pushes, in top-frame px, and Studio keeps the shared port", async () => {
    const studioReplies = [];
    const { iframe, on, asked, push, close, channel } = sealedFrame(studioReplies);
    const { rec, tick, settle, watching, move } = samplerFor(iframe, on);
    try {
      move(150);
      await watching(asked);
      expect(asked.find((a) => a.kind === "watch-geometry").params.handles).toEqual([
        "#target",
        '[data-composition-id="main"]',
      ]);
      push(1_000);
      await settle();
      tick();
      const sample = rec.samples.find((s) => s.quad);
      expect(sample, JSON.stringify(rec.samples.slice(-2))).toBeDefined();
      expect(sample.quad).toEqual([
        [100, 200],
        [200, 200],
        [200, 250],
        [100, 250],
      ]);
      expect(sample.size).toEqual([100, 50]);
      expect(sample.root[2]).toEqual([1920, 1080]);
      expect(sample.pointer).toEqual([150, 225]);
      channel.port2.postMessage({ v: 1, id: 1, kind: "query", params: { selector: "#target" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(studioReplies.map((r) => r.id)).toContain(1);
    } finally {
      close();
    }
  });

  it("pairs each push with the pointer at its own stamp, not where the pointer is when it lands", async () => {
    const { iframe, on, asked, push, close } = sealedFrame([]);
    const { rec, tick, clock, settle, watching, move } = samplerFor(iframe, on);
    try {
      await watching(asked);
      clock.now = 10;
      move(150);
      clock.now = 20;
      move(160);
      clock.now = 30;
      move(170);
      // Painted at 15 and 25, both landing after the pointer reached 170.
      push(1_015);
      push(1_025, 10);
      await settle();
      tick();
      const measured = rec.samples.filter((s) => s.quad);
      expect(measured.map((s) => [s.t, s.pointer[0], s.quad[0][0]])).toEqual([
        [15, 150, 100],
        [25, 160, 110],
      ]);
    } finally {
      close();
    }
  });

  it("leaves out a push painted before this drag started", async () => {
    const { iframe, on, asked, push, close } = sealedFrame([]);
    const { rec, tick, settle, watching, move } = samplerFor(iframe, on);
    try {
      move(150);
      await watching(asked);
      rec.since = 1_050;
      push(1_040);
      push(1_060);
      await settle();
      tick();
      expect(rec.samples.filter((s) => s.quad).map((s) => s.t)).toEqual([60]);
    } finally {
      close();
    }
  });

  it("starts recording only once a frame has measured the element, so a drag's first sample is before the press", async () => {
    const { iframe, on, asked, push, close } = sealedFrame([]);
    const { rec, tick, settle, watching, move, frame, pageApi } = samplerFor(iframe, on);
    try {
      move(150);
      let ready = false;
      void startFrames(pageApi, "#target").then(() => (ready = true));
      await watching(asked);
      frame();
      await settle();
      expect(ready).toBe(false);
      push(1_010);
      await settle();
      tick();
      frame();
      await settle();
      expect([ready, rec.samples.filter((s) => s.quad).length]).toEqual([true, 1]);
    } finally {
      close();
    }
  });

  it("drops pushes that land before the frame confirms the new watch, and pushes with a box that is not finite", async () => {
    let confirm = () => {};
    const held = new Promise((resolve) => (confirm = resolve));
    const { iframe, on, asked, push, close } = sealedFrame([], held);
    const { rec, tick, settle, move } = samplerFor(iframe, on);
    try {
      move(150);
      for (let i = 0; i < 50 && !asked.some((a) => a.kind === "watch-geometry"); i++) {
        tick();
        await settle();
      }
      push(1_010);
      await settle();
      confirm();
      await settle();
      push(1_020, Number.NaN);
      push(1_030);
      await settle();
      tick();
      expect(rec.samples.filter((s) => s.quad).map((s) => s.t)).toEqual([30]);
    } finally {
      close();
    }
  });

  it("takes a newly shown preview's pushes only from the moment it is the one on screen", async () => {
    const first = sealedFrame([]);
    const second = sealedFrame([]);
    let shownFrame = first.iframe;
    for (const x of [first, second]) x.iframe.checkVisibility = () => x.iframe === shownFrame;
    const { rec, tick, clock, settle, move } = samplerFor([first.iframe, second.iframe], first.on);
    Object.assign(second.on, first.on);
    try {
      move(150);
      for (
        let i = 0;
        i < 50 && ![first, second].every((x) => x.asked.some((a) => a.kind === "watch-geometry"));
        i++
      ) {
        tick();
        await settle();
      }
      clock.now = 100;
      // Studio swaps previews: the second, hidden until now, painted at 90 while the first was on screen.
      second.push(1_090, 50);
      shownFrame = second.iframe;
      await settle();
      tick();
      second.push(1_110);
      await settle();
      tick();
      expect(rec.samples.filter((s) => s.quad).map((s) => s.t)).toEqual([110]);
    } finally {
      first.close();
      second.close();
    }
  });

  it("pairs each push with the outline Studio showed at its stamp, not when the push lands", async () => {
    const { iframe, on, asked, push, close } = sealedFrame([]);
    const { rec, tick, clock, settle, watching, move, studio } = samplerFor(iframe, on);
    const outline = {
      ownerDocument: topDocument,
      parentElement: null,
      getRootNode: () => ({}),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    };
    try {
      move(150);
      await watching(asked);
      clock.now = 10;
      tick();
      // Painted at 15, before Studio showed its waiting outline at 20; it lands after.
      push(1_015);
      clock.now = 20;
      studio.waiting = outline;
      await settle();
      tick();
      push(1_025);
      clock.now = 30;
      await settle();
      tick();
      const measured = rec.samples.filter((s) => s.quad);
      expect(measured.map((s) => [s.t, Boolean(s.waitingQuad)])).toEqual([
        [15, false],
        [25, true],
      ]);
    } finally {
      close();
    }
  });

  it("stops every watch when recording stops", async () => {
    const { iframe, on, asked, close } = sealedFrame([]);
    const { rec, settle, watching } = samplerFor(iframe, on);
    try {
      await watching(asked);
      rec.unwatch();
      await settle();
      expect(asked.at(-1)).toEqual({ kind: "watch-geometry", params: { handles: [] } });
    } finally {
      close();
    }
  });

  it("leaves a frame unmeasured while a larger shown preview cannot answer yet", async () => {
    const { iframe, on, asked, push, close } = sealedFrame([]);
    // Studio's next preview, shown and larger, before its page has handed out a port.
    const next = {
      ...iframe,
      contentWindow: { postMessage() {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 2400, height: 1350 }),
    };
    const { rec, tick, settle, watching, move } = samplerFor([iframe, next], on);
    try {
      move(150);
      await watching(asked);
      push(1_000);
      await settle();
      tick();
      expect(rec.samples.filter((s) => s.quad)).toEqual([]);
    } finally {
      close();
    }
  });
});
