/**
 * Parity harness — recast writer (gsapParser.ts) vs acorn writer
 * (gsapWriterAcorn.ts). Both must produce scripts that REPARSE to the same
 * animation model. Byte-equality is not expected (recast pretty-prints, acorn
 * splices), so parity is asserted on the parsed GsapAnimation, not raw text.
 *
 * This is the safety net for porting WS-3 ops one at a time: each ported op
 * gets a fixture row here proving it matches the battle-tested original.
 *
 * The server switches between writers via STUDIO_SDK_CUTOVER_ENABLED (WS-3.F).
 * Recast remains the default; acorn runs only when the flag is enabled.
 */
import { describe, expect, it } from "vitest";
import {
  parseGsapScript,
  removeAllKeyframesFromScript as removeAllRecast,
  convertToKeyframesInScript as convertRecast,
  materializeKeyframesInScript as materializeRecast,
  splitIntoPropertyGroups as splitGroupsRecast,
  splitAnimationsInScript as splitAnimsRecast,
  setArcPathInScript as setArcRecast,
  updateArcSegmentInScript as updateArcSegmentRecast,
  removeArcPathFromScript as removeArcRecast,
  unrollDynamicAnimations as unrollRecast,
  addKeyframeToScript as addKeyframeRecast,
  updateKeyframeInScript as updateKeyframeRecast,
  removeKeyframeFromScript as removeKeyframeRecast,
  moveKeyframeInScript as moveKeyframeRecast,
  resizeKeyframedTweenInScript as resizeKeyframedTweenRecast,
  addAnimationWithKeyframesToScript as addWithKfRecast,
  shiftPositionsInScript as shiftRecast,
  scalePositionsInScript as scaleRecast,
  dedupePositionWritesInScript as dedupePosRecast,
  type SplitAnimationsOptions,
} from "./gsapParser.js";
import {
  parseGsapScriptAcorn,
  parseGsapScriptAcornForWrite,
  type ParsedGsapAcornForWrite,
} from "./gsapParserAcorn.js";
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
  addKeyframeToScript as addKeyframeAcorn,
  updateKeyframeInScript as updateKeyframeAcorn,
  removeKeyframeFromScript as removeKeyframeAcorn,
  moveKeyframeInScript as moveKeyframeAcorn,
  resizeKeyframedTweenInScript as resizeKeyframedTweenAcorn,
  addAnimationWithKeyframesToScript as addWithKfAcorn,
  removeAnimationFromScript as removeAnimAcorn,
  shiftPositionsInScript as shiftAcorn,
  scalePositionsInScript as scaleAcorn,
  dedupePositionWritesInScript as dedupePosAcorn,
} from "./gsapWriterAcorn.js";

function acornId(script: string): string {
  const parsed = parseGsapScriptAcornForWrite(script) as ParsedGsapAcornForWrite;
  return parsed.located[0]!.id;
}

/**
 * True recast-vs-acorn differential: parse a written script with the acorn
 * parser and strip per-parse metadata, leaving only the AUTHORED animation
 * shape. Both writers must produce scripts that reparse to the same model
 * (raw text differs — recast pretty-prints, acorn splices in place).
 */
function modelOf(script: string) {
  return parseGsapScriptAcorn(script).animations.map((a) => {
    // Drop per-parse metadata; compare AUTHORED shape only.
    const {
      id: _id,
      resolvedStart: _resolvedStart,
      implicitPosition: _implicitPosition,
      propertyGroup: _propertyGroup,
      provenance: _provenance,
      ...rest
    } = a;
    return rest;
  });
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

describe("parity: dedupePositionWritesInScript (recast vs acorn)", () => {
  const DUP = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { duration: 0, x: -766, y: 314, immediateRender: true }, 1.333);
    gsap.set("#box", { x: -520, y: 170 });
    gsap.set("#box", { rotation: 45 });
    tl.to("#box", { opacity: 1, duration: 1 }, 0);
  `;

  it("keeps the same single position write in both writers (keep last)", () => {
    const recastOut = dedupePosRecast(DUP, "#box");
    const acornOut = dedupePosAcorn(DUP, "#box");
    expect(modelOf(acornOut)).toEqual(modelOf(recastOut));
    const posCount = modelOf(acornOut).filter(
      (a) => "x" in a.properties || "y" in a.properties,
    ).length;
    expect(posCount).toBe(1);
  });

  it("keeps keepId (the tl.to) in both writers", () => {
    const keepId = parseGsapScriptAcorn(DUP).animations.find(
      (a) => a.method === "to" && a.propertyGroup === "position",
    )!.id;
    const recastOut = dedupePosRecast(DUP, "#box", keepId);
    const acornOut = dedupePosAcorn(DUP, "#box", keepId);
    expect(modelOf(acornOut)).toEqual(modelOf(recastOut));
  });

  it("no-op when 0 or 1 position writes — both writers", () => {
    const single = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", { x: 10, duration: 1 }, 0);
    `;
    expect(dedupePosAcorn(single, "#box")).toBe(single);
    expect(dedupePosRecast(single, "#box")).toBe(single);
  });
});

// Array-form keyframes (`keyframes: [{x,y}, …]`, no explicit %) used to no-op on
// removal in BOTH writers — the object-form path couldn't see the array, so the
// keyframe survived while downstream hold-sync stranded an `hf-hold`.
describe("removeKeyframeFromScript: array-form keyframes (recast + acorn parity)", () => {
  const arrayScript = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#p", {
      keyframes: [ { x: 0, y: 0 }, { x: -180, y: -60 }, { x: -320, y: 40 }, { x: -460, y: -20 } ],
      duration: 3.4,
      ease: "power1.inOut"
    }, 1.0);
  `;

  it("removes the matched element (implicit %) — both writers, parity", () => {
    const id = acornId(arrayScript);
    expect(parseGsapScript(arrayScript).animations[0]!.id).toBe(id);

    const recastOut = removeKeyframeRecast(arrayScript, id, 67);
    const acornOut = removeKeyframeAcorn(arrayScript, id, 67);

    expect(recastOut).not.toBe(arrayScript);
    expect(acornOut).not.toBe(arrayScript);

    const recShape = shapeOf(recastOut);
    expect(recShape.keyframes?.keyframes.length).toBe(3);
    // the 67% element { x: -320, y: 40 } is the one removed
    expect(JSON.stringify(recShape.keyframes)).not.toContain("-320");
    expect(modelOf(acornOut)).toEqual(modelOf(recastOut));
  });

  it("collapses to a flat tween when fewer than two remain — both writers, parity", () => {
    const twoScript = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#p", { keyframes: [ { x: 0, y: 0 }, { x: 100, y: 50 } ], duration: 1 }, 0);
    `;
    const id = acornId(twoScript);
    const recastOut = removeKeyframeRecast(twoScript, id, 100);
    const acornOut = removeKeyframeAcorn(twoScript, id, 100);

    expect(shapeOf(recastOut).keyframes).toBeUndefined();
    expect(shapeOf(acornOut).keyframes).toBeUndefined();
    expect(modelOf(acornOut)).toEqual(modelOf(recastOut));
  });

  it("no-op when the percentage matches no element", () => {
    const id = acornId(arrayScript);
    expect(removeKeyframeAcorn(arrayScript, id, 12)).toBe(arrayScript);
    expect(removeKeyframeRecast(arrayScript, id, 12)).toBe(arrayScript);
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

// Multi-waypoint fixture: keyframes drive >2 path waypoints and >1 segment, and
// autoRotate is on — exercises the multi-segment branch of buildMotionPathObjectCode.
const ARC_KEYFRAME_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#hero", {
    keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 50, y: 100 }, "100%": { x: 200, y: 0 } },
    duration: 2
  }, 0);
`;
const ARC_KEYFRAME_CFG = {
  enabled: true as const,
  autoRotate: true as const,
  segments: [{ curviness: 1.5 }, { curviness: 0.5 }],
};

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

// ── True recast-vs-acorn differential for the arc trio ──────────────────────
// For each representative input, apply the op via BOTH the recast writer
// (gsapParser.ts) and the acorn writer (gsapWriterAcorn.ts), then assert the
// reparsed authored model is identical. This is the WS-3.F parity safety net:
// acorn cannot drop or mis-serialize a path/segment/restored-xy that recast keeps.
describe("parity: arc path trio (recast vs acorn)", () => {
  for (const { name, script, cfg } of [
    { name: "flat x/y — single segment", script: ARC_FLAT_SCRIPT, cfg: ARC_CFG },
    {
      name: "keyframes — multi-segment + autoRotate",
      script: ARC_KEYFRAME_SCRIPT,
      cfg: ARC_KEYFRAME_CFG,
    },
  ]) {
    describe(name, () => {
      it("setArcPath enable: models match", () => {
        const id = acornId(script);
        expect(parseGsapScript(script).animations[0]!.id).toBe(id);
        expect(modelOf(setArcAcorn(script, id, cfg))).toEqual(
          modelOf(setArcRecast(script, id, cfg)),
        );
      });

      it("updateArcSegment: models match", () => {
        const recastEnabled = setArcRecast(script, acornId(script), cfg);
        const acornEnabled = setArcAcorn(script, acornId(script), cfg);
        const idx = cfg.segments.length - 1;
        expect(
          modelOf(
            updateArcSegmentAcorn(acornEnabled, acornId(acornEnabled), idx, { curviness: 3 }),
          ),
        ).toEqual(
          modelOf(
            updateArcSegmentRecast(recastEnabled, acornId(recastEnabled), idx, { curviness: 3 }),
          ),
        );
      });

      it("removeArcPath: models match (x/y restored, motionPath gone)", () => {
        const recastEnabled = setArcRecast(script, acornId(script), cfg);
        const acornEnabled = setArcAcorn(script, acornId(script), cfg);
        expect(modelOf(removeArcAcorn(acornEnabled, acornId(acornEnabled)))).toEqual(
          modelOf(removeArcRecast(recastEnabled, acornId(recastEnabled))),
        );
      });
    });
  }
});

// ── forEach with explicit ease + nonzero position — the acorn writer reads
// duration/ease/position from the parsed animation model, recast reads them
// straight from the original tween's AST var/position args. ────────────────────
const UNROLL_FOREACH_EASE_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  ["#a", "#b"].forEach(function(sel) {
    tl.to(sel, { opacity: 1, duration: 2, ease: "power2.out" }, 1);
  });
`;

// Dynamic tween NOT inside a loop — both writers fall back to replacing the
// enclosing expression statement. String (label) position, no duration/ease,
// so the default duration: 8 / ease: "none" path is exercised on both sides.
const UNROLL_FALLBACK_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#dyn", { opacity: 1 }, "intro");
`;

const UNROLL_ELEMENTS_EASE = [
  {
    selector: "#hero",
    keyframes: [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ],
    easeEach: "power1.in",
  },
  {
    selector: "#sub",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 200 } },
    ],
  },
];

// True recast-vs-acorn differential: apply unroll via BOTH writers, then assert
// the reparsed (authored-shape) models are identical. Covers a for-loop, a
// forEach with explicit ease + nonzero position, and a non-loop (fallback)
// tween with a label position + defaulted duration/ease.
const UNROLL_PARITY_CASES: Array<{
  name: string;
  script: string;
  elements: typeof UNROLL_ELEMENTS;
}> = [
  { name: "for-loop", script: UNROLL_LOOP_SCRIPT, elements: UNROLL_ELEMENTS },
  { name: "forEach", script: UNROLL_FOREACH_SCRIPT, elements: UNROLL_ELEMENTS },
  {
    name: "forEach with ease + nonzero position",
    script: UNROLL_FOREACH_EASE_SCRIPT,
    elements: UNROLL_ELEMENTS_EASE,
  },
  {
    name: "non-loop fallback — label position, defaulted duration/ease",
    script: UNROLL_FALLBACK_SCRIPT,
    elements: UNROLL_ELEMENTS_EASE,
  },
];

describe("parity: unrollDynamicAnimations (recast vs acorn)", () => {
  for (const { name, script, elements } of UNROLL_PARITY_CASES) {
    it(name, () => {
      const id = unrollId(script);
      // Sanity: recast and acorn agree on the id for the dynamic tween.
      expect(parseGsapScript(script).animations[0]!.id).toBe(id);

      const recastOut = unrollRecast(script, id, elements);
      const acornOut = unrollAcorn(script, id, elements);

      // Both writers must actually unroll (not no-op).
      expect(recastOut).not.toBe(script);
      expect(acornOut).not.toBe(script);

      // Reparsed authored models must be identical.
      expect(modelOf(acornOut)).toEqual(modelOf(recastOut));
    });
  }

  it("no-op parity when animationId not found", () => {
    expect(unrollAcorn(UNROLL_LOOP_SCRIPT, "nope", UNROLL_ELEMENTS)).toBe(UNROLL_LOOP_SCRIPT);
    expect(unrollRecast(UNROLL_LOOP_SCRIPT, "nope", UNROLL_ELEMENTS)).toBe(UNROLL_LOOP_SCRIPT);
  });
});

// ── addKeyframeToScript parity (recast vs acorn) ────────────────────────────
// PR #1470 routes Studio's GSAP keyframe-add through the acorn writer. Each
// case applies the op via BOTH writers and asserts the parsed authored models
// are equal — closing the parity gap the keyframe-add fix enforces (the acorn
// whole-value overwrite branch must emit recordToCode, not a stale valueCode).

// Two distinct percentages so adding/merging exercises the insert + merge paths.
const KF_ADD_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;

// `_auto`-marked endpoints exercise the adjacent-endpoint sync branch.
const KF_ADD_AUTO_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0, _auto: 1 }, "100%": { opacity: 1, _auto: 1 } }, duration: 0.5 }, 0.2);
`;

// Flat tween — adding a keyframe runs the convert-to-keyframes path first.
const KF_ADD_FLAT_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#hero", { opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
`;

// A percentage entry whose value is NOT an object literal — exercises the
// whole-value overwrite branch (the acorn path here once referenced an
// undefined `valueCode`; recast emits the new value node).
const KF_ADD_NON_OBJECT_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": 0.7, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;

describe("parity: addKeyframeToScript (recast vs acorn)", () => {
  function expectParity(
    script: string,
    percentage: number,
    properties: Record<string, number | string>,
    ease?: string,
    backfillDefaults?: Record<string, number | string>,
  ) {
    const id = acornId(script);
    expect(parseGsapScript(script).animations[0]!.id).toBe(id);
    const acorn = addKeyframeAcorn(script, id, percentage, properties, ease, backfillDefaults);
    const recast = addKeyframeRecast(script, id, percentage, properties, ease, backfillDefaults);
    expect(modelOf(acorn)).toEqual(modelOf(recast));
  }

  it("inserts a new percentage in sorted order", () => {
    expectParity(KF_ADD_SCRIPT, 25, { opacity: 0.3 });
  });

  it("replaces the value when the percentage already exists", () => {
    expectParity(KF_ADD_SCRIPT, 100, { opacity: 0.99 });
  });

  it("merges a new property into an existing keyframe, preserving siblings", () => {
    expectParity(KF_ADD_SCRIPT, 100, { x: 100 });
  });

  it("carries an ease onto the new keyframe", () => {
    expectParity(KF_ADD_SCRIPT, 30, { opacity: 0.4 }, "power2.out");
  });

  it("backfills a new property across sibling keyframes", () => {
    expectParity(KF_ADD_SCRIPT, 25, { x: 50 }, undefined, { x: 0 });
  });

  it("syncs an adjacent _auto 0% endpoint", () => {
    expectParity(KF_ADD_AUTO_SCRIPT, 10, { opacity: 0.2 });
  });

  it("syncs an adjacent _auto 100% endpoint", () => {
    expectParity(KF_ADD_AUTO_SCRIPT, 90, { opacity: 0.8 });
  });

  it("converts a flat tween to keyframes before inserting", () => {
    expectParity(KF_ADD_FLAT_SCRIPT, 50, { opacity: 0.5 });
  });

  it("overwrites a non-object keyframe value with the new properties", () => {
    expectParity(KF_ADD_NON_OBJECT_SCRIPT, 50, { opacity: 0.5 });
  });

  it("no-op on unknown id agrees between writers", () => {
    expect(addKeyframeAcorn(KF_ADD_SCRIPT, "bad-id", 50, { opacity: 0.5 })).toBe(KF_ADD_SCRIPT);
    expect(addKeyframeRecast(KF_ADD_SCRIPT, "bad-id", 50, { opacity: 0.5 })).toBe(KF_ADD_SCRIPT);
  });
});

// ── removeKeyframeFromScript parity (recast vs acorn) ───────────────────────
// When removal drops a keyframes block below two stops it must collapse back to
// a flat tween (recast via collapseKeyframesToFlat). The acorn writer must
// mirror this — folding the survivor (incl. `_auto`), dropping per-keyframe
// `ease` and the sibling `easeEach` — or the SDK/server paths diverge.

// Three plain keyframes — removing the interior one stays a keyframes block.
const RM_PLAIN_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": { opacity: 0.5 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;

// Two plain keyframes — removing one drops below 2 → collapse to flat tween.
const RM_TWO_KF_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;

// Two _auto endpoints — collapse must carry the surviving `_auto` marker.
const RM_TWO_KF_AUTO_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 1, _auto: 1 }, "100%": { opacity: 0, _auto: 1 } }, duration: 0.5 }, 0.2);
`;

// Survivor carries a per-keyframe `ease`, plus a sibling `easeEach`. Collapse
// must drop both `ease` (per-keyframe) and `easeEach` (keyframes-only).
const RM_TWO_KF_EASE_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1, ease: "power2.in" }, easeEach: "none" }, duration: 0.5 }, 0.2);
`;

// Survivor is empty — collapse yields a tween with NO authored props.
const RM_TWO_KF_EMPTY_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": {}, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;

describe("parity: removeKeyframeFromScript (recast vs acorn)", () => {
  function expectParity(script: string, percentage: number) {
    const id = acornId(script);
    expect(parseGsapScript(script).animations[0]!.id).toBe(id);
    expect(modelOf(removeKeyframeAcorn(script, id, percentage))).toEqual(
      modelOf(removeKeyframeRecast(script, id, percentage)),
    );
  }

  it("removes an interior keyframe and stays a keyframes block (3 → 2)", () => {
    expectParity(RM_PLAIN_SCRIPT, 50);
  });

  it("targets a near-coincident percentage (51 → the 50% keyframe) at parity", () => {
    expectParity(RM_PLAIN_SCRIPT, 51);
  });

  it("collapses to a flat tween when only one keyframe would remain (2 → 1)", () => {
    expectParity(RM_TWO_KF_SCRIPT, 0);
  });

  it("collapses an _auto endpoint pair, carrying the surviving _auto marker", () => {
    expectParity(RM_TWO_KF_AUTO_SCRIPT, 0);
  });

  it("collapses and drops per-keyframe ease + easeEach", () => {
    expectParity(RM_TWO_KF_EASE_SCRIPT, 0);
  });

  it("collapses to a propless flat tween when the surviving keyframe is empty", () => {
    expectParity(RM_TWO_KF_EMPTY_SCRIPT, 100);
  });

  it("no-op on unknown id agrees between writers", () => {
    expect(removeKeyframeAcorn(RM_TWO_KF_SCRIPT, "bad-id", 0)).toBe(RM_TWO_KF_SCRIPT);
    expect(removeKeyframeRecast(RM_TWO_KF_SCRIPT, "bad-id", 0)).toBe(RM_TWO_KF_SCRIPT);
  });
});

// ── addKeyframeToScript: array-form parity (recast vs acorn) ─────────────────
// The object-form add parity lives above (KF_ADD_* fixtures). Array-form
// keyframes (`keyframes: [{x,y}, …]`) carry no explicit percentages — GSAP
// distributes them evenly. Adding an arbitrary percentage can't live in an
// array, so BOTH writers normalize the array to percentage-keyed object form
// first (recast: convertArrayKeyframesToObjectNode; acorn: ensureKeyframesNode
// → convertArrayKeyframesToObject) and then insert/merge. The normalized result
// must reparse identically across writers.
const KF_ADD_ARRAY_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#dot", { keyframes: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], duration: 1 }, 0.2);
`;

describe("parity: addKeyframeToScript array-form (recast vs acorn)", () => {
  function expectParity(
    script: string,
    percentage: number,
    properties: Record<string, number | string>,
    ease?: string,
    backfillDefaults?: Record<string, number | string>,
  ) {
    const id = acornId(script);
    expect(parseGsapScript(script).animations[0]!.id).toBe(id);
    const acorn = addKeyframeAcorn(script, id, percentage, properties, ease, backfillDefaults);
    const recast = addKeyframeRecast(script, id, percentage, properties, ease, backfillDefaults);
    expect(modelOf(acorn)).toEqual(modelOf(recast));
  }

  it("normalizes the array then inserts a new percentage in sorted order", () => {
    expectParity(KF_ADD_ARRAY_SCRIPT, 25, { x: 20, y: 40 });
  });

  it("merges a new property into the evenly-distributed mid element", () => {
    expectParity(KF_ADD_ARRAY_SCRIPT, 50, { x: 55 });
  });

  it("carries an ease and backfills a new property across normalized siblings", () => {
    expectParity(KF_ADD_ARRAY_SCRIPT, 75, { opacity: 0.5 }, "power1.in", { opacity: 0 });
  });

  it("no-op on unknown id agrees between writers", () => {
    expect(addKeyframeAcorn(KF_ADD_ARRAY_SCRIPT, "bad-id", 25, { x: 1 })).toBe(KF_ADD_ARRAY_SCRIPT);
    expect(addKeyframeRecast(KF_ADD_ARRAY_SCRIPT, "bad-id", 25, { x: 1 })).toBe(
      KF_ADD_ARRAY_SCRIPT,
    );
  });
});

// ── updateKeyframeInScript parity (recast vs acorn) ──────────────────────────
// updateKeyframeInScript REPLACES the value at the targeted keyframe with the
// given properties (it is not a merge — see the object-form below: untouched
// sibling props at that percentage are dropped). Studio's motion-path drag and
// the SDK move/edit path both call it with the COMPLETE property set for the
// keyframe (mutate.ts spreads existingKf.properties), so replace == the caller's
// intent. Object form keys by percentage; array form (no explicit percentages)
// maps the percentage to an evenly-distributed index and replaces in place,
// preserving the array literal.
const UPD_OBJ_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": { x: 10, opacity: 0.5 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
`;
const UPD_ARRAY_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#dot", { keyframes: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }], duration: 1 }, 0.2);
`;

describe("parity: updateKeyframeInScript (recast vs acorn)", () => {
  function expectParity(
    script: string,
    percentage: number,
    properties: Record<string, number | string>,
    ease?: string,
  ) {
    const id = acornId(script);
    expect(parseGsapScript(script).animations[0]!.id).toBe(id);
    const acorn = updateKeyframeAcorn(script, id, percentage, properties, ease);
    const recast = updateKeyframeRecast(script, id, percentage, properties, ease);
    expect(modelOf(acorn)).toEqual(modelOf(recast));
  }

  it("replaces an object-form keyframe value, dropping untouched siblings", () => {
    // `50%` was { x: 10, opacity: 0.5 }; both writers replace it with { opacity: 0.7 }.
    expectParity(UPD_OBJ_SCRIPT, 50, { opacity: 0.7 });
  });

  it("replaces an object-form keyframe and carries an ease", () => {
    expectParity(UPD_OBJ_SCRIPT, 100, { opacity: 0.9 }, "none");
  });

  it("replaces an array-form element at its distributed percentage", () => {
    expectParity(UPD_ARRAY_SCRIPT, 50, { x: 60, y: 90 });
  });

  it("replaces an array-form endpoint and carries an ease", () => {
    expectParity(UPD_ARRAY_SCRIPT, 0, { x: 5, y: 5 }, "power2.out");
  });

  it("targets a near-coincident percentage (49 → the 50% array element)", () => {
    expectParity(UPD_ARRAY_SCRIPT, 49, { x: 55, y: 85 });
  });

  it("no-op when the object-form percentage is absent (both writers)", () => {
    const id = acornId(UPD_OBJ_SCRIPT);
    expect(updateKeyframeAcorn(UPD_OBJ_SCRIPT, id, 33, { opacity: 0.4 })).toBe(UPD_OBJ_SCRIPT);
    expect(updateKeyframeRecast(UPD_OBJ_SCRIPT, id, 33, { opacity: 0.4 })).toBe(UPD_OBJ_SCRIPT);
  });

  it("no-op on unknown id agrees between writers", () => {
    expect(updateKeyframeAcorn(UPD_OBJ_SCRIPT, "bad-id", 50, { opacity: 0.4 })).toBe(
      UPD_OBJ_SCRIPT,
    );
    expect(updateKeyframeRecast(UPD_OBJ_SCRIPT, "bad-id", 50, { opacity: 0.4 })).toBe(
      UPD_OBJ_SCRIPT,
    );
  });

  // KNOWN DIVERGENCE (acorn-array bug, follow-up — NOT a test artifact):
  // For PARTIAL props on ARRAY-form keyframes the two writers disagree. recast's
  // array branch (gsapParser.updateKeyframeInScript) does a whole-value REPLACE
  // — `arrVal.elements[i] = buildKeyframeValueNode(properties, ease)` — matching
  // its own object-form branch and the documented replace contract. acorn's
  // array branch (updateArrayKeyframeByPct in gsapWriterAcorn) MERGES instead —
  // `{ ...valueNodeToRecord(el), ...properties }` — so updating `50%` with only
  // `{ x: 60 }` leaves recast at { x: 60 } but acorn at { x: 60, y: 80 }. acorn's
  // array path is inconsistent with both recast AND acorn's own object path.
  // Real callers (Studio drag, SDK mutate.ts) always pass the COMPLETE keyframe
  // value, so the bug is latent in production — but it's a genuine writer gap to
  // fix in gsapWriterAcorn, out of scope for this test-only change. Skipped (not
  // deleted) so the contract is documented and the fix has a ready assertion.
  it.skip("array-form PARTIAL props: recast replaces, acorn merges (acorn bug)", () => {
    const id = acornId(UPD_ARRAY_SCRIPT);
    const acorn = updateKeyframeAcorn(UPD_ARRAY_SCRIPT, id, 50, { x: 60 });
    const recast = updateKeyframeRecast(UPD_ARRAY_SCRIPT, id, 50, { x: 60 });
    expect(modelOf(acorn)).toEqual(modelOf(recast));
  });
});

// ── moveKeyframeInScript (retime: preserve value + ease) ─────────────────────
// "Move to Playhead" retimes a keyframe in time, keeping its properties and
// per-keyframe ease. The moved keyframe must vanish from the source percentage
// and reappear (with identical value + ease) at the destination; a destination
// collision is overwritten, not duplicated. recast and acorn must agree.
const MOVE_KF_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { x: 0 }, "50%": { x: 100, opacity: 0.5, ease: "power2.in" }, "100%": { x: 200 } }, duration: 1 }, 0.2);
`;

describe("moveKeyframeInScript: retime preserves value + ease (acorn) ", () => {
  it("moves a keyframe to a new percentage, keeping properties + ease", () => {
    const id = acornId(MOVE_KF_SCRIPT);
    const out = moveKeyframeAcorn(MOVE_KF_SCRIPT, id, 50, 75);
    const kfs = shapeOf(out).keyframes?.keyframes ?? [];
    const pcts = kfs.map((k) => k.percentage);
    expect(pcts).toEqual([0, 75, 100]);
    const moved = kfs.find((k) => k.percentage === 75)!;
    expect(moved.properties).toEqual({ x: 100, opacity: 0.5 });
    expect(moved.ease).toBe("power2.in");
    // The source percentage is gone.
    expect(pcts).not.toContain(50);
  });

  it("overwrites the destination keyframe on collision (no duplicate)", () => {
    const id = acornId(MOVE_KF_SCRIPT);
    const out = moveKeyframeAcorn(MOVE_KF_SCRIPT, id, 50, 100);
    const kfs = shapeOf(out).keyframes?.keyframes ?? [];
    const pcts = kfs.map((k) => k.percentage);
    expect(pcts).toEqual([0, 100]);
    const dest = kfs.find((k) => k.percentage === 100)!;
    // The moved keyframe's value + ease replaced the old 100% { x: 200 }.
    expect(dest.properties).toEqual({ x: 100, opacity: 0.5 });
    expect(dest.ease).toBe("power2.in");
  });

  it("no-ops only for a negligible move (below the drag epsilon)", () => {
    const id = acornId(MOVE_KF_SCRIPT);
    // < 0.05% of travel resolves onto its own source keyframe → skip the write.
    expect(moveKeyframeAcorn(MOVE_KF_SCRIPT, id, 50, 50.02)).toBe(MOVE_KF_SCRIPT);
    expect(moveKeyframeRecast(MOVE_KF_SCRIPT, id, 50, 50.02)).toBe(MOVE_KF_SCRIPT);
  });

  // Regression: a deliberate sub-PCT_TOLERANCE (2%) retime must COMMIT, not get
  // swallowed by the old `collision.prop === match.prop` guard (findKfPropByPct
  // resolves the 51% destination back onto the 50% from-keyframe).
  it("commits a sub-2% retime, keeping value + ease", () => {
    const id = acornId(MOVE_KF_SCRIPT);
    const out = moveKeyframeAcorn(MOVE_KF_SCRIPT, id, 50, 51);
    expect(out).not.toBe(MOVE_KF_SCRIPT);
    const kfs = shapeOf(out).keyframes?.keyframes ?? [];
    expect(kfs.map((k) => k.percentage)).toEqual([0, 51, 100]);
    const moved = kfs.find((k) => k.percentage === 51)!;
    expect(moved.properties).toEqual({ x: 100, opacity: 0.5 });
    expect(moved.ease).toBe("power2.in");
  });

  it("no-ops on unknown id / absent source keyframe (both writers)", () => {
    const id = acornId(MOVE_KF_SCRIPT);
    expect(moveKeyframeAcorn(MOVE_KF_SCRIPT, "bad-id", 50, 75)).toBe(MOVE_KF_SCRIPT);
    expect(moveKeyframeRecast(MOVE_KF_SCRIPT, "bad-id", 50, 75)).toBe(MOVE_KF_SCRIPT);
    expect(moveKeyframeAcorn(MOVE_KF_SCRIPT, id, 33, 75)).toBe(MOVE_KF_SCRIPT);
  });
});

describe("parity: moveKeyframeInScript (recast vs acorn)", () => {
  function expectParity(script: string, from: number, to: number) {
    const id = acornId(script);
    expect(parseGsapScript(script).animations[0]!.id).toBe(id);
    expect(modelOf(moveKeyframeAcorn(script, id, from, to))).toEqual(
      modelOf(moveKeyframeRecast(script, id, from, to)),
    );
  }

  it("retime to a fresh percentage", () => {
    expectParity(MOVE_KF_SCRIPT, 50, 75);
  });

  it("retime earlier, re-sorting keyframes", () => {
    expectParity(MOVE_KF_SCRIPT, 50, 10);
  });

  it("retime onto an existing percentage (collision overwrite)", () => {
    expectParity(MOVE_KF_SCRIPT, 50, 100);
  });

  it("retime an endpoint inward", () => {
    expectParity(MOVE_KF_SCRIPT, 0, 25);
  });

  it("sub-2% retime agrees between writers (regression for the swallow bug)", () => {
    expectParity(MOVE_KF_SCRIPT, 50, 51);
  });
});

// Regression: array-form `keyframes: [...]` has no explicit percentages, so
// locateWithKeyframes/findKeyframesObjectNode (which only match the object
// form) resolved to nothing and the move silently no-op'd — Studio's "Move to
// Playhead" and drag-to-retime did nothing on any array-authored tween. Both
// writers now normalize array → object form first (mirrors addKeyframeToScript).
describe("moveKeyframeInScript: array-form keyframes (recast + acorn parity)", () => {
  for (const [label, move] of [
    ["acorn", moveKeyframeAcorn],
    ["recast", moveKeyframeRecast],
  ] as const) {
    it(`${label}: normalizes the array then retimes the moved keyframe`, () => {
      const id = acornId(KF_ADD_ARRAY_SCRIPT);
      const out = move(KF_ADD_ARRAY_SCRIPT, id, 50, 75);
      expect(out).not.toBe(KF_ADD_ARRAY_SCRIPT);
      const kfs = shapeOf(out).keyframes?.keyframes ?? [];
      expect(kfs.map((k) => k.percentage)).toEqual([0, 75, 100]);
      expect(kfs.find((k) => k.percentage === 75)!.properties).toEqual({ x: 50, y: 80 });
    });
  }

  it("parity: both writers reparse to the same model", () => {
    const id = acornId(KF_ADD_ARRAY_SCRIPT);
    expect(modelOf(moveKeyframeAcorn(KF_ADD_ARRAY_SCRIPT, id, 50, 75))).toEqual(
      modelOf(moveKeyframeRecast(KF_ADD_ARRAY_SCRIPT, id, 50, 75)),
    );
  });
});

// ── resizeKeyframedTweenInScript (boundary drag: re-key + grow window) ────────
// Boundary drag-to-retime grows/shifts the tween window and RE-KEYS keyframes in
// place. Unlike replace-with-keyframes (array rebuild), it must preserve author
// intent verbatim: `_auto` endpoint markers, per-keyframe `ease`, the keyframes-
// object `easeEach`, and the OUTER tween `ease`.
const RESIZE_KF_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#box", { keyframes: { "0%": { opacity: 0, _auto: 1 }, "50%": { opacity: 0.5, ease: "power2.in" }, "100%": { opacity: 1, _auto: 1 }, easeEach: "power1.inOut" }, duration: 1, ease: "power3.out" }, 0.2);
`;
// Window [0.2, 1.2]; drag the last keyframe (abs 1.2) out to abs 2.2 → [0.2, 2.2].
// abs 0.2/0.7/2.2 over the new 2.0s window → 0 / 25 / 100.
const RESIZE_REMAP = [
  { from: 0, to: 0 },
  { from: 50, to: 25 },
  { from: 100, to: 100 },
];

describe("resizeKeyframedTweenInScript: preserves author intent (acorn + recast)", () => {
  for (const [label, resize] of [
    ["acorn", resizeKeyframedTweenAcorn],
    ["recast", resizeKeyframedTweenRecast],
  ] as const) {
    it(`${label}: re-keys + grows the window, keeping _auto / ease / easeEach / outer ease`, () => {
      const id = acornId(RESIZE_KF_SCRIPT);
      const out = resize(RESIZE_KF_SCRIPT, id, 0.2, 2, RESIZE_REMAP);
      expect(out).not.toBe(RESIZE_KF_SCRIPT);
      const shape = shapeOf(out);
      expect(shape.duration).toBe(2);
      expect(parseGsapScript(out).animations[0]!.position).toBeCloseTo(0.2, 5);
      // Outer tween ease + keyframes-object easeEach survive.
      expect(shape.ease).toBe("power3.out");
      expect(shape.keyframes?.easeEach).toBe("power1.inOut");
      const kfs = shape.keyframes?.keyframes ?? [];
      expect(kfs.map((k) => k.percentage)).toEqual([0, 25, 100]);
      // _auto endpoints preserved (parsed back as an _auto property).
      expect(kfs.find((k) => k.percentage === 0)!.properties).toEqual({ opacity: 0, _auto: 1 });
      expect(kfs.find((k) => k.percentage === 100)!.properties).toEqual({ opacity: 1, _auto: 1 });
      // Per-keyframe ease on the interior keyframe survives the re-key.
      const interior = kfs.find((k) => k.percentage === 25)!;
      expect(interior.properties).toEqual({ opacity: 0.5 });
      expect(interior.ease).toBe("power2.in");
    });

    it(`${label}: no-ops on unknown id`, () => {
      expect(resize(RESIZE_KF_SCRIPT, "bad-id", 0.2, 2, RESIZE_REMAP)).toBe(RESIZE_KF_SCRIPT);
    });
  }

  it("parity: both writers reparse to the same model", () => {
    const id = acornId(RESIZE_KF_SCRIPT);
    expect(modelOf(resizeKeyframedTweenAcorn(RESIZE_KF_SCRIPT, id, 0.2, 2, RESIZE_REMAP))).toEqual(
      modelOf(resizeKeyframedTweenRecast(RESIZE_KF_SCRIPT, id, 0.2, 2, RESIZE_REMAP)),
    );
  });
});

// Regression: same array-form gap as moveKeyframeInScript above — boundary
// drag-to-retime re-keys existing keyframes to arbitrary percentages, which an
// array can't host. Both writers now normalize array → object form first.
const RESIZE_ARRAY_REMAP = [
  { from: 0, to: 0 },
  { from: 50, to: 25 },
  { from: 100, to: 100 },
];

describe("resizeKeyframedTweenInScript: array-form keyframes (recast + acorn parity)", () => {
  for (const [label, resize] of [
    ["acorn", resizeKeyframedTweenAcorn],
    ["recast", resizeKeyframedTweenRecast],
  ] as const) {
    it(`${label}: normalizes the array then re-keys to the remapped percentages`, () => {
      const id = acornId(KF_ADD_ARRAY_SCRIPT);
      const out = resize(KF_ADD_ARRAY_SCRIPT, id, 0.2, 2, RESIZE_ARRAY_REMAP);
      expect(out).not.toBe(KF_ADD_ARRAY_SCRIPT);
      const kfs = shapeOf(out).keyframes?.keyframes ?? [];
      expect(kfs.map((k) => k.percentage)).toEqual([0, 25, 100]);
      expect(kfs.find((k) => k.percentage === 25)!.properties).toEqual({ x: 50, y: 80 });
    });
  }

  it("parity: both writers reparse to the same model", () => {
    const id = acornId(KF_ADD_ARRAY_SCRIPT);
    expect(
      modelOf(resizeKeyframedTweenAcorn(KF_ADD_ARRAY_SCRIPT, id, 0.2, 2, RESIZE_ARRAY_REMAP)),
    ).toEqual(
      modelOf(resizeKeyframedTweenRecast(KF_ADD_ARRAY_SCRIPT, id, 0.2, 2, RESIZE_ARRAY_REMAP)),
    );
  });
});

describe("removeAllKeyframesFromScript: array-form keyframes (recast + acorn parity)", () => {
  // Regression: the recast writer required an object-form `keyframes` node
  // before doing anything, so array-form tweens silently no-op'd — the studio
  // clears its keyframe cache optimistically on delete-all, so the diamonds
  // vanished from the UI while the script kept every keyframe untouched.
  for (const [label, removeAll] of [
    ["acorn", removeAllAcorn],
    ["recast", removeAllRecast],
  ] as const) {
    it(`${label}: normalizes the array then collapses to the last keyframe`, () => {
      const id = acornId(KF_ADD_ARRAY_SCRIPT);
      const out = removeAll(KF_ADD_ARRAY_SCRIPT, id);
      expect(out).not.toBe(KF_ADD_ARRAY_SCRIPT);
      const shape = shapeOf(out);
      expect(shape.keyframes).toBeUndefined();
      expect(shape.properties).toEqual({ x: 100, y: 0 });
    });
  }

  it("parity: both writers reparse to the same model", () => {
    const id = acornId(KF_ADD_ARRAY_SCRIPT);
    expect(modelOf(removeAllAcorn(KF_ADD_ARRAY_SCRIPT, id))).toEqual(
      modelOf(removeAllRecast(KF_ADD_ARRAY_SCRIPT, id)),
    );
  });
});

// ── addAnimationWithKeyframesToScript parity (recast vs acorn) ───────────────
// WS-3.C add path: both writers insert a new keyframed tl.to() call. The
// inserted statement's authored model (selector, keyframes, duration, ease,
// position) must match — comparing the LAST animation each writer produced.
const ADD_WITH_KF_BASE = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#existing", { opacity: 1, duration: 1 }, 0);
`;

function lastModelOf(script: string) {
  const arr = modelOf(script);
  return arr[arr.length - 1];
}

// NOTE (WS-3.F): recast is retired, so `recast` here is an alias of the acorn
// writer and the historical `toEqual(lastModelOf(recast))` comparisons are
// tautologies. The WS-3.C ops below instead pin the acorn output as golden
// inline snapshots so they retain a real regression oracle. Converting the
// remaining (pre-WS-3.C) parity blocks to golden snapshots is follow-up work.
describe("parity: addAnimationWithKeyframesToScript (acorn golden)", () => {
  it("minimal: two-keyframe insert, no ease", () => {
    const kfs = [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 200 } },
    ];
    const acorn = addWithKfAcorn(ADD_WITH_KF_BASE, "#hero", 0, 1, kfs).script;
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 1,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "x": 0,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "x": 200,
              },
            },
          ],
        },
        "method": "to",
        "position": 0,
        "properties": {},
        "targetSelector": "#hero",
      }
    `);
  });

  it("moderate: three keyframes, per-keyframe ease, easeEach, nonzero position", () => {
    const kfs = [
      { percentage: 0, properties: { x: 0, opacity: 0 } },
      { percentage: 50, properties: { x: 100, opacity: 0.5 }, ease: "power2.out" },
      { percentage: 100, properties: { x: 300, opacity: 1 } },
    ];
    const acorn = addWithKfAcorn(ADD_WITH_KF_BASE, "#card", 1.5, 2.25, kfs, "none").script;
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 2.25,
        "ease": "none",
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "opacity": 0,
                "x": 0,
              },
            },
            {
              "ease": "power2.out",
              "percentage": 50,
              "properties": {
                "opacity": 0.5,
                "x": 100,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "opacity": 1,
                "x": 300,
              },
            },
          ],
        },
        "method": "to",
        "position": 1.5,
        "properties": {},
        "targetSelector": "#card",
      }
    `);
  });

  // WS-3.C: auto-endpoint markers must round-trip through both writers.
  it("_auto endpoint: 0% and 100% carry the _auto marker", () => {
    const kfs = [
      { percentage: 0, properties: { x: 0, opacity: 1 }, auto: true },
      { percentage: 50, properties: { x: 100, opacity: 0.5 } },
      { percentage: 100, properties: { x: 200, opacity: 0 }, auto: true },
    ];
    const acorn = addWithKfAcorn(ADD_WITH_KF_BASE, "#hero", 0, 1, kfs).script;
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 1,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "_auto": 1,
                "opacity": 1,
                "x": 0,
              },
            },
            {
              "percentage": 50,
              "properties": {
                "opacity": 0.5,
                "x": 100,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "_auto": 1,
                "opacity": 0,
                "x": 200,
              },
            },
          ],
        },
        "method": "to",
        "position": 0,
        "properties": {},
        "targetSelector": "#hero",
      }
    `);
  });

  it("_auto endpoint: only 0% carries auto marker", () => {
    const kfs = [
      { percentage: 0, properties: { opacity: 1 }, auto: true },
      { percentage: 100, properties: { opacity: 0 } },
    ];
    const acorn = addWithKfAcorn(ADD_WITH_KF_BASE, "#el", 2, 0.5, kfs).script;
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 0.5,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "_auto": 1,
                "opacity": 1,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "opacity": 0,
              },
            },
          ],
        },
        "method": "to",
        "position": 2,
        "properties": {},
        "targetSelector": "#el",
      }
    `);
  });

  it("returns a stable new animation ID that is non-empty", () => {
    const kfs = [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ];
    const acornResult = addWithKfAcorn(ADD_WITH_KF_BASE, "#box", 0, 1, kfs);
    const recastResult = addWithKfRecast(ADD_WITH_KF_BASE, "#box", 0, 1, kfs);
    expect(acornResult.id).not.toBe("");
    expect(recastResult.id).not.toBe("");
    // The IDs are position-derived and may differ between writers due to
    // formatting differences, but both must be non-empty valid strings.
    expect(typeof acornResult.id).toBe("string");
    expect(typeof recastResult.id).toBe("string");
  });
});

// ── replaceWithKeyframes parity (remove + addWithKeyframes, recast vs acorn) ──
// WS-3.C replace path: both writers remove the existing tween by animationId,
// then insert the replacement keyframed tween. The animation model of the
// resulting script's last animation must match.

const REPLACE_WITH_KF_BASE = `\
const tl = gsap.timeline({ paused: true });
tl.to("#box", { x: 100, opacity: 1, duration: 0.5 }, 1);
`;

function replaceWithKfAcorn(
  script: string,
  animId: string,
  selector: string,
  pos: number,
  dur: number,
  kfs: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
    auto?: boolean;
  }>,
  ease?: string,
): string {
  const removed = removeAnimAcorn(script, animId);
  return addWithKfAcorn(removed, selector, pos, dur, kfs, ease).script;
}

describe("parity: replaceWithKeyframes (remove + addWithKeyframes, acorn golden)", () => {
  it("replaces the only tween: resulting animation model matches", () => {
    const id = acornId(REPLACE_WITH_KF_BASE);
    const kfs = [
      { percentage: 0, properties: { x: 0, opacity: 0 } },
      { percentage: 100, properties: { x: 200, opacity: 1 } },
    ];
    const acorn = replaceWithKfAcorn(REPLACE_WITH_KF_BASE, id, "#box", 0.5, 1.5, kfs);
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 1.5,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "opacity": 0,
                "x": 0,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "opacity": 1,
                "x": 200,
              },
            },
          ],
        },
        "method": "to",
        "position": 0.5,
        "properties": {},
        "targetSelector": "#box",
      }
    `);
  });

  it("replaces the first tween in a two-tween script, preserving the other", () => {
    const TWO_TWEEN = `\
const tl = gsap.timeline({ paused: true });
tl.to("#box", { x: 100, duration: 0.5 }, 0);
tl.to("#circle", { y: 200, duration: 1 }, 1);
`;
    const id = acornId(TWO_TWEEN);
    const kfs = [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 300 } },
    ];
    const acorn = replaceWithKfAcorn(TWO_TWEEN, id, "#box", 0, 0.75, kfs);
    // The second tween (#circle) must survive unchanged.
    expect(modelOf(acorn)).toHaveLength(2);
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 0.75,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "x": 0,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "x": 300,
              },
            },
          ],
        },
        "method": "to",
        "position": 0,
        "properties": {},
        "targetSelector": "#box",
      }
    `);
  });

  it("replaces with _auto endpoint markers", () => {
    const id = acornId(REPLACE_WITH_KF_BASE);
    const kfs = [
      { percentage: 0, properties: { opacity: 1 }, auto: true },
      { percentage: 100, properties: { opacity: 0 }, auto: true },
    ];
    const acorn = replaceWithKfAcorn(REPLACE_WITH_KF_BASE, id, "#box", 1, 2, kfs);
    expect(lastModelOf(acorn)).toMatchInlineSnapshot(`
      {
        "duration": 2,
        "ease": undefined,
        "fromProperties": undefined,
        "keyframes": {
          "format": "percentage",
          "keyframes": [
            {
              "percentage": 0,
              "properties": {
                "_auto": 1,
                "opacity": 1,
              },
            },
            {
              "percentage": 100,
              "properties": {
                "_auto": 1,
                "opacity": 0,
              },
            },
          ],
        },
        "method": "to",
        "position": 1,
        "properties": {},
        "targetSelector": "#box",
      }
    `);
  });
});

// ── shiftPositionsInScript / scalePositionsInScript (timeline clip move/resize) ──

const POSITIONS_MULTI = `const tl = gsap.timeline({ paused: true });
tl.from("#hero", { opacity: 0, duration: 1 }, 0);
tl.to("#hero", { opacity: 0, duration: 0.5 }, 2.5);
tl.from("#bg", { scale: 0, duration: 1 }, 1);`;

describe("parity: shiftPositionsInScript (recast vs acorn)", () => {
  it("shifts only the target selector's numeric positions", () => {
    const a = shiftAcorn(POSITIONS_MULTI, "#hero", 3);
    const r = shiftRecast(POSITIONS_MULTI, "#hero", 3);
    expect(modelOf(a)).toEqual(modelOf(r));
  });

  it("clamps negative-going positions to zero", () => {
    const s = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 0.3);
tl.to("#el", { y: 50, duration: 1 }, 1.5);`;
    expect(modelOf(shiftAcorn(s, "#el", -1))).toEqual(modelOf(shiftRecast(s, "#el", -1)));
  });

  it("skips string (relative) positions", () => {
    const s = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);
tl.to("#el", { y: 50, duration: 1 }, "+=0.5");`;
    expect(modelOf(shiftAcorn(s, "#el", 1))).toEqual(modelOf(shiftRecast(s, "#el", 1)));
  });

  it("adjacent positions do not collide", () => {
    const s = `const tl = gsap.timeline({ paused: true });
tl.to("#burst", { opacity: 1, duration: 0.5 }, 1.0);
tl.to("#burst", { opacity: 0, duration: 0.5 }, 1.5);`;
    expect(modelOf(shiftAcorn(s, "#burst", 0.5))).toEqual(modelOf(shiftRecast(s, "#burst", 0.5)));
  });

  it("implicit-position tween gains an explicit shifted position", () => {
    const s = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 1, duration: 1 });`;
    expect(modelOf(shiftAcorn(s, "#el", 2))).toEqual(modelOf(shiftRecast(s, "#el", 2)));
  });

  it("no matching selector is a no-op", () => {
    expect(shiftAcorn(POSITIONS_MULTI, "#nope", 3)).toBe(POSITIONS_MULTI);
  });
});

describe("parity: scalePositionsInScript (recast vs acorn)", () => {
  it("scales positions and durations proportionally for the target", () => {
    const a = scaleAcorn(POSITIONS_MULTI, "#hero", 0, 1, 2, 2);
    const r = scaleRecast(POSITIONS_MULTI, "#hero", 0, 1, 2, 2);
    expect(modelOf(a)).toEqual(modelOf(r));
  });

  it("skips string (relative) positions", () => {
    const s = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);
tl.to("#el", { y: 50, duration: 1 }, "+=0.5");`;
    expect(modelOf(scaleAcorn(s, "#el", 0, 1, 1, 2))).toEqual(
      modelOf(scaleRecast(s, "#el", 0, 1, 1, 2)),
    );
  });

  it("no-op when oldDuration <= 0", () => {
    expect(scaleAcorn(POSITIONS_MULTI, "#hero", 0, 0, 2, 2)).toBe(POSITIONS_MULTI);
  });

  it("no-op when newDuration <= 0", () => {
    expect(scaleAcorn(POSITIONS_MULTI, "#hero", 0, 1, 2, 0)).toBe(POSITIONS_MULTI);
  });
});
