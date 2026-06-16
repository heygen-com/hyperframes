/**
 * Parity harness — recast writer (gsapParser.ts) vs acorn writer
 * (gsapWriterAcorn.ts). Both must produce scripts that REPARSE to the same
 * animation model. Byte-equality is not expected (recast pretty-prints, acorn
 * splices), so parity is asserted on the parsed GsapAnimation, not raw text.
 *
 * This is the safety net for porting WS-3 ops one at a time: each ported op
 * gets a fixture row here proving it matches the battle-tested original.
 */
import { describe, expect, it } from "vitest";
import {
  parseGsapScript,
  removeAllKeyframesFromScript as removeAllRecast,
  convertToKeyframesInScript as convertRecast,
  materializeKeyframesInScript as materializeRecast,
  splitIntoPropertyGroups as splitGroupsRecast,
  splitAnimationsInScript as splitAnimsRecast,
  type SplitAnimationsOptions,
} from "./gsapParser.js";
import { parseGsapScriptAcornForWrite, type ParsedGsapAcornForWrite } from "./gsapParserAcorn.js";
import {
  removeAllKeyframesFromScript as removeAllAcorn,
  convertToKeyframesFromScript as convertAcorn,
  materializeKeyframesFromScript as materializeAcorn,
  splitIntoPropertyGroupsFromScript as splitGroupsAcorn,
  splitAnimationsInScript as splitAnimsAcorn,
  setArcPathInScript as setArcAcorn,
  updateArcSegmentInScript as updateArcSegmentAcorn,
  removeArcPathFromScript as removeArcAcorn,
  unrollDynamicAnimations as unrollAcorn,
} from "./gsapWriterAcorn.js";
function acornId(script: string): string {
  const parsed = parseGsapScriptAcornForWrite(script) as ParsedGsapAcornForWrite;
  return parsed.located[0]!.id;
}

function arcShapeOf(script: string) {
  const anim = parseGsapScript(script).animations[0]!;
  return { arcPath: anim.arcPath, properties: anim.properties };
}

/** Reparse a written script and return the first animation's editable shape. */
function shapeOf(script: string) {
  const anim = parseGsapScript(script).animations[0]!;
  return {
    method: anim.method,
    properties: anim.properties,
    keyframes: anim.keyframes,
    duration: anim.duration,
    ease: anim.ease,
  };
}

const REMOVE_ALL_FIXTURES: Array<{ name: string; script: string }> = [
  {
    name: "to() — collapses to last keyframe",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "100%": { x: 200, opacity: 1 } },
        duration: 2
      }, 0);
    `,
  },
  {
    name: "to() — single keyframe + ease",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", {
        keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        duration: 1,
        ease: "none"
      }, 0.5);
    `,
  },
  {
    name: "to() — easeEach dropped on collapse",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#card", {
        keyframes: { "0%": { y: 0 }, "100%": { y: -40 }, easeEach: "power2.inOut" },
        duration: 1.5
      }, 0);
    `,
  },
];

describe("parity: removeAllKeyframesFromScript (recast vs acorn)", () => {
  for (const { name, script } of REMOVE_ALL_FIXTURES) {
    it(name, () => {
      const id = acornId(script);
      // Sanity: recast and acorn agree on the id for this tween.
      expect(parseGsapScript(script).animations[0]!.id).toBe(id);

      const recastOut = removeAllRecast(script, id);
      const acornOut = removeAllAcorn(script, id);

      const recastShape = shapeOf(recastOut);
      const acornShape = shapeOf(acornOut);

      expect(acornShape.keyframes).toBeUndefined();
      expect(acornShape).toEqual(recastShape);
    });
  }

  it("no-op when id not found", () => {
    const script = REMOVE_ALL_FIXTURES[0]!.script;
    expect(removeAllAcorn(script, "nonexistent-id")).toBe(script);
  });

  it("no-op when tween has no keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#flat", { x: 100, duration: 1 }, 0);
    `;
    const id = acornId(script);
    expect(removeAllAcorn(script, id)).toBe(script);
  });
});

const CONVERT_FIXTURES: Array<{
  name: string;
  script: string;
  resolvedFromValues?: Record<string, number | string>;
}> = [
  {
    name: "to() — builds 0%/100% keyframes with identity from",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 200, opacity: 0.5, duration: 1.5 }, 0);
    `,
  },
  {
    name: "to() — with ease becomes easeEach + ease: none",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", { x: 100, duration: 1, ease: "power2.out" }, 0);
    `,
  },
  {
    name: "from() — method renamed to to()",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.from("#card", { y: -50, opacity: 0, duration: 0.8 }, 0);
    `,
  },
  {
    name: "fromTo() — method renamed, fromArg removed",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#text", { x: 0 }, { x: 300, duration: 2 }, 0);
    `,
  },
  {
    name: "to() — with resolvedFromValues overrides 0%",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, 0);
    `,
    resolvedFromValues: { x: 42 },
  },
];

describe("parity: convertToKeyframesFromScript (recast vs acorn)", () => {
  for (const { name, script, resolvedFromValues } of CONVERT_FIXTURES) {
    it(name, () => {
      const id = acornId(script);
      const recastOut = convertRecast(script, id, resolvedFromValues);
      const acornOut = convertAcorn(script, id, resolvedFromValues);

      const recastShape = shapeOf(recastOut);
      const acornShape = shapeOf(acornOut);

      expect(acornShape.keyframes).toBeDefined();
      expect(acornShape.method).toBe("to");
      expect(acornShape).toEqual(recastShape);
    });
  }

  it("no-op when id not found", () => {
    const script = CONVERT_FIXTURES[0]!.script;
    expect(convertAcorn(script, "nonexistent-id")).toBe(script);
  });

  it("no-op when tween already has keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { keyframes: { "0%": { x: 0 }, "100%": { x: 100 } }, duration: 1 }, 0);
    `;
    const id = acornId(script);
    expect(convertAcorn(script, id)).toBe(script);
  });
});

// ── materializeKeyframes parity ───────────────────────────────────────────────

const MATERIALIZE_KFS = [
  { percentage: 0, properties: { x: 0, opacity: 1 } },
  { percentage: 50, properties: { x: 150, opacity: 0.5 } },
  { percentage: 100, properties: { x: 300, opacity: 0 } },
];

const MATERIALIZE_FIXTURES: Array<{
  name: string;
  script: string;
  kfs: typeof MATERIALIZE_KFS;
  easeEach?: string;
}> = [
  {
    name: "flat tween — adds keyframes property",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 300, duration: 2 }, 0);
    `,
    kfs: MATERIALIZE_KFS,
  },
  {
    name: "with easeEach",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", { opacity: 0, duration: 1 }, 0);
    `,
    kfs: [
      { percentage: 0, properties: { opacity: 1 } },
      { percentage: 100, properties: { opacity: 0 } },
    ],
    easeEach: "power2.inOut",
  },
];

describe("parity: materializeKeyframesFromScript (recast vs acorn)", () => {
  for (const { name, script, kfs, easeEach } of MATERIALIZE_FIXTURES) {
    it(name, () => {
      const id = acornId(script);
      const recastOut = materializeRecast(script, id, kfs, easeEach);
      const acornOut = materializeAcorn(script, id, kfs, easeEach);
      const recastShape = shapeOf(recastOut);
      const acornShape = shapeOf(acornOut);
      expect(acornShape.keyframes).toBeDefined();
      expect(acornShape).toEqual(recastShape);
    });
  }

  it("no-op when id not found", () => {
    const script = MATERIALIZE_FIXTURES[0]!.script;
    expect(materializeAcorn(script, "nope", MATERIALIZE_KFS)).toBe(script);
  });
});

// ── splitIntoPropertyGroups parity ────────────────────────────────────────────

function shapesOf(script: string) {
  return parseGsapScript(script).animations.map((a) => ({
    method: a.method,
    properties: a.properties,
    keyframes: a.keyframes,
    duration: a.duration,
    ease: a.ease,
    selector: a.targetSelector,
    propertyGroup: a.propertyGroup,
  }));
}

const SPLIT_FIXTURES: Array<{ name: string; script: string }> = [
  {
    name: "flat mixed tween — splits into position + visual groups",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 100, y: 50, opacity: 0.5, duration: 1 }, 0);
    `,
  },
  {
    name: "keyframed mixed tween — splits per group",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", { keyframes: { "0%": { x: 0, opacity: 1 }, "100%": { x: 200, opacity: 0 } }, duration: 1 }, 0);
    `,
  },
];

describe("parity: splitIntoPropertyGroupsFromScript (recast vs acorn)", () => {
  for (const { name, script } of SPLIT_FIXTURES) {
    it(name, () => {
      const id = acornId(script);
      const { script: recastOut } = splitGroupsRecast(script, id);
      const { script: acornOut } = splitGroupsAcorn(script, id);
      const recastShapes = shapesOf(recastOut);
      const acornShapes = shapesOf(acornOut);
      expect(acornShapes).toHaveLength(recastShapes.length);
      expect(acornShapes.length).toBeGreaterThan(1);
      // Each produced group should match its counterpart by propertyGroup
      const sortByGroup = (arr: typeof recastShapes) =>
        arr.slice().sort((a, b) => (a.propertyGroup ?? "").localeCompare(b.propertyGroup ?? ""));
      expect(sortByGroup(acornShapes)).toEqual(sortByGroup(recastShapes));
    });
  }

  it("no-op when id not found", () => {
    const script = SPLIT_FIXTURES[0]!.script;
    const { script: out, ids } = splitGroupsAcorn(script, "nope");
    expect(out).toBe(script);
    expect(ids).toEqual(["nope"]);
  });

  it("no-op when single-group tween", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, y: 50, duration: 1 }, 0);
    `;
    const id = acornId(script);
    const { script: out } = splitGroupsAcorn(script, id);
    expect(out).toBe(script);
  });
});

// ── splitAnimationsInScript parity ────────────────────────────────────────────

function animShapesOf(script: string) {
  return parseGsapScript(script).animations.map((a) => ({
    method: a.method,
    selector: a.targetSelector,
    properties: a.properties,
    fromProperties: a.fromProperties,
    duration: a.duration,
    position: a.position,
  }));
}

const SPLIT_ANIM_CASES: Array<{ name: string; script: string; opts: SplitAnimationsOptions }> = [
  {
    name: "all tweens before split — retargets none",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 100, duration: 1 }, 0);
    `,
    opts: {
      originalId: "hero",
      newId: "hero-2",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    },
  },
  {
    name: "tween entirely after split — retargeted to newId",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { opacity: 0, duration: 0.5 }, 3);
    `,
    opts: {
      originalId: "hero",
      newId: "hero-2",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    },
  },
  {
    name: "tween spanning split — truncated first half + fromTo second half",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 200, duration: 4 }, 0);
    `,
    opts: {
      originalId: "hero",
      newId: "hero-2",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    },
  },
];

describe("parity: splitAnimationsInScript (recast vs acorn)", () => {
  for (const { name, script, opts } of SPLIT_ANIM_CASES) {
    it(name, () => {
      const { script: recastOut } = splitAnimsRecast(script, opts);
      const { script: acornOut } = splitAnimsAcorn(script, opts);
      const sortByPos = (arr: ReturnType<typeof animShapesOf>) =>
        arr.slice().sort((a, b) => {
          const pa = typeof a.position === "number" ? a.position : 0;
          const pb = typeof b.position === "number" ? b.position : 0;
          return pa - pb || (a.selector ?? "").localeCompare(b.selector ?? "");
        });
      expect(sortByPos(animShapesOf(acornOut))).toEqual(sortByPos(animShapesOf(recastOut)));
    });
  }

  it("no-op when originalId not found in script", () => {
    const script = SPLIT_ANIM_CASES[0]!.script;
    const opts: SplitAnimationsOptions = {
      originalId: "nonexistent",
      newId: "x",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    };
    expect(splitAnimsAcorn(script, opts).script).toBe(script);
  });
});

// ─── arc path parity ──────────────────────────────────────────────────────────

const ARC_FLAT_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#hero", { x: 100, y: 50, duration: 2 }, 0);
`;
const ARC_CFG = {
  enabled: true as const,
  autoRotate: false as const,
  segments: [{ curviness: 1 }],
};
const DISABLE_CFG = {
  enabled: false as const,
  autoRotate: false as const,
  segments: [] as never[],
};

function arcFixture() {
  const id = acornId(ARC_FLAT_SCRIPT);
  const enabled = setArcAcorn(ARC_FLAT_SCRIPT, id, ARC_CFG);
  return { id, enabled };
}

describe("setArcPathInScript: acorn output correctness", () => {
  it("enable: arcPath.enabled=true, segments preserved", () => {
    const id = acornId(ARC_FLAT_SCRIPT);
    const shape = arcShapeOf(setArcAcorn(ARC_FLAT_SCRIPT, id, ARC_CFG));
    expect(shape.arcPath?.enabled).toBe(true);
    expect(shape.arcPath?.segments).toHaveLength(1);
  });

  it("disable: arcPath=undefined, x/y restored", () => {
    const { id, enabled } = arcFixture();
    const shape = arcShapeOf(setArcAcorn(enabled, id, DISABLE_CFG));
    expect(shape.arcPath).toBeUndefined();
    expect(typeof shape.properties.x).toBe("number");
  });

  it("no-op when animation not found", () => {
    expect(setArcAcorn(ARC_FLAT_SCRIPT, "nope", ARC_CFG)).toBe(ARC_FLAT_SCRIPT);
  });
});

describe("updateArcSegmentInScript: acorn output correctness", () => {
  it("curviness update reflected in parsed shape", () => {
    const { id, enabled } = arcFixture();
    const shape = arcShapeOf(updateArcSegmentAcorn(enabled, id, 0, { curviness: 2 }));
    expect(shape.arcPath?.segments[0]?.curviness).toBe(2);
  });

  it("no-op when index out of range", () => {
    const { id, enabled } = arcFixture();
    expect(updateArcSegmentAcorn(enabled, id, 99, { curviness: 2 })).toBe(enabled);
  });
});

describe("removeArcPathFromScript: acorn output correctness", () => {
  it("arcPath=undefined after removal", () => {
    const { id, enabled } = arcFixture();
    expect(arcShapeOf(removeArcAcorn(enabled, id)).arcPath).toBeUndefined();
  });
});

// ─── unrollDynamicAnimations correctness ──────────────────────────────────────

const UNROLL_LOOP_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  const items = ["#a", "#b"];
  for (let i = 0; i < items.length; i++) {
    tl.to(items[i], { opacity: 1, duration: 1 }, 0);
  }
`;

const UNROLL_FOREACH_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  ["#a", "#b"].forEach(function(sel) {
    tl.to(sel, { opacity: 1, duration: 2 }, 1);
  });
`;

const UNROLL_ELEMENTS = [
  {
    selector: "#hero",
    keyframes: [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ],
  },
  {
    selector: "#sub",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 200 } },
    ],
  },
];

function unrollId(script: string): string {
  const p = acornId(script);
  return p;
}

describe("unrollDynamicAnimations: acorn output correctness", () => {
  it("for-loop: loop replaced with individual tl.to() calls", () => {
    const id = unrollId(UNROLL_LOOP_SCRIPT);
    const out = unrollAcorn(UNROLL_LOOP_SCRIPT, id, UNROLL_ELEMENTS);
    expect(out).not.toBe(UNROLL_LOOP_SCRIPT);
    expect(out).toContain('tl.to("#hero"');
    expect(out).toContain('tl.to("#sub"');
    expect(out).not.toContain("for (");
  });

  it("forEach: loop replaced with individual tl.to() calls", () => {
    const id = unrollId(UNROLL_FOREACH_SCRIPT);
    const out = unrollAcorn(UNROLL_FOREACH_SCRIPT, id, UNROLL_ELEMENTS);
    expect(out).toContain('tl.to("#hero"');
    expect(out).not.toContain("forEach");
  });

  it("preserves duration and position from original tween", () => {
    const id = unrollId(UNROLL_LOOP_SCRIPT);
    const out = unrollAcorn(UNROLL_LOOP_SCRIPT, id, UNROLL_ELEMENTS);
    expect(out).toContain("duration: 1");
    expect(out).toContain("}, 0)");
  });

  it("no-op when animationId not found", () => {
    expect(unrollAcorn(UNROLL_LOOP_SCRIPT, "nope", UNROLL_ELEMENTS)).toBe(UNROLL_LOOP_SCRIPT);
  });
});
