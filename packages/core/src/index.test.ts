// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as core from "./index.js";

describe("@hyperframes/core public API exports", () => {
  describe("type-related constants and utilities", () => {
    it("exports CANVAS_DIMENSIONS", () => {
      expect(core.CANVAS_DIMENSIONS).toBeDefined();
      expect(core.CANVAS_DIMENSIONS.landscape).toEqual({ width: 1920, height: 1080 });
      expect(core.CANVAS_DIMENSIONS.portrait).toEqual({ width: 1080, height: 1920 });
    });

    it("exports TIMELINE_COLORS", () => {
      expect(core.TIMELINE_COLORS).toBeDefined();
      expect(core.TIMELINE_COLORS.video).toBeDefined();
      expect(core.TIMELINE_COLORS.image).toBeDefined();
      expect(core.TIMELINE_COLORS.text).toBeDefined();
      expect(core.TIMELINE_COLORS.audio).toBeDefined();
      expect(core.TIMELINE_COLORS.composition).toBeDefined();
    });

    it("exports DEFAULT_DURATIONS", () => {
      expect(core.DEFAULT_DURATIONS).toBeDefined();
      expect(core.DEFAULT_DURATIONS.video).toBe(5);
      expect(core.DEFAULT_DURATIONS.text).toBe(2);
    });

    it("exports type guard functions", () => {
      expect(typeof core.isTextElement).toBe("function");
      expect(typeof core.isMediaElement).toBe("function");
      expect(typeof core.isCompositionElement).toBe("function");
    });

    it("exports getDefaultStageZoom", () => {
      expect(typeof core.getDefaultStageZoom).toBe("function");
      const zoom = core.getDefaultStageZoom("landscape");
      expect(zoom.scale).toBe(1);
      expect(zoom.focusX).toBe(960);
      expect(zoom.focusY).toBe(540);
    });

    it("exports composition variable type guards", () => {
      expect(typeof core.isStringVariable).toBe("function");
      expect(typeof core.isNumberVariable).toBe("function");
      expect(typeof core.isColorVariable).toBe("function");
      expect(typeof core.isBooleanVariable).toBe("function");
      expect(typeof core.isEnumVariable).toBe("function");
    });
  });

  describe("template exports", () => {
    it("exports generateBaseHtml", () => {
      expect(typeof core.generateBaseHtml).toBe("function");
    });

    it("exports getStageStyles", () => {
      expect(typeof core.getStageStyles).toBe("function");
    });

    it("exports template constants", () => {
      expect(core.GSAP_CDN).toBeDefined();
      expect(core.BASE_STYLES).toBeDefined();
      expect(core.ELEMENT_BASE_STYLES).toBeDefined();
      expect(core.MEDIA_STYLES).toBeDefined();
      expect(core.TEXT_STYLES).toBeDefined();
      expect(core.ZOOM_CONTAINER_STYLES).toBeDefined();
    });
  });

  describe("parser exports", () => {
    it("exports GSAP parser functions", () => {
      expect(typeof core.parseGsapScript).toBe("function");
      expect(typeof core.serializeGsapAnimations).toBe("function");
      expect(typeof core.updateAnimationInScript).toBe("function");
      expect(typeof core.addAnimationToScript).toBe("function");
      expect(typeof core.removeAnimationFromScript).toBe("function");
      expect(typeof core.getAnimationsForElement).toBe("function");
      expect(typeof core.validateCompositionGsap).toBe("function");
      expect(typeof core.keyframesToGsapAnimations).toBe("function");
      expect(typeof core.gsapAnimationsToKeyframes).toBe("function");
    });

    it("exports GSAP constants", () => {
      expect(core.SUPPORTED_PROPS).toBeDefined();
      expect(Array.isArray(core.SUPPORTED_PROPS)).toBe(true);
      expect(core.SUPPORTED_EASES).toBeDefined();
      expect(Array.isArray(core.SUPPORTED_EASES)).toBe(true);
    });

    it("exports HTML parser functions", () => {
      expect(typeof core.parseHtml).toBe("function");
      expect(typeof core.updateElementInHtml).toBe("function");
      expect(typeof core.addElementToHtml).toBe("function");
      expect(typeof core.removeElementFromHtml).toBe("function");
      expect(typeof core.validateCompositionHtml).toBe("function");
      expect(typeof core.extractCompositionMetadata).toBe("function");
    });
  });

  describe("generator exports", () => {
    it("exports hyperframes generator functions", () => {
      expect(typeof core.generateHyperframesHtml).toBe("function");
      expect(typeof core.generateGsapTimelineScript).toBe("function");
      expect(typeof core.generateHyperframesStyles).toBe("function");
    });
  });

  describe("compiler exports", () => {
    it("exports compiler functions", () => {
      expect(typeof core.compileTimingAttrs).toBe("function");
      expect(typeof core.injectDurations).toBe("function");
      expect(typeof core.extractResolvedMedia).toBe("function");
      expect(typeof core.clampDurations).toBe("function");
    });
  });

  describe("lint exports", () => {
    it("exports lintHyperframeHtml", () => {
      expect(typeof core.lintHyperframeHtml).toBe("function");
    });
  });

  describe("inline-script exports", () => {
    it("exports hyperframe runtime artifacts", () => {
      expect(core.HYPERFRAME_RUNTIME_ARTIFACTS).toBeDefined();
      expect(core.HYPERFRAME_RUNTIME_CONTRACT).toBeDefined();
      expect(typeof core.loadHyperframeRuntimeSource).toBe("function");
    });

    it("exports runtime contract constants", () => {
      expect(core.HYPERFRAME_RUNTIME_GLOBALS).toBeDefined();
      expect(core.HYPERFRAME_BRIDGE_SOURCES).toBeDefined();
      expect(core.HYPERFRAME_CONTROL_ACTIONS).toBeDefined();
    });

    it("exports buildHyperframesRuntimeScript", () => {
      expect(typeof core.buildHyperframesRuntimeScript).toBe("function");
    });

    it("exports MEDIA_VISUAL_STYLE_PROPERTIES", () => {
      expect(core.MEDIA_VISUAL_STYLE_PROPERTIES).toBeDefined();
      expect(Array.isArray(core.MEDIA_VISUAL_STYLE_PROPERTIES)).toBe(true);
      expect(core.MEDIA_VISUAL_STYLE_PROPERTIES).toContain("width");
      expect(core.MEDIA_VISUAL_STYLE_PROPERTIES).toContain("opacity");
      expect(core.MEDIA_VISUAL_STYLE_PROPERTIES).toContain("transform");
    });

    it("exports copyMediaVisualStyles", () => {
      expect(typeof core.copyMediaVisualStyles).toBe("function");
    });

    it("exports quantizeTimeToFrame", () => {
      expect(typeof core.quantizeTimeToFrame).toBe("function");
    });
  });

  describe("adapter exports", () => {
    it("exports createGSAPFrameAdapter", () => {
      expect(typeof core.createGSAPFrameAdapter).toBe("function");
    });
  });
});
