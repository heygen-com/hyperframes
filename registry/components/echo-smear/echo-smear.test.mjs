import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { Window } from "happy-dom";

const html = await readFile(new URL("./echo-smear.html", import.meta.url), "utf8");
const library = html.match(/<script>([\s\S]*?)<\/script>/i)[1];

// The snippet only touches window, document and gsap inside attachEchoSmear; the pure seams
// (count, lerpTrack, measurePoint) are reachable without a page.
function load() {
  const window = {};
  vm.runInNewContext(library, { window, document: {}, gsap: {}, Element: class {}, console });
  return window.__echoSmear;
}

const defaults = { threshold: 40, length: 100, countMult: 1, maxEchoes: 60, edgeSpacing: 1.5 };
const exact = { ...defaults, edgeSpacing: 0 };

test("count is zero below the half-frame threshold and rounds above it", () => {
  const { count } = load();
  assert.equal(count(19.9, 0, exact), 0);
  assert.equal(count(20.5, 0, exact), 21);
});

test("count scales with smear length", () => {
  const { count } = load();
  assert.equal(count(30, 0, { ...exact, length: 50 }), 15);
});

test("count is raised until the edge moves at most edgeSpacing per copy, then capped", () => {
  const { count } = load();
  assert.equal(count(30, 300, { ...defaults, maxEchoes: 400 }), 200);
  assert.equal(count(30, 300, defaults), 60);
});

test("the edge raise never turns a smear on by itself", () => {
  const { count } = load();
  assert.equal(count(10, 300, defaults), 0);
});

test("parseMatrix reads a 2D matrix, treats none as identity, and refuses matrix3d", () => {
  const { parseMatrix } = load();
  assert.deepEqual(Array.from(parseMatrix("matrix(1, 0, 0, 1, 10, 20)")), [1, 0, 0, 1, 10, 20]); // Array.from: the vm context has its own Array
  assert.deepEqual(Array.from(parseMatrix("none")), [1, 0, 0, 1, 0, 0]);
  assert.equal(parseMatrix("matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,0,1)"), null);
});

test("boxPoint maps a box fraction through the matrix about the transform origin", () => {
  const { boxPoint } = load();
  // rotate(90deg) is matrix(0, 1, -1, 0, 0, 0). Box 40x20, origin at its centre, point (0, 0.5) = (0, 10).
  const [x, y] = boxPoint([0, 1, -1, 0, 0, 0], [40, 20], [20, 10], 0, 0.5);
  assert.ok(Math.abs(x - 20) < 1e-9, `x ${x}`);
  assert.ok(Math.abs(y + 10) < 1e-9, `y ${y}`);
  // The matrix's own translation is added after the turn.
  const [tx, ty] = boxPoint([1, 0, 0, 1, 30, 5], [40, 20], [20, 10], 0.5, 0.5);
  assert.ok(Math.abs(tx - 50) < 1e-9 && Math.abs(ty - 15) < 1e-9, `${tx},${ty}`);
});

test("individualMatrix composes translate, rotate and scale in that order", () => {
  const { individualMatrix } = load();
  assert.deepEqual(Array.from(individualMatrix("600px 0px", "none", "none")), [1, 0, 0, 1, 600, 0]);
  assert.deepEqual(Array.from(individualMatrix("none", "none", "2")), [2, 0, 0, 2, 0, 0]);
  const [a, b, c, d] = individualMatrix("none", "90deg", "none");
  assert.ok(
    Math.abs(a) < 1e-9 && Math.abs(b - 1) < 1e-9 && Math.abs(c + 1) < 1e-9 && Math.abs(d) < 1e-9,
  );
  // Percentages resolve against the element's own box: x against its width, y against its height.
  assert.deepEqual(
    Array.from(individualMatrix("150% 50%", "none", "none", [200, 80])),
    [1, 0, 0, 1, 300, 40],
  );
  assert.deepEqual(
    Array.from(individualMatrix("50%", "none", "none", [200, 80])),
    [1, 0, 0, 1, 100, 0],
  );
  assert.deepEqual(
    Array.from(individualMatrix("none", "none", "150%", [200, 80])),
    [1.5, 0, 0, 1.5, 0, 0],
  );
  // translate applies outermost: a scaled element still moves its full translate.
  assert.deepEqual(Array.from(individualMatrix("10px 0px", "none", "2")), [2, 0, 0, 2, 10, 0]);
});

test("boxPoint scales about the origin, so a scaled element's corner moves", () => {
  const { boxPoint } = load();
  const [x, y] = boxPoint([2, 0, 0, 2, 0, 0], [40, 20], [0, 0], 1, 1);
  assert.ok(Math.abs(x - 80) < 1e-9 && Math.abs(y - 40) < 1e-9, `${x},${y}`);
});

test("lerpTrack interpolates opacity and clamps before the start", () => {
  const { lerpTrack } = load();
  const track = [
    [0, 0, 0, 1, 1, 0],
    [0, 0, 0, 1, 1, 1],
  ];
  assert.equal(lerpTrack(track, 1, 0.5, [])[5], 0.5);
  assert.equal(lerpTrack(track, 1, -3, [])[5], 0);
});

// Fixes after the final review: mutation-resistant seam cases.
test("count rounds the half-frame travel to the nearest copy, and the edge raise rounds up", () => {
  const { count } = load();
  assert.equal(count(20.4, 0, exact), 20);
  assert.equal(count(20.6, 0, exact), 21);
  assert.equal(count(30, 300.3, { ...defaults, maxEchoes: 400 }), 201);
});

test("count needs travel strictly above half the threshold", () => {
  const { count } = load();
  assert.equal(count(20, 0, exact), 0);
});

test("lerpTrack clamps after the end of the record", () => {
  const { lerpTrack } = load();
  const track = [
    [0, 0, 0, 1, 1, 0],
    [0, 0, 0, 1, 1, 1],
  ];
  assert.equal(lerpTrack(track, 1, 5, [])[5], 1);
});

// A page: happy-dom for the tree and a fake timeline, so the snippet's own logic (the recording sweep, the
// copy poses, visibility, selection) runs without a browser. The fake timeline writes each driven element's
// transform and opacity as inline style on every time change, as GSAP would, then fires the proxy tween's
// onUpdate and any user callbacks unless events are suppressed.
function matrixCss(p) {
  if (p.css) return p.css;
  const sx = p.scaleX ?? 1;
  const sy = p.scaleY ?? 1;
  const r = ((p.rotation ?? 0) * Math.PI) / 180;
  return `matrix(${sx * Math.cos(r)}, ${sx * Math.sin(r)}, ${-sy * Math.sin(r)}, ${sy * Math.cos(r)}, ${p.x ?? 0}, ${p.y ?? 0})`;
}

// happy-dom does not implement the individual `translate` property: serve what the drive set.
const withTranslate = (cs, el) =>
  new Proxy(cs, {
    get(target, key) {
      if (key === "translate") return el.__translate ?? "none";
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

function page(poseOf) {
  const win = new Window({ url: "http://localhost/" });
  const warnings = [];
  const counts = { user: 0 };
  const updates = [];
  const tl = {
    t: 0,
    userCallback: null,
    time(v, suppress) {
      if (v === undefined) return this.t;
      // GSAP renders its children in reverse order on a backward seek, and the snippet's own update tween
      // was added last: it runs BEFORE the target has rendered the destination time. Simulated here, so a
      // callback that reads the target's live state sees what it was at the time we came from.
      const backward = v < this.t;
      this.t = v;
      const drive = () => {
        for (const [el, fn] of poseOf) {
          const p = fn(v);
          el.style.transform = matrixCss(p);
          if (p.opacity !== undefined) el.style.opacity = String(p.opacity);
          if (p.filter !== undefined) el.style.filter = p.filter;
          if (p.visibility !== undefined) el.style.visibility = p.visibility;
          if (p.translate !== undefined) el.__translate = p.translate; // happy-dom has no `translate` property
          if (p.off) el.__off = p.off;
        }
      };
      const fire = () => {
        updates.forEach((u) => u());
        if (this.userCallback) this.userCallback();
      };
      if (backward && !suppress) {
        fire();
        drive();
      } else {
        drive();
        if (!suppress) fire();
      }
      return this;
    },
    seek(v, suppress) {
      return this.time(v, suppress);
    },
    duration() {
      return 1;
    },
    to(_t, vars) {
      updates.push(vars.onUpdate);
    },
  };
  const con = { warn: (m) => warnings.push(String(m)), log() {}, error() {} };
  vm.runInNewContext(library, {
    window: win,
    document: win.document,
    Element: win.Element,
    getComputedStyle: (e) => withTranslate(win.getComputedStyle(e), e),
    // The snippet must not observe resizes: a callback's first run depends on the first frame drawn.
    ResizeObserver: class {
      constructor() {
        throw new Error("echo-smear must not construct a ResizeObserver");
      }
    },
    console: con,
  });
  return { win, tl, counts, warnings, attach: win.attachEchoSmear };
}

const ROOT = (inner) => `<div id="root" data-composition-id="c" data-fps="30">${inner}</div>`;
const ABS = 'style="position:absolute;width:40px;height:20px"';
function setup(html, drives) {
  const poseOf = new Map();
  const pg = page(poseOf);
  pg.win.document.body.innerHTML = html;
  for (const [id, fn] of Object.entries(drives)) {
    const el = pg.win.document.getElementById(id);
    poseOf.set(el, fn);
    // happy-dom has no layout: the offset box is whatever the drive last said (default 40x20 at 0,0).
    for (const [prop, key] of [
      ["offsetLeft", "l"],
      ["offsetTop", "t"],
      ["offsetWidth", "w"],
      ["offsetHeight", "h"],
    ]) {
      Object.defineProperty(el, prop, {
        get: () => (el.__off || { l: 0, t: 0, w: 40, h: 20 })[key],
      });
    }
  }
  return { pg, doc: pg.win.document };
}
const shownCopies = (doc) =>
  [...doc.querySelectorAll(".es-clone")].filter((c) => c.style.visibility !== "hidden");
const translateX = (c) => Number(/matrix\(([^)]+)\)/.exec(c.style.transform)[1].split(",")[4]);
const RUN = { x: 600 }; // 600 px/s: a fast mover at 30 fps

test("copies use visibility inherit, so a hidden scene hides them too", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0, "a fast mover has copies");
  assert.ok(
    shown.every((c) => c.style.visibility === "inherit"),
    "no copy forces visibility: visible",
  );
});

test("copy i shows the pose from i copy-intervals earlier", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  // 600 px/s over a half frame (1/60 s) = 10 px, so n = 10 copies spaced fd/10 apart.
  assert.equal(shown.length, 10);
  const xs = shown.map(translateX).sort((p, q) => q - p);
  assert.ok(Math.abs(xs[0] - 600 * (0.5 - 1 / 300)) < 0.5, `nearest copy ${xs[0]}`);
  assert.ok(Math.abs(xs[9] - 600 * (0.5 - 10 / 300)) < 0.5, `farthest copy ${xs[9]}`);
});

test("an element already attached is not attached again, and copies lose timing attributes", () => {
  const { pg, doc } = setup(
    ROOT(`<div class="card" id="a" ${ABS} data-start="0" data-duration="1"></div>`),
    { a: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach(".card", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 20 });
  pg.attach(".card", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 20 });
  // The peak count over the timeline is 10 (600 px/s, threshold 10), so 10 copies are built, not maxEchoes.
  assert.equal(
    doc.querySelectorAll(".es-clone").length,
    10,
    "one set of copies, sized to the peak",
  );
  assert.equal(
    doc.querySelectorAll(".card").length,
    1,
    "copies do not keep the original's classes",
  );
  assert.equal(doc.querySelectorAll(".es-clone[data-start]").length, 0);
  assert.equal(doc.querySelectorAll(".es-clone[data-duration]").length, 0);
});

test("a later attach does not redraw earlier copies while it records", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div><div id="b" ${ABS}></div>`), {
    a: (t) => ({ x: RUN.x * t }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0, callbacks: true });
  const groupA = doc.getElementById("a").previousElementSibling;
  const watch = new pg.win.MutationObserver(() => {});
  watch.observe(groupA, { attributes: true, subtree: true });
  watch.takeRecords();
  pg.attach("#b", pg.tl, { callbacks: true });
  assert.ok(
    watch.takeRecords().length <= 1,
    "attach A's copies are redrawn once to restore the frame, not once per recording sample",
  );
});

test("the group takes the target's z-index, so the target keeps its place in the stack", () => {
  const { pg, doc } = setup(
    ROOT('<div id="a" style="position:absolute;z-index:7;width:40px;height:20px"></div>'),
    { a: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach("#a", pg.tl, { threshold: 10 });
  assert.equal(doc.querySelector("[data-hf-echo-group]").style.zIndex, "7");
});

test("the target is not re-parented or restyled", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  const a = doc.getElementById("a");
  const parent = a.parentNode;
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  assert.ok(a.parentNode === parent, "same parent"); // not assert.equal: a failing diff of DOM nodes never finishes
  assert.equal(a.style.mixBlendMode, "");
  assert.equal(a.style.pointerEvents, "");
  assert.ok(
    a.previousElementSibling && a.previousElementSibling.hasAttribute("data-hf-echo-group"),
    "the group sits just before it",
  );
});

test("a statically positioned target smears in place", () => {
  const { pg, doc } = setup(
    ROOT('<div id="a" style="width:40px;height:20px"></div><div id="after"></div>'),
    {
      a: (t) => ({ x: RUN.x * t }),
    },
  );
  const a = doc.getElementById("a");
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0, "copies show");
  assert.ok(
    shown.every((c) => c.style.position === "absolute"),
    "copies are out of flow",
  );
  assert.ok(doc.getElementById("after").previousElementSibling === a, "the layout is untouched");
});

test("the group mirrors the target's own visibility, as the timeline wrote it", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), {
    a: (t) => ({ x: RUN.x * t, visibility: t >= 0.4 ? "hidden" : "" }),
  });
  const a = doc.getElementById("a");
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  const group = a.previousElementSibling;
  pg.tl.seek(0.2);
  assert.equal(group.style.visibility, "", "visible target: the group follows its parent");
  pg.tl.seek(0.5);
  assert.equal(group.style.visibility, "hidden");
});

test("copies of copies are never targets, and an element is attached once", () => {
  const { pg, doc } = setup(
    ROOT(
      '<div class="word" id="w" style="position:absolute"><span class="char" id="c1"></span></div>',
    ),
    { w: (t) => ({ x: RUN.x * t }), c1: (t) => ({ x: 400 * t }) },
  );
  pg.attach(".word", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 5 });
  pg.attach(".word .char", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 5 });
  assert.equal(
    doc.querySelectorAll("[data-hf-echo-group]").length,
    2,
    "one group for .word, one for the original .char",
  );
  pg.attach(".word .char", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 5 });
  assert.equal(
    doc.querySelectorAll("[data-hf-echo-group]").length,
    2,
    "attaching it again adds nothing",
  );
});

test("media inside a target is not cloned live", () => {
  const { pg, doc } = setup(
    ROOT(`<div id="a" ${ABS}><video poster="p.png"></video><audio></audio></div>`),
    { a: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 4 });
  assert.equal(
    doc.querySelectorAll(".es-clone video, .es-clone audio, .es-clone iframe").length,
    0,
  );
  assert.equal(doc.querySelectorAll("#a video").length, 1, "the original keeps its video");
});

// Task 2 of the review-fix plan: poses come from the resolved transform, not from GSAP properties.
test("a target outside any composition still smears", () => {
  const { pg, doc } = setup(`<div id="a" ${ABS}></div>`, { a: (t) => ({ x: RUN.x * t }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  assert.ok(shownCopies(doc).length > 0);
});

test("an attach that throws mid-sweep leaves the other smears working", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div><div id="b" ${ABS}></div>`), {
    a: (t) => ({ x: RUN.x * t }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  const realTime = pg.tl.time.bind(pg.tl);
  let calls = 0;
  pg.tl.time = (v, quiet) => {
    if (v !== undefined && ++calls === 5) throw new Error("boom");
    return realTime(v, quiet);
  };
  assert.throws(() => pg.attach("#b", pg.tl, {}), /boom/);
  pg.tl.time = realTime;
  pg.tl.seek(0.5);
  assert.ok(shownCopies(doc).length > 0, "attach A still renders");
});

test("the recording sweep fires no timeline callbacks unless asked", () => {
  const quiet = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  let fired = 0;
  quiet.pg.tl.userCallback = () => fired++;
  quiet.pg.attach("#a", quiet.pg.tl, {});
  assert.equal(fired, 0, "default: quiet");
  const loud = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  let heard = 0;
  loud.pg.tl.userCallback = () => heard++;
  loud.pg.attach("#a", loud.pg.tl, { callbacks: true });
  assert.ok(heard > 0, "callbacks: true lets motion written from onUpdate be recorded");
});

test("copies keep the target's whole transform, so a percent shift survives", () => {
  // The drive writes translate(-50%, -50%) first, then a 600 px/s move, as xPercent -50 with x does.
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), {
    a: (t) => ({ css: `matrix(1, 0, 0, 1, ${-20 + 600 * t}, -10)` }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const nearest = shownCopies(doc)
    .map(translateX)
    .sort((p, q) => q - p)[0];
  assert.ok(Math.abs(nearest - (-20 + 600 * (0.5 - 1 / 300))) < 0.5, `nearest copy ${nearest}`);
  const f = Number(/matrix\(([^)]+)\)/.exec(shownCopies(doc)[0].style.transform)[1].split(",")[5]);
  assert.equal(f, -10, "the vertical shift is kept");
});

test("motion that comes only from an ancestor draws no copies", () => {
  const { pg, doc } = setup(
    ROOT(`<div id="p" style="position:absolute"><div id="a" ${ABS}></div></div>`),
    { p: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  assert.equal(shownCopies(doc).length, 0);
});

test("a matrix3d target gets copies taken from the nearest recorded sample, never NaN", () => {
  const css = (t) => `matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, ${600 * t},0,0,1)`;
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ css: css(t) }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0, "a 3D mover has copies");
  assert.ok(
    shown.every((c) => /^matrix3d\(/.test(c.style.transform) && !/NaN/.test(c.style.transform)),
  );
});

test("a transform-origin at the corner measures from the corner", () => {
  const spin = (t) => ({ rotation: 720 * t });
  const corner = setup(
    ROOT(
      '<div id="a" style="position:absolute;width:100px;height:100px;transform-origin:0px 0px"></div>',
    ),
    { a: spin },
  );
  corner.pg.attach("#a", corner.pg.tl, { threshold: 10, edgeSpacing: 0, measurePoint: [1, 1] });
  corner.pg.tl.seek(0.5);
  assert.ok(shownCopies(corner.doc).length > 0, "the far corner of a spinning box travels");
  const origin = setup(
    ROOT(
      '<div id="a" style="position:absolute;width:100px;height:100px;transform-origin:0px 0px"></div>',
    ),
    { a: spin },
  );
  origin.pg.attach("#a", origin.pg.tl, { threshold: 10, edgeSpacing: 0, measurePoint: [0, 0] });
  origin.pg.tl.seek(0.5);
  assert.equal(shownCopies(origin.doc).length, 0, "the pivot itself does not move");
});

test("a target that never smears gets no group and no copies", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: 10 * t }) });
  pg.attach("#a", pg.tl, { threshold: 40 });
  assert.equal(doc.querySelectorAll("[data-hf-echo-group], .es-clone").length, 0);
});

test("copies are built to the peak count, capped by maxEchoes", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 4 });
  assert.equal(doc.querySelectorAll(".es-clone").length, 4, "capped");
  const more = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  more.pg.attach("#a", more.pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 60 });
  assert.equal(more.doc.querySelectorAll(".es-clone").length, 10, "the peak, not 60");
});

// Task 3: the demo inlines the snippet, and nothing else keeps the two in step.
test("demo.html carries the component's snippet verbatim", async () => {
  const demo = await readFile(new URL("./demo.html", import.meta.url), "utf8");
  // Whitespace and trailing commas: oxfmt formats the same code differently at another depth.
  const squash = (text) => text.replace(/\s+/g, "").replace(/,(?=[\])}])/g, "");
  assert.ok(
    squash(demo).includes(squash(library)),
    "the demo's inlined snippet differs from echo-smear.html",
  );
});

// Fix pass after the final review of the rewrite.
test("copies are placed on the target's box even when they were hidden at the last box change", () => {
  const drive = (t) => ({
    x: 1500 * t * t,
    off: t >= 0.5 ? { l: 200, t: 30, w: 40, h: 20 } : { l: 350, t: 150, w: 40, h: 20 },
  });
  const { pg, doc } = setup(ROOT('<div id="a" style="width:40px;height:20px"></div>'), {
    a: drive,
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.1); // few copies shown, the box is (350, 150)
  pg.tl.seek(0.9); // many shown, the box is now (200, 30)
  const shown = shownCopies(doc);
  assert.ok(shown.length > 5, `copies ${shown.length}`);
  assert.ok(
    shown.every((c) => c.style.left === "200px" && c.style.top === "30px"),
    "every shown copy is on the current box",
  );
});

test("a static target's copies sit on its box from the first frame", () => {
  const { pg, doc } = setup(ROOT('<div id="a" style="width:40px;height:20px"></div>'), {
    a: (t) => ({ x: RUN.x * t, off: { l: 350, t: 150, w: 40, h: 20 } }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((c) => c.style.left === "350px" && c.style.top === "150px"));
});

test("a target inside a shadow root attaches, and its rules live in that root", () => {
  const poseOf = new Map();
  const pg = page(poseOf);
  const host = pg.win.document.createElement("div");
  pg.win.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<div id="a" style="position:absolute;width:40px;height:20px"></div>';
  const a = shadow.getElementById("a");
  poseOf.set(a, (t) => ({ x: RUN.x * t }));
  assert.doesNotThrow(() => pg.attach(a, pg.tl, { threshold: 10, edgeSpacing: 0 }));
  assert.doesNotThrow(() => pg.tl.seek(0.5));
  assert.ok(shadow.querySelector("style"), "the copies' rules are in the shadow root");
});

test("filter and the other non-transform styles follow the recorded time", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), {
    a: (t) => ({ x: RUN.x * t, filter: t < 0.2 ? "none" : "blur(2px)" }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0);
  assert.ok(
    shown.every((c) => c.style.filter === "blur(2px)"),
    "a copy carries the filter the target had then",
  );
});

test("the snippet never constructs a ResizeObserver", () => {
  const { pg } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  assert.doesNotThrow(() => pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 }));
});

test("copies carry the parent's perspective, because they are grandchildren of it", () => {
  const { pg, doc } = setup(
    ROOT(`<div id="p" style="position:absolute;perspective:400px"><div id="a" ${ABS}></div></div>`),
    { a: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0);
  assert.ok(
    shown.every((c) => c.style.transform.startsWith("perspective(400px) ")),
    shown[0].style.transform,
  );
});

test("media with children does not shift the style rules of what follows it", () => {
  const { pg, doc } = setup(
    ROOT(`<div id="a" ${ABS}><video><source src="x.mp4"></video><p class="t">x</p></div>`),
    { a: (t) => ({ x: RUN.x * t }) },
  );
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0, maxEchoes: 2 });
  // root, the media's stand-in, the paragraph: three rules, not four.
  assert.equal(doc.getElementById("hf-es-styles").childNodes.length, 3);
});

test("a copy is sized to the offset box with border-box, so padding is not added twice", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  assert.ok(shownCopies(doc).every((c) => c.style.boxSizing === "border-box"));
});

test("an SVG child target is skipped with a warning", () => {
  const { pg, doc } = setup(
    ROOT(`<svg id="s" ${ABS}><rect id="r" width="10" height="10"></rect></svg>`),
    {
      r: (t) => ({ x: RUN.x * t }),
    },
  );
  pg.attach("#r", pg.tl, { threshold: 10, edgeSpacing: 0 });
  assert.equal(doc.querySelectorAll("[data-hf-echo-group]").length, 0);
  assert.ok(
    pg.warnings.some((w) => /svg/i.test(w)),
    pg.warnings.join(" | "),
  );
});

test("copies carry the recorded opacity", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), {
    a: (t) => ({ x: RUN.x * t, opacity: 0.5 }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  assert.ok(shownCopies(doc).every((c) => c.style.opacity === "0.5"));
});

// Real GSAP, not the fake timeline: the callbacks a composition puts on its timeline must not fire at attach.
test("attaching leaves real GSAP callbacks unfired, and a removal callback cannot remove the target", () => {
  const win = new Window({ url: "http://localhost/" });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.getComputedStyle = (e) => win.getComputedStyle(e);
  const { gsap } = createRequire(new URL("../../../packages/core/package.json", import.meta.url))(
    "gsap",
  );
  win.document.body.innerHTML = ROOT(`<div id="a" ${ABS}></div>`);
  const a = win.document.getElementById("a");
  const tl = gsap.timeline({ paused: true });
  const fired = { call: 0, complete: 0, reverse: 0 };
  tl.to(
    a,
    {
      x: 600,
      duration: 1,
      ease: "none",
      onComplete: () => {
        fired.complete++;
        a.remove();
      },
      onReverseComplete: () => fired.reverse++,
    },
    0,
  );
  tl.call(() => fired.call++, [], 0.5);
  vm.runInNewContext(library, {
    window: win,
    document: win.document,
    Element: win.Element,
    getComputedStyle: (e) => win.getComputedStyle(e),
    console,
  });
  assert.doesNotThrow(() => win.attachEchoSmear(a, tl, { threshold: 10, edgeSpacing: 0 }));
  assert.deepEqual({ ...fired }, { call: 0, complete: 0, reverse: 0 });
  assert.ok(a.parentNode, "the target is still in the document");
  assert.equal(tl.time(), 0, "the playhead is back where it was");
});

// Round 3: findings from the re-review at 161796db4.
test("the group's visibility does not depend on the path taken to a time", () => {
  // autoAlpha 0 arrives at t = 1: visible at 0.5 however it is reached.
  const drive = (t) => ({ x: RUN.x * t, visibility: t >= 1 ? "hidden" : "" });
  const cold = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: drive });
  cold.pg.attach("#a", cold.pg.tl, { threshold: 10, edgeSpacing: 0 });
  cold.pg.tl.seek(0.5);
  const viaEnd = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: drive });
  viaEnd.pg.attach("#a", viaEnd.pg.tl, { threshold: 10, edgeSpacing: 0 });
  viaEnd.pg.tl.seek(1);
  viaEnd.pg.tl.seek(0.5);
  assert.ok(shownCopies(cold.doc).length > 0, "cold: copies show");
  assert.equal(
    shownCopies(viaEnd.doc).length,
    shownCopies(cold.doc).length,
    "after 1 -> 0.5: the same copies",
  );
  assert.equal(
    viaEnd.doc.getElementById("a").previousElementSibling.style.visibility,
    cold.doc.getElementById("a").previousElementSibling.style.visibility,
  );
});

test("the copies' box does not depend on the path taken to a time", () => {
  const drive = (t) => ({
    x: RUN.x * t,
    off: t >= 0.7 ? { l: 200, t: 30, w: 40, h: 20 } : { l: 350, t: 150, w: 40, h: 20 },
  });
  const cold = setup(ROOT('<div id="a" style="width:40px;height:20px"></div>'), { a: drive });
  cold.pg.attach("#a", cold.pg.tl, { threshold: 10, edgeSpacing: 0 });
  cold.pg.tl.seek(0.5);
  const viaEnd = setup(ROOT('<div id="a" style="width:40px;height:20px"></div>'), { a: drive });
  viaEnd.pg.attach("#a", viaEnd.pg.tl, { threshold: 10, edgeSpacing: 0 });
  viaEnd.pg.tl.seek(1);
  viaEnd.pg.tl.seek(0.5);
  const lefts = (doc) => shownCopies(doc).map((c) => c.style.left);
  assert.ok(lefts(cold.doc).length > 0 && lefts(cold.doc).every((l) => l === "350px"));
  assert.deepEqual(lefts(viaEnd.doc), lefts(cold.doc));
});

test("motion written only through the CSS translate property counts, and copies carry it in transform", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), {
    a: (t) => ({ css: "none", translate: `${RUN.x * t}px 0px` }),
  });
  pg.attach("#a", pg.tl, { threshold: 10, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0, "a translate-only mover has copies");
  const nearest = shown.map(translateX).sort((p, q) => q - p)[0];
  assert.ok(Math.abs(nearest - 600 * (0.5 - 1 / 300)) < 0.5, `nearest copy ${nearest}`);
  assert.ok(
    shown.every((c) => c.style.translate === "none"),
    "the copy's own translate is cleared so it is not applied twice",
  );
});

test("overlapping inputs in one call attach an element once", () => {
  const { pg, doc } = setup(ROOT(`<div id="a" ${ABS}></div>`), { a: (t) => ({ x: RUN.x * t }) });
  pg.attach(["#a", doc.getElementById("a"), "#a"], pg.tl, { threshold: 10, edgeSpacing: 0 });
  assert.equal(doc.querySelectorAll("[data-hf-echo-group]").length, 1);
});

test("a percentage translate moves by that share of the element's own width", () => {
  // 0% -> 300% over one second on a 200 px wide box: 300% = 600 px, 150% = 300 px at 0.5 s.
  const { pg, doc } = setup(
    ROOT('<div id="a" style="position:absolute;width:200px;height:80px"></div>'),
    { a: (t) => ({ css: "none", translate: `${300 * t}%` }) },
  );
  doc.getElementById("a").__off = { l: 0, t: 0, w: 200, h: 80 }; // the box a percentage is a share of
  pg.attach("#a", pg.tl, { threshold: 2, edgeSpacing: 0 });
  pg.tl.seek(0.5);
  const shown = shownCopies(doc);
  assert.ok(shown.length > 0);
  const nearest = shown.map(translateX).sort((p, q) => q - p)[0];
  // The nearest copy is one copy-interval back from 300 px: about 298 px, not 140.
  assert.ok(nearest > 280 && nearest < 300, `nearest copy ${nearest}`);
});
