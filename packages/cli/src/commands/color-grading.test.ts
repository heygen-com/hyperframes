import { describe, expect, it } from "vitest";
import {
  HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS,
  getHfColorGradingCapabilities,
} from "@hyperframes/core";
import {
  applyColorGradingToHtml,
  getMediaTreatmentCapabilityDetail,
  getMediaTreatmentCapabilityOverview,
} from "./color-grading.js";

const VIDEO = `<!doctype html><html><body><video id="hero" src="hero.mp4"></video></body></html>`;

describe("applyColorGradingToHtml", () => {
  it("provides a concise first-hop overview of the complete treatment surface", () => {
    const overview = getMediaTreatmentCapabilityOverview();

    expect(overview.families.find(({ id }) => id === "correction")?.items).toContain("exposure");
    expect(overview.families.find(({ id }) => id === "art")?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "kuwahara" })]),
    );
    expect(overview.families.find(({ id }) => id === "overlays")).toMatchObject({
      owner: "registry",
      items: [
        "camcorder-hud",
        "editorial-flash-overlay",
        "organic-light-leak-overlay",
        "freeze-frame-cutout",
      ],
    });
    expect(overview.families.find(({ id }) => id === "presets")?.items).toContain("vhs-playback");
    expect(overview.families.some(({ id }) => id === "looks" || id === "treatments")).toBe(false);
    const discoveredEffects = overview.families
      .filter(({ id }) => ["essentials", "retro-glitch", "print", "art"].includes(id))
      .flatMap(({ items }) => items)
      .map((item) => (typeof item === "object" && item && "id" in item ? item.id : null));
    expect(discoveredEffects.sort()).toEqual([...HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS].sort());
    expect(JSON.stringify(overview).length).toBeLessThan(8_000);
  });

  it("returns focused controls and apply data for one capability", () => {
    expect(getMediaTreatmentCapabilityDetail("kuwahara")).toMatchObject({
      id: "kuwahara",
      family: "art",
      renderLane: "multipass",
      apply: { effects: { kuwahara: 1 } },
      animation: {
        property: expect.objectContaining({ path: "effects.kuwahara" }),
        initial: expect.stringContaining("--hf-color-grading-kuwahara"),
        tween: expect.stringContaining("timeline.to"),
      },
    });
    expect(getMediaTreatmentCapabilityDetail("retro-glitch")).toMatchObject({
      id: "retro-glitch",
      effects: expect.arrayContaining([expect.objectContaining({ id: "chromaBleed" })]),
    });
    expect(getMediaTreatmentCapabilityDetail("deep-sea")).toMatchObject({
      id: "deep-sea",
      apply: { palette: expect.arrayContaining(["#0a1628"]) },
    });
    expect(getMediaTreatmentCapabilityDetail("exposure")).toMatchObject({
      id: "exposure",
      family: "correction",
      animation: {
        property: expect.objectContaining({ path: "adjust.exposure" }),
      },
    });
    expect(getMediaTreatmentCapabilityDetail("vignette")).toMatchObject({
      id: "vignette",
      family: "finishing",
      control: expect.objectContaining({ key: "vignette" }),
    });
  });

  it("rejects unknown capability lookups", () => {
    expect(() => getMediaTreatmentCapabilityDetail("make-it-cinematic")).toThrow(
      /Unknown media-treatment capability/,
    );
    expect(() => getMediaTreatmentCapabilityDetail("__proto__")).toThrow(
      /Unknown media-treatment capability/,
    );
  });

  it("exposes enough canonical metadata to assemble a custom treatment", () => {
    const capabilities = getHfColorGradingCapabilities();

    expect(capabilities.targetTags).toEqual(["img", "video"]);
    expect(capabilities.effects.find(({ key }) => key === "kuwahara")?.apply).toMatchObject({
      kuwahara: 1,
      kuwaharaRadius: 1 / 7,
    });
    expect(capabilities.animatable.find(({ path }) => path === "effects.blur")?.name).toBe(
      "--hf-color-grading-blur",
    );
  });

  it("normalizes and persists a grading payload on real media", () => {
    const result = applyColorGradingToHtml(VIDEO, {
      selector: "#hero",
      grading: { preset: "warm-daylight", intensity: 4 },
    });

    expect(result.changed).toBe(true);
    expect(result.tag).toBe("video");
    expect(result.value).toContain('"preset":"warm-daylight"');
    expect(result.value).toContain('"intensity":1');
    expect(result.html).toContain("data-color-grading=");
  });

  it("requires an unambiguous media target", () => {
    const source = `<img class="media" src="a.png"><img class="media" src="b.png">`;
    expect(() =>
      applyColorGradingToHtml(source, { selector: ".media", grading: { preset: "neutral" } }),
    ).toThrow(/matched 2 elements/);

    const result = applyColorGradingToHtml(source, {
      selector: ".media",
      selectorIndex: 1,
      grading: { preset: "warm-daylight" },
    });
    expect((result.html.match(/data-color-grading/g) ?? []).length).toBe(1);
  });

  it("persists grading inside composition templates", () => {
    const source = `<template><video id="hero" src="hero.mp4"></video></template>`;
    const result = applyColorGradingToHtml(source, {
      selector: "#hero",
      grading: { preset: "warm-daylight" },
    });

    expect(result.changed).toBe(true);
    expect(result.html).toContain("data-color-grading=");
  });

  it("rejects non-media elements", () => {
    expect(() =>
      applyColorGradingToHtml(`<div id="hero"></div>`, {
        selector: "#hero",
        grading: { preset: "warm-daylight" },
      }),
    ).toThrow(/requires an <img> or <video>/);
  });

  it("rejects unknown keys instead of silently dropping agent mistakes", () => {
    expect(() =>
      applyColorGradingToHtml(VIDEO, {
        selector: "#hero",
        grading: { adjustments: { exposure: -0.45 }, effects: { dither: 1 } },
      }),
    ).toThrow(/Unknown top-level color-grading key: adjustments; use "adjust"/);

    expect(() =>
      applyColorGradingToHtml(VIDEO, {
        selector: "#hero",
        grading: { effects: { dithering: 1 } },
      }),
    ).toThrow(/Unknown color-grading effects key: dithering/);
  });

  it("clears both explicit and normalized no-op grading", () => {
    const graded = VIDEO.replace(" src=", ` data-color-grading='{"preset":"warm-daylight"}' src=`);
    expect(applyColorGradingToHtml(graded, { selector: "#hero", clear: true }).html).not.toContain(
      "data-color-grading",
    );
    expect(
      applyColorGradingToHtml(graded, { selector: "#hero", grading: { preset: "neutral" } }).html,
    ).not.toContain("data-color-grading");
  });

  it("does not report or serialize a no-op clear because unrelated HTML formatting differs", () => {
    const source = `<!doctype html><html><head><meta charset="utf-8" /></head><body><video id="hero" src="hero.mp4"></video></body></html>`;
    const result = applyColorGradingToHtml(source, { selector: "#hero", clear: true });

    expect(result.changed).toBe(false);
    expect(result.html).toBe(source);
  });
});
