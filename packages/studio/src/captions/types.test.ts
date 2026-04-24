// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STYLE,
  DEFAULT_CONTAINER,
  DEFAULT_ANIMATION,
  DEFAULT_ANIMATION_SET,
  type CaptionGradient,
  type CaptionShadow,
  type CaptionGlow,
  type CaptionStyle,
  type CaptionContainerStyle,
  type CaptionAnimation,
  type CaptionAnimationSet,
  type CaptionSegment,
  type CaptionGroup,
  type CaptionModel,
} from "./types";

// ---------------------------------------------------------------------------
// DEFAULT_STYLE
// ---------------------------------------------------------------------------

describe("DEFAULT_STYLE", () => {
  it("has required typography fields with sensible defaults", () => {
    expect(DEFAULT_STYLE.fontFamily).toBe("sans-serif");
    expect(DEFAULT_STYLE.fontSize).toBe(48);
    expect(DEFAULT_STYLE.fontWeight).toBe(700);
    expect(DEFAULT_STYLE.fontStyle).toBe("normal");
    expect(DEFAULT_STYLE.textDecoration).toBe("none");
    expect(DEFAULT_STYLE.textTransform).toBe("none");
    expect(DEFAULT_STYLE.letterSpacing).toBe(0);
    expect(DEFAULT_STYLE.lineHeight).toBe(1.2);
  });

  it("has required color fields", () => {
    expect(DEFAULT_STYLE.color).toBe("#ffffff");
    expect(DEFAULT_STYLE.activeColor).toBe("#ffffff");
    expect(typeof DEFAULT_STYLE.dimColor).toBe("string");
    expect(DEFAULT_STYLE.opacity).toBe(1);
    expect(DEFAULT_STYLE.gradientFill).toBeNull();
  });

  it("has required stroke fields with zero defaults", () => {
    expect(DEFAULT_STYLE.strokeWidth).toBe(0);
    expect(DEFAULT_STYLE.strokeColor).toBe("#000000");
  });

  it("has required effects fields with empty/null defaults", () => {
    expect(DEFAULT_STYLE.shadows).toEqual([]);
    expect(DEFAULT_STYLE.glow).toBeNull();
  });

  it("has required transform fields at identity values", () => {
    expect(DEFAULT_STYLE.x).toBe(0);
    expect(DEFAULT_STYLE.y).toBe(0);
    expect(DEFAULT_STYLE.rotation).toBe(0);
    expect(DEFAULT_STYLE.scaleX).toBe(1);
    expect(DEFAULT_STYLE.scaleY).toBe(1);
    expect(DEFAULT_STYLE.skewX).toBe(0);
    expect(DEFAULT_STYLE.skewY).toBe(0);
    expect(DEFAULT_STYLE.transformOrigin).toBe("center center");
  });

  it("has normal blendMode by default", () => {
    expect(DEFAULT_STYLE.blendMode).toBe("normal");
  });

  it("satisfies the CaptionStyle interface shape", () => {
    const style: CaptionStyle = DEFAULT_STYLE;
    expect(style).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONTAINER
// ---------------------------------------------------------------------------

describe("DEFAULT_CONTAINER", () => {
  it("has transparent background with zero opacity", () => {
    expect(DEFAULT_CONTAINER.backgroundColor).toBe("transparent");
    expect(DEFAULT_CONTAINER.backgroundOpacity).toBe(0);
  });

  it("has zero padding on all sides", () => {
    expect(DEFAULT_CONTAINER.paddingTop).toBe(0);
    expect(DEFAULT_CONTAINER.paddingRight).toBe(0);
    expect(DEFAULT_CONTAINER.paddingBottom).toBe(0);
    expect(DEFAULT_CONTAINER.paddingLeft).toBe(0);
  });

  it("has zero border radius and width", () => {
    expect(DEFAULT_CONTAINER.borderRadius).toBe(0);
    expect(DEFAULT_CONTAINER.borderWidth).toBe(0);
    expect(DEFAULT_CONTAINER.borderColor).toBe("transparent");
    expect(DEFAULT_CONTAINER.borderStyle).toBe("solid");
  });

  it("has no box shadow", () => {
    expect(DEFAULT_CONTAINER.boxShadow).toBe("none");
  });

  it("satisfies the CaptionContainerStyle interface shape", () => {
    const container: CaptionContainerStyle = DEFAULT_CONTAINER;
    expect(container).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ANIMATION
// ---------------------------------------------------------------------------

describe("DEFAULT_ANIMATION", () => {
  it("uses fade preset with short duration", () => {
    expect(DEFAULT_ANIMATION.preset).toBe("fade");
    expect(DEFAULT_ANIMATION.duration).toBe(0.2);
  });

  it("uses power2.out ease", () => {
    expect(DEFAULT_ANIMATION.ease).toBe("power2.out");
  });

  it("has zero stagger starting from the start", () => {
    expect(DEFAULT_ANIMATION.stagger).toBe(0);
    expect(DEFAULT_ANIMATION.staggerDirection).toBe("start");
  });

  it("has full intensity", () => {
    expect(DEFAULT_ANIMATION.intensity).toBe(1);
  });

  it("satisfies the CaptionAnimation interface shape", () => {
    const anim: CaptionAnimation = DEFAULT_ANIMATION;
    expect(anim).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ANIMATION_SET
// ---------------------------------------------------------------------------

describe("DEFAULT_ANIMATION_SET", () => {
  it("has an entrance animation matching DEFAULT_ANIMATION", () => {
    expect(DEFAULT_ANIMATION_SET.entrance).toBe(DEFAULT_ANIMATION);
  });

  it("has no highlight animation by default", () => {
    expect(DEFAULT_ANIMATION_SET.highlight).toBeNull();
  });

  it("has an exit animation with same values as DEFAULT_ANIMATION but distinct object", () => {
    expect(DEFAULT_ANIMATION_SET.exit).toEqual(DEFAULT_ANIMATION);
    expect(DEFAULT_ANIMATION_SET.exit).not.toBe(DEFAULT_ANIMATION);
  });

  it("satisfies the CaptionAnimationSet interface shape", () => {
    const set: CaptionAnimationSet = DEFAULT_ANIMATION_SET;
    expect(set).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level structural checks (runtime shape validation)
// ---------------------------------------------------------------------------

describe("CaptionGradient structure", () => {
  it("accepts linear gradient objects", () => {
    const gradient: CaptionGradient = {
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    expect(gradient.type).toBe("linear");
    expect(gradient.stops).toHaveLength(2);
  });

  it("accepts radial gradient objects", () => {
    const gradient: CaptionGradient = {
      type: "radial",
      angle: 0,
      stops: [{ offset: 0.5, color: "red" }],
    };
    expect(gradient.type).toBe("radial");
  });
});

describe("CaptionShadow structure", () => {
  it("accepts shadow objects with all required fields", () => {
    const shadow: CaptionShadow = { offsetX: 2, offsetY: 2, blur: 4, color: "#000" };
    expect(shadow.blur).toBe(4);
  });
});

describe("CaptionGlow structure", () => {
  it("accepts glow objects with blur, color, and opacity", () => {
    const glow: CaptionGlow = { blur: 8, color: "#00f", opacity: 0.5 };
    expect(glow.opacity).toBe(0.5);
  });
});

describe("CaptionSegment structure", () => {
  it("accepts segment objects with required fields", () => {
    const seg: CaptionSegment = {
      id: "s1",
      text: "Hello",
      start: 0,
      end: 0.5,
      groupIndex: 0,
      style: {},
      animation: {},
    };
    expect(seg.id).toBe("s1");
  });

  it("accepts optional wordId field", () => {
    const seg: CaptionSegment = {
      id: "s2",
      wordId: "w0",
      text: "World",
      start: 0.6,
      end: 1.0,
      groupIndex: 1,
      style: {},
      animation: {},
    };
    expect(seg.wordId).toBe("w0");
  });
});

describe("CaptionGroup structure", () => {
  it("accepts a valid CaptionGroup object", () => {
    const group: CaptionGroup = {
      id: "g1",
      segmentIds: ["s1", "s2"],
      style: DEFAULT_STYLE,
      animation: DEFAULT_ANIMATION_SET,
      containerStyle: DEFAULT_CONTAINER,
    };
    expect(group.id).toBe("g1");
    expect(group.segmentIds).toHaveLength(2);
  });
});

describe("CaptionModel structure", () => {
  it("accepts a valid CaptionModel object", () => {
    const model: CaptionModel = {
      width: 1920,
      height: 1080,
      duration: 10,
      segments: new Map(),
      groups: new Map(),
      groupOrder: [],
      defaultAnimation: DEFAULT_ANIMATION_SET,
    };
    expect(model.width).toBe(1920);
    expect(model.segments).toBeInstanceOf(Map);
    expect(model.groups).toBeInstanceOf(Map);
  });
});
