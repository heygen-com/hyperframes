import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("./filmed-screen.html", import.meta.url), "utf8");
const library = html.match(/<script>([\s\S]*?)<\/script>/i)[1];

// A page with the engine's seek hooks, a `data-vfx-chain` co-owner of the composite slot, and
// enough canvas/WebGL surface for mount() to build a lens. Draws are counted per lens.
function page() {
  const draws = [];
  const uniforms = {};
  const gl = (id) =>
    new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === "getShaderParameter") return () => true;
          if (key === "getUniformLocation") return (_, name) => name;
          if (key === "uniform1f") return (name, v) => (uniforms[name] = v);
          if (key === "drawArrays") return () => draws.push(id);
          if (key === "getExtension") return () => null;
          if (typeof key === "string" && /^[A-Z0-9_]+$/.test(key)) return 1;
          return () => ({});
        },
      },
    );
  let outs = 0;
  const document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      remove() {},
      getContext: () => gl(`out${outs++}`),
    }),
    querySelectorAll: () => [],
  };
  const sandbox = {
    console: { warn() {}, error() {}, log() {} },
    setTimeout: () => 0,
    document,
    __hf: { seek() {} },
    __player: { seek() {}, renderSeek() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(library, sandbox);

  // Verbatim shape of core's armPageComposite (packages/core/src/runtime/vfx.ts): re-armed on
  // every seek, and its resolver reads the shared `priorResolver` when it is called.
  let priorResolver = null;
  let vfxResolver = null;
  let vfxCaptures = 0;
  const armVfx = () => {
    const current = sandbox.__hf_page_composite_resolve;
    if (current !== vfxResolver) {
      priorResolver = typeof current === "function" ? current : null;
      vfxResolver = () => {
        const prior = priorResolver ? priorResolver() : false;
        vfxCaptures++;
        return vfxCaptures > 0 || prior;
      };
      sandbox.__hf_page_composite_resolve = vfxResolver;
    }
  };

  const canvas = () => {
    const attrs = new Map();
    return {
      width: 1920,
      height: 1080,
      offsetLeft: 0,
      offsetTop: 0,
      offsetWidth: 1920,
      offsetHeight: 1080,
      nextSibling: null,
      parentNode: { insertBefore() {} },
      closest: () => null,
      getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
      hasAttribute: (k) => attrs.has(k),
      setAttribute: (k, v) => attrs.set(k, v),
    };
  };
  return { sandbox, draws, uniforms, armVfx, canvas, captures: () => vfxCaptures };
}

const shots = [{ until: 10, palette: null }];

for (const order of ["vfx arms first", "filmed-screen arms first"]) {
  test(`composite resolve survives a data-vfx-chain co-owner (${order})`, async () => {
    const p = page();
    p.sandbox.HFFilmedScreen.mount({ canvas: [p.canvas()], shots });
    // The engine's seek arms vfx inside the call; filmed-screen's hook arms after it returns.
    const hooked = p.sandbox.__hf.seek;
    if (order === "vfx arms first") p.sandbox.__hf.seek = (t) => (p.armVfx(), hooked(t));
    for (let frame = 1; frame <= 6; frame++) {
      p.sandbox.__hf.seek(frame / 30);
      if (order !== "vfx arms first") p.armVfx();
      await p.sandbox.__hf_page_composite_prepare?.();
      assert.doesNotThrow(() => p.sandbox.__hf_page_composite_resolve(), `frame ${frame}`);
      assert.equal(p.draws.length, frame, `one filmed-screen draw per frame (frame ${frame})`);
    }
    // In the engine's order vfx runs exactly once a frame. Armed the other way round, its stale
    // resolver from the previous frame runs too; that costs a second capture, not a loop.
    if (order === "vfx arms first") assert.equal(p.captures(), 6);
    else assert.ok(p.captures() >= 6);
  });
}

test("each mount takes the next unmounted canvas instead of re-filming the first", () => {
  const p = page();
  const a = p.canvas();
  const b = p.canvas();
  p.sandbox.HFFilmedScreen.mount({ canvas: [a, b], shots });
  p.sandbox.HFFilmedScreen.mount({ canvas: [a, b], shots });
  assert.ok(a.hasAttribute("data-filmed-screen-mounted"));
  assert.ok(b.hasAttribute("data-filmed-screen-mounted"));
  assert.throws(() => p.sandbox.HFFilmedScreen.mount({ canvas: [a, b], shots }), /no unmounted/);
});

test("nothing claims the composite slot until a lens is mounted", () => {
  const p = page();
  p.sandbox.__hf.seek(0.5);
  assert.equal(p.sandbox.__hf_page_composite_pending, undefined);
  assert.equal(p.sandbox.__hf_page_composite_resolve, undefined);
});

test("the demo pastes the same library as the snippet", async () => {
  const demo = await readFile(new URL("./demo.html", import.meta.url), "utf8");
  const squash = (s) => s.replace(/\s+/g, "");
  const pasted = demo.match(/<script>\s*\(function \(\) \{[\s\S]*?<\/script>/i);
  assert.ok(pasted, "demo.html carries the library inline");
  assert.equal(squash(pasted[0]), squash(`<script>${library}</script>`));
});

test("a draw before the scene's first paint waits for the paint instead of logging", () => {
  const p = page();
  const errors = [];
  p.sandbox.console.error = (m) => errors.push(m);
  const listeners = [];
  let throwsLeft = 1;
  const scene = { querySelectorAll: () => [], setAttribute() {} };
  const src = Object.assign(p.canvas(), {
    hasAttribute: (
      (has) => (k) =>
        k === "layoutsubtree" || has(k)
    )(p.canvas().hasAttribute),
    firstElementChild: scene,
    getContext: () => ({
      clearRect() {},
      drawElementImage() {
        if (throwsLeft-- > 0)
          throw new Error(
            "Failed to execute 'drawElementImage' on 'CanvasRenderingContext2D': No cached paint record for element.",
          );
      },
    }),
    addEventListener: (type, fn) => type === "paint" && listeners.push(fn),
    requestPaint: () => listeners.splice(0).forEach((fn) => fn()),
  });
  const attrs = new Map();
  src.hasAttribute = (k) => k === "layoutsubtree" || attrs.has(k);
  src.setAttribute = (k, v) => attrs.set(k, v);
  p.sandbox.HFFilmedScreen.mount({ canvas: [src], shots });
  p.sandbox.__hf.seek(0.5);
  p.sandbox.__hf_page_composite_resolve();
  assert.deepEqual(errors, []);
  assert.equal(p.draws.length, 1, "redrawn once the paint landed");
});

test("a negative curve is clamped to flat instead of folding the frame", () => {
  const p = page();
  p.sandbox.HFFilmedScreen.mount({ canvas: [p.canvas()], shots, curve: -1 });
  p.sandbox.__hf.seek(0.5);
  p.sandbox.__hf_page_composite_resolve();
  assert.equal(p.uniforms.uCurve, 0);
});
