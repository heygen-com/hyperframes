/**
 * U3: end-to-end resolution of computed timelines (helpers, loops) through the
 * read parser — true positions, motionPath arcs, and provenance — plus
 * regression coverage that literal-position compositions are unchanged.
 */
import { describe, it, expect } from "vitest";
import { parseGsapScriptAcorn, editabilityForProvenance } from "./gsapParserAcorn.js";

describe("editabilityForProvenance", () => {
  it("maps provenance kinds to an editing strategy", () => {
    expect(editabilityForProvenance(undefined)).toBe("direct");
    expect(editabilityForProvenance({ kind: "literal" })).toBe("direct");
    expect(editabilityForProvenance({ kind: "helper", fn: "addCycle", callSite: 1 })).toBe(
      "unroll",
    );
    expect(editabilityForProvenance({ kind: "loop", callSite: 1, iteration: 0 })).toBe("unroll");
    expect(editabilityForProvenance({ kind: "runtime-dynamic" })).toBe("source");
  });
});

const start = (a: { resolvedStart?: number }): number | undefined => a.resolvedStart;

function expectDistinctProxyIdentities(script: string): void {
  const { animations } = parseGsapScriptAcorn(script);
  expect(animations[0]?.targetIdentity).toBeDefined();
  expect(animations[1]?.targetIdentity).toBeDefined();
  expect(animations[0]?.targetIdentity).not.toBe(animations[1]?.targetIdentity);
}

describe("parseGsapScriptAcorn — computed timelines", () => {
  it("resolves an add-to-basket helper called twice (the reported case)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const DX = 852, DY = -322, FLY_SCALE = 56 / 160;
      tl.from("#product", { opacity: 0, scale: 0.8, duration: 0.5 }, 0.1);
      function addCycle(at, path, curviness, spin) {
        tl.to("#product", { y: -15, scale: 1.05, duration: 0.15 }, at + 0.15);
        tl.to("#product", { motionPath: { path, curviness }, scale: FLY_SCALE, rotation: spin, duration: 0.55 }, at + 0.3);
        tl.to("#product", { opacity: 0, duration: 0.08 }, at + 0.78);
      }
      addCycle(1.0, [{x:0,y:-15},{x:180,y:-300},{x:520,y:-360},{x:DX,y:DY}], 2, 18);
      addCycle(3.6, [{x:0,y:-15},{x:-120,y:-220},{x:350,y:-380},{x:DX,y:DY}], 2.5, -22);
    `;
    const { animations } = parseGsapScriptAcorn(script);

    // 1 entrance + 3 body tweens × 2 cycles = 7 (was 4 before inlining).
    expect(animations).toHaveLength(7);

    // Entrance keeps its literal position and has no provenance.
    expect(start(animations[0]!)).toBeCloseTo(0.1);
    expect(animations[0]!.provenance).toBeUndefined();

    // Cycle tweens land at their true absolute times, in order.
    expect(animations.slice(1).map(start)).toEqual([1.15, 1.3, 1.78, 3.75, 3.9, 4.38]);

    // Both flight tweens are recognized as arcs and tagged with helper provenance.
    const arcs = animations.filter((a) => a.arcPath?.enabled);
    expect(arcs).toHaveLength(2);
    expect(arcs.map((a) => a.provenance?.fn)).toEqual(["addCycle", "addCycle"]);
    expect(arcs.map((a) => a.provenance?.callSite)).toEqual([1, 2]);
    // 4 waypoints ⇒ Arc Motion's ">= 2 position keyframes" gate passes.
    expect(arcs[0]!.keyframes?.keyframes).toHaveLength(4);
  });

  it("resolves a bounded for-loop", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      for (let i = 0; i < 3; i++) { tl.to("#x", { x: 100, duration: 0.5 }, i * 0.5); }
    `);
    expect(animations).toHaveLength(3);
    expect(animations.map(start)).toEqual([0, 0.5, 1]);
    expect(animations.map((a) => a.provenance?.kind)).toEqual(["loop", "loop", "loop"]);
  });

  it("keeps DOM target bindings distinct across bounded loop iterations", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      for (let i = 0; i < 2; i++) {
        const card = document.getElementById("caption-card-" + i);
        tl.to(card, { opacity: 1, duration: 1 }, i * 0.5);
      }
    `);

    expect(animations.map((animation) => animation.targetSelector)).toEqual([
      "#caption-card-0",
      "#caption-card-1",
    ]);
  });

  it("keeps var DOM target bindings visible outside ordinary blocks", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      if (true) {
        var card = document.getElementById("caption-card");
      }
      tl.to(card, { opacity: 1, duration: 1 }, 0);
    `);

    expect(animations.map((animation) => animation.targetSelector)).toEqual(["#caption-card"]);
  });

  it("keeps an outer let DOM target binding after assignment inside a block", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      let card;
      if (true) {
        card = document.getElementById("caption-card");
      }
      tl.to(card, { opacity: 1, duration: 1 }, 0);
    `);

    expect(animations.map((animation) => animation.targetSelector)).toEqual(["#caption-card"]);
  });

  it("uses declaration-scoped identities for object proxy targets", () => {
    expectDistinctProxyIdentities(`
      const tl = gsap.timeline();
      (() => {
        const driver = { value: 0 };
        tl.to(driver, { value: 1, duration: 1 }, 0);
      })();
      (() => {
        const driver = { value: 0 };
        tl.to(driver, { value: 1, duration: 1 }, 0);
      })();
    `);
  });

  it("withholds object proxy identity when the binding is reassigned", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      let driver = { value: 0 };
      tl.to(driver, { value: 1, duration: 1 }, 0);
      driver = { value: 0 };
      tl.to(driver, { value: 1, duration: 1 }, 0);
    `);

    expect(animations.map((animation) => animation.targetIdentity)).toEqual([undefined, undefined]);
  });

  it("keeps helper-created object proxy instances distinct", () => {
    expectDistinctProxyIdentities(`
      const tl = gsap.timeline();
      function addDriver(at) {
        const driver = { value: 0 };
        tl.to(driver, { value: 1, duration: 1 }, at);
      }
      addDriver(0);
      addDriver(0.5);
    `);
  });

  it("keeps helper-created object proxy instances distinct across nested blocks", () => {
    expectDistinctProxyIdentities(`
      const tl = gsap.timeline();
      function addDriver(at) {
        if (at >= 0) {
          const driver = { value: 0 };
          tl.to(driver, { value: 1, duration: 1 }, at);
        }
      }
      addDriver(0);
      addDriver(0.5);
    `);
  });

  it("keeps helper-created var proxy instances distinct", () => {
    expectDistinctProxyIdentities(`
      const tl = gsap.timeline();
      function addDriver(at) {
        var driver = { value: 0 };
        tl.to(driver, { value: 1, duration: 1 }, at);
      }
      addDriver(0);
      addDriver(0.5);
    `);
  });

  it("keeps one outer object proxy stable across helper calls", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      const driver = { value: 0 };
      function animateDriver(at) {
        tl.to(driver, { value: 1, duration: 1 }, at);
      }
      animateDriver(0);
      animateDriver(0.5);
    `);

    expect(animations[0]?.targetIdentity).toBeDefined();
    expect(animations[1]?.targetIdentity).toBe(animations[0]?.targetIdentity);
  });

  it("keeps parameter DOM target assignments visible outside nested blocks", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      function configure(card) {
        if (true) {
          card = document.getElementById("caption-card");
        }
        tl.to(card, { opacity: 1, duration: 1 }, 0);
      }
      configure(null);
    `);

    expect(animations.map((animation) => animation.targetSelector)).toEqual(["#caption-card"]);
  });

  it("leaves a literal-position composition unchanged (regression)", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline();
      tl.from("#a", { opacity: 0, duration: 0.5 }, 0.1);
      tl.to("#b", { x: 50, duration: 0.4 }, 1.0);
    `);
    expect(animations).toHaveLength(2);
    expect(animations.map(start)).toEqual([0.1, 1.0]);
    expect(animations.every((a) => a.provenance === undefined)).toBe(true);
  });
});
