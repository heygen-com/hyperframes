import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { frameSamplerScript, quadOf, scoreTeleport } from "./teleport.mjs";
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
  topDocument.defaultView = topWindow;

  // The frame's document and location throw, as a cross-origin frame's do; only postMessage reaches it.
  function sealedFrame(studioReplies, geometryHeld = null) {
    const channel = new MessageChannel();
    const boxes = {
      "#target": { rect: { x: 100, y: 200, width: 100, height: 50 }, angle: 0, corners: null },
      '[data-composition-id="main"]': {
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
        angle: 0,
        corners: null,
      },
    };
    channel.port1.onmessage = async ({ data: { id, kind, params } }) => {
      if (kind === "geometry" && geometryHeld) await geometryHeld.wait();
      const result =
        kind === "query"
          ? {
              matches: boxes[params.selector] ? [{ handle: params.selector }] : [],
              truncated: false,
            }
          : kind === "geometry"
            ? {
                elements: params.handles.map((h) => ({ ...boxes[h], visible: true })),
                children: null,
              }
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
    return { iframe, on, channel };
  }

  // Runs the page script in a top page whose one preview is `iframe`; ticks stand in for painted frames.
  function samplerFor(iframe, on) {
    let tick = () => {};
    const window = { addEventListener: (type, f) => (on[type] = f) };
    window.top = window;
    const page = {
      window,
      document: {
        querySelectorAll: () => [iframe],
        querySelector: () => null,
        createElement: () => ({ style: {}, isConnected: true }),
        documentElement: { append() {} },
      },
      ResizeObserver: class {
        constructor(f) {
          tick = f;
        }
        observe() {}
      },
      requestAnimationFrame: () => 0,
      performance: { now: () => 0 },
      setTimeout,
      clearTimeout,
      URL,
      DOMMatrix: class {},
    };
    runInNewContext(frameSamplerScript, page);
    return { rec: window.__editBenchFrames, tick: () => tick() };
  }

  it("measures the element through the preview's editing port, in top-frame px", async () => {
    const studioReplies = [];
    const { iframe, on, channel } = sealedFrame(studioReplies);
    const { rec, tick } = samplerFor(iframe, on);
    Object.assign(rec, { on: true, selector: "#target", pointer: [150, 225], samples: [] });
    const measured = async () => {
      for (let i = 0; i < 50 && !rec.samples.some((s) => s.quad); i++) {
        tick();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return rec.samples.find((s) => s.quad);
    };
    try {
      const sample = await measured();
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
      // Studio's own request on the shared port still reaches Studio.
      channel.port2.postMessage({ v: 1, id: 1, kind: "query", params: { selector: "#target" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(studioReplies.map((r) => r.id)).toContain(1);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it("drops a reply for the previous drag's element once the next drag has started", async () => {
    let release = () => {};
    let held = 0;
    const gate = new Promise((resolve) => (release = resolve));
    const geometryHeld = { wait: () => (held++, gate) };
    const { iframe, on, channel } = sealedFrame([], geometryHeld);
    const { rec, tick } = samplerFor(iframe, on);
    Object.assign(rec, {
      on: true,
      selector: "#target",
      pointer: [150, 225],
      samples: [],
      marks: [0],
    });
    try {
      for (let i = 0; i < 50 && held === 0; i++) {
        tick();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(held).toBe(1);
      // The next drag starts while the first one's geometry is still on its way.
      rec.selector = "#other";
      rec.marks.push(rec.samples.length);
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rec.samples.slice(rec.marks[1]).filter((s) => s.quad)).toEqual([]);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it("drops a reply asked before the release once the release is recorded", async () => {
    let release = () => {};
    let held = 0;
    const gate = new Promise((resolve) => (release = resolve));
    const { iframe, on, channel } = sealedFrame([], { wait: () => (held++, gate) });
    const { rec, tick } = samplerFor(iframe, on);
    Object.assign(rec, {
      on: true,
      selector: "#target",
      pointer: [150, 225],
      samples: [],
      marks: [0],
    });
    try {
      for (let i = 0; i < 50 && held === 0; i++) {
        tick();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(held).toBe(1);
      // The release lands while the frame's geometry is still on its way.
      on.pointerup({ isTrusted: true, clientX: 150, clientY: 225, buttons: 0 });
      const upAt = rec.samples.findIndex((s) => s.up);
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(upAt).toBeGreaterThanOrEqual(0);
      expect(rec.samples.slice(upAt + 1).filter((s) => s.quad)).toEqual([]);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});
