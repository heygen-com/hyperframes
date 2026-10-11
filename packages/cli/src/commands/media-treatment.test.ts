import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCommand } from "citty";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import {
  HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS,
  getHfColorGradingCapabilities,
} from "@hyperframes/core";
import {
  applyMediaTreatmentToHtml,
  getMediaTreatmentCapabilityDetail,
  getMediaTreatmentCapabilityOverview,
  mediaTreatmentCommand,
  resolveMediaTreatmentSource,
} from "./media-treatment.js";
import { CliRuntimeError } from "../utils/commandResult.js";

const VIDEO = `<!doctype html><html><body><video id="hero" src="hero.mp4"></video></body></html>`;
const SEGMENTS = `<!doctype html><html><body><video class="seg" src="a.mp4"></video><video class="seg" src="b.mp4"></video></body></html>`;

function gradingsOf(html: string): Array<string | null> {
  return Array.from(parseHTML(html).document.querySelectorAll("video"), (video) =>
    video.getAttribute("data-color-grading"),
  );
}

describe("applyMediaTreatmentToHtml", () => {
  it("provides a concise first-hop overview of the complete treatment surface", () => {
    const overview = getMediaTreatmentCapabilityOverview();

    expect(overview.families.find(({ id }) => id === "correction")).not.toHaveProperty("items");
    expect(overview.families.find(({ id }) => id === "grading")).toMatchObject({
      label: "Color Grading",
    });
    expect(overview.families.find(({ id }) => id === "art")).not.toHaveProperty("items");
    expect(overview.families.find(({ id }) => id === "overlays")).toMatchObject({
      owner: "registry",
    });
    expect(overview.families.some(({ id }) => id === "looks" || id === "treatments")).toBe(false);
    const discoveredEffects = ["essentials", "retro-glitch", "print", "art"].flatMap((family) => {
      const detail = getMediaTreatmentCapabilityDetail(family);
      return (
        typeof detail === "object" &&
        detail !== null &&
        "effects" in detail &&
        Array.isArray(detail.effects)
          ? detail.effects
          : []
      ).map((effect) =>
        typeof effect === "object" && effect && "id" in effect ? effect.id : null,
      );
    });
    expect(discoveredEffects.sort()).toEqual([...HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS].sort());
    expect(JSON.stringify(overview).length).toBeLessThan(3_000);
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
    expect(getMediaTreatmentCapabilityDetail("wheels")).toMatchObject({
      contract: expect.objectContaining({ zones: ["shadows", "midtones", "highlights"] }),
    });
    expect(getMediaTreatmentCapabilityDetail("curves")).toMatchObject({
      contract: expect.objectContaining({ channels: ["master", "red", "green", "blue"] }),
    });
    const hueCurves = getMediaTreatmentCapabilityDetail("hue-curves");
    const serializedHueCurves = JSON.stringify(hueCurves);
    expect(serializedHueCurves).toContain('"maxPoints":16');
    expect(serializedHueCurves).toContain('"key":"hueVsHue"');
    expect(serializedHueCurves).toContain('"key":"hueVsSaturation"');
    expect(serializedHueCurves).toContain('"key":"hueVsLuma"');
    expect(getMediaTreatmentCapabilityDetail("secondary")).toMatchObject({
      contract: expect.objectContaining({
        max: 4,
        saturation: expect.objectContaining({ relation: "min < max" }),
        luma: expect.objectContaining({ relation: "min < max" }),
      }),
    });
    expect(getMediaTreatmentCapabilityDetail("grading")).toMatchObject({
      order: [
        "adjust",
        "wheels",
        "curves",
        "hueCurves",
        "secondaries",
        "lut",
        "details",
        "effects",
      ],
    });
    expect(getMediaTreatmentCapabilityDetail("scopes")).toMatchObject({
      command: expect.stringContaining("--analyze"),
    });
  });

  it("warns that an animated property overrides the payload, instead of asking for an inline start", () => {
    const detail = getMediaTreatmentCapabilityDetail("blur");
    expect(detail).toMatchObject({
      animation: {
        rules: expect.arrayContaining([expect.stringContaining("overrides the payload's value")]),
      },
    });
    expect(JSON.stringify(detail)).not.toContain("Author the initial value inline");
  });

  it("rejects unknown capability lookups", () => {
    expect(() => getMediaTreatmentCapabilityDetail("make-it-cinematic")).toThrow(
      /Unknown media-treatment capability/,
    );
    expect(() => getMediaTreatmentCapabilityDetail("__proto__")).toThrow(
      /Unknown media-treatment capability/,
    );
  });

  it("lists the area ids the lookup accepts when a capability is unknown", () => {
    let message = "";
    try {
      getMediaTreatmentCapabilityDetail("adjust");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const listed = /Available areas: ([^.]+)\./.exec(message)?.[1]?.split(", ") ?? [];
    const entryPoints = getMediaTreatmentCapabilityOverview().families.map(({ id }) => id);

    expect(listed).toEqual(expect.arrayContaining(entryPoints));
    for (const id of listed) expect(() => getMediaTreatmentCapabilityDetail(id)).not.toThrow();
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
    const result = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: { preset: "warm-daylight", intensity: 0.8 },
    });

    expect(result.changed).toBe(true);
    expect(result.tag).toBe("video");
    expect(result.value).toContain('"preset":"warm-daylight"');
    expect(result.value).toContain('"intensity":0.8');
    expect(result.html).toContain("data-color-grading=");
  });

  it("treats every video a selector matches alike", () => {
    const result = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    });

    const [first, second] = gradingsOf(result.html);
    expect(result.targets).toHaveLength(2);
    expect(first).toContain('"preset":"warm-daylight"');
    expect(second).toBe(first);
  });

  it("merges the patch into each match's own grading", () => {
    const warm = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      selectorIndex: 1,
      grading: { preset: "warm-daylight" },
    }).html;

    const result = applyMediaTreatmentToHtml(warm, {
      selector: "video",
      grading: { intensity: 0.5 },
    });

    expect(result.targets.map(({ before }) => before)).toEqual([
      null,
      expect.objectContaining({ preset: "warm-daylight" }),
    ]);
    expect(result.targets[1]?.value).toContain('"preset":"warm-daylight"');
    expect(result.targets[0]?.value ?? "").not.toContain("warm-daylight");
  });

  it("clears every match even when the selector depends on the cleared attribute", () => {
    const graded = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    }).html;

    const result = applyMediaTreatmentToHtml(graded, {
      selector: "video[data-color-grading]",
      clear: true,
    });

    expect(gradingsOf(result.html)).toEqual([null, null]);
  });

  it("patches the matched element even when a write changes which elements a selector matches", () => {
    const four = SEGMENTS.replace(
      "</body>",
      '<video src="c.mp4"></video><video src="d.mp4"></video></body>',
    );
    const graded = applyMediaTreatmentToHtml(four, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    }).html;

    const result = applyMediaTreatmentToHtml(graded, {
      selector: "video:has(+ video[data-color-grading])",
      clear: true,
    });

    expect(result.targets).toHaveLength(3);
    expect(gradingsOf(result.html).map((value) => value === null)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("patches the matched element when ids in the file are duplicated", () => {
    const html = `<img data-hf-id="hf-x1" src="a.png"><video data-hf-id="hf-x1" src="b.mp4"></video>`;

    const result = applyMediaTreatmentToHtml(html, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    });

    const { document } = parseHTML(`<!doctype html><html><body>${result.html}</body></html>`);
    expect(document.querySelector("img")?.getAttribute("data-color-grading")).toBeNull();
    expect(document.querySelector("video")?.getAttribute("data-color-grading")).toContain(
      "warm-daylight",
    );
  });

  it("clears exactly the matches inside a template when a write changes the match set", () => {
    const videos = '<video src="a.mp4"></video>'.repeat(4);
    const graded = applyMediaTreatmentToHtml(`<template>${videos}</template>`, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    }).html;

    const result = applyMediaTreatmentToHtml(graded, {
      selector: "video:has(+ video[data-color-grading])",
      clear: true,
    });

    const cleared = (result.html.match(/<video(?![^>]*data-color-grading)/g) ?? []).length;
    expect(result.targets).toHaveLength(3);
    expect(cleared).toBe(3);
  });

  it("writes a later match's change when the first match is already graded", () => {
    const firstGraded = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      selectorIndex: 0,
      grading: { preset: "warm-daylight" },
    }).html;

    const result = applyMediaTreatmentToHtml(firstGraded, {
      selector: "video",
      grading: { preset: "warm-daylight" },
    });

    expect(result.targets.map(({ changed }) => changed)).toEqual([false, true]);
    expect(result.changed).toBe(true);
    expect(gradingsOf(result.html)[1]).toContain("warm-daylight");
  });

  it("treats only the --selector-index match when one is given", () => {
    const result = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      selectorIndex: 1,
      grading: { preset: "warm-daylight" },
    });

    const [first, second] = gradingsOf(result.html);
    expect(first).toBeNull();
    expect(second).toContain('"preset":"warm-daylight"');
  });

  it("rejects a selector that also matches something other than an image or video", () => {
    const html = SEGMENTS.replace("</body>", '<div class="seg"></div></body>');

    expect(() =>
      applyMediaTreatmentToHtml(html, { selector: ".seg", grading: { preset: "warm-daylight" } }),
    ).toThrow("selector matched <div>");
  });

  it("normalizes and persists advanced grading on real media", () => {
    const result = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: {
        wheels: { shadows: { hue: 205, amount: 0.08, level: 0.02 } },
        curves: {
          master: [
            [0, 0],
            [0.5, 0.55],
            [1, 1],
          ],
        },
        hueCurves: {
          hueVsSaturation: [
            [180, 0],
            [210, 0.15],
            [240, 0],
          ],
        },
        secondaries: [
          {
            key: {
              hue: { center: 215, range: 25, softness: 10 },
              saturation: { min: 0.2, max: 1, softness: 0.08 },
              luma: { min: 0.1, max: 0.9, softness: 0.08 },
            },
            correction: { saturation: 0.15, luma: 0.03 },
          },
        ],
      },
    });

    expect(result.changed).toBe(true);
    expect(result.value).toContain('"wheels"');
    expect(result.value).toContain('"curves"');
    expect(result.value).toContain('"hueCurves"');
    expect(result.value).toContain('"secondaries"');
  });

  it("persists a disabled secondary without treating it as an active grade", () => {
    const result = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: {
        secondaries: [
          {
            enabled: false,
            key: { hue: { center: 215, range: 25 } },
            correction: { saturation: 0.15 },
          },
        ],
      },
    });

    expect(result.changed).toBe(true);
    expect(result.value).toContain('"enabled":false');
    expect(result.value).toContain('"secondaries"');
  });

  it("resolves nested composition media through the shared project-root contract", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-media-treatment-assets-"));
    const escapedAsset = join(project, "..", `${basename(project)}-escape.mp4`);
    mkdirSync(join(project, "capture"), { recursive: true });
    mkdirSync(join(project, "assets"), { recursive: true });
    writeFileSync(join(project, "capture", "talking-head.mp4"), "");
    writeFileSync(join(project, "assets", "photo.webp"), "");
    writeFileSync(join(project, "assets", "My Clip.mp4"), "");
    writeFileSync(escapedAsset, "");

    try {
      expect(
        resolveMediaTreatmentSource(
          project,
          "compositions/scene.html",
          "../capture/talking-head.mp4?v=1#frame",
        ),
      ).toBe(join(project, "capture/talking-head.mp4"));
      expect(
        resolveMediaTreatmentSource(project, "compositions/scene.html", "assets/photo.webp"),
      ).toBe(join(project, "assets/photo.webp"));
      expect(
        resolveMediaTreatmentSource(
          project,
          "compositions/scene.html",
          "/assets/My%20Clip.mp4?v=1",
        ),
      ).toBe(join(project, "assets/My Clip.mp4"));
      expect(() =>
        resolveMediaTreatmentSource(
          project,
          "compositions/scene.html",
          "https://example.com/a.mp4",
        ),
      ).toThrow(/local project asset/);
      expect(() => resolveMediaTreatmentSource(project, "compositions/scene.html", "#")).toThrow(
        /local project asset/,
      );
      expect(() =>
        resolveMediaTreatmentSource(project, "compositions/scene.html", "missing.mp4"),
      ).toThrow(/Media file not found/);
      expect(() =>
        resolveMediaTreatmentSource(
          project,
          "compositions/scene.html",
          `../../${basename(escapedAsset)}`,
        ),
      ).toThrow(/Media file not found/);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(escapedAsset, { force: true });
    }
  });

  it("merges a validated patch and reports the stored before and after payloads", () => {
    const initial = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: {
        adjust: { exposure: 0.1 },
        details: { grain: 0.2 },
      },
    });
    const patched = applyMediaTreatmentToHtml(initial.html, {
      selector: "#hero",
      grading: { adjust: { shadows: 0.08 } },
    });

    expect(patched.before).toMatchObject({
      adjust: { exposure: 0.1 },
      details: { grain: 0.2 },
    });
    expect(patched.after).toMatchObject({
      adjust: { exposure: 0.1, shadows: 0.08 },
      details: { grain: 0.2 },
    });

    const repeated = applyMediaTreatmentToHtml(patched.html, {
      selector: "#hero",
      grading: { adjust: { shadows: 0.08 } },
    });
    expect(repeated.changed).toBe(false);
    expect(repeated.html).toBe(patched.html);
    expect(repeated.after).toEqual(repeated.before);
  });

  it("applies over a grading an earlier version wrote with empty hue curves, and writes it valid", () => {
    const broken = JSON.stringify({
      hueCurves: {
        hueVsHue: [
          [0, 0],
          [120, 20],
          [240, 0],
        ],
        hueVsSaturation: [],
        hueVsLuma: [],
      },
    });
    const html = VIDEO.replace('id="hero"', `id="hero" data-color-grading='${broken}'`);

    const patched = applyMediaTreatmentToHtml(html, {
      selector: "#hero",
      grading: { adjust: { exposure: 0.1 } },
    });

    expect(patched.after).toMatchObject({
      adjust: { exposure: 0.1 },
      hueCurves: {
        hueVsHue: [
          [0, 0],
          [120, 20],
          [240, 0],
        ],
      },
    });
    expect(patched.after).not.toHaveProperty("hueCurves.hueVsSaturation");
  });

  it("rejects unknown empty hue curves instead of healing them", () => {
    const html = VIDEO.replace(
      'id="hero"',
      `id="hero" data-color-grading='{"hueCurves":{"bogus":[]}}'`,
    );
    expect(() =>
      applyMediaTreatmentToHtml(html, {
        selector: "#hero",
        grading: { adjust: { exposure: 0.1 } },
      }),
    ).toThrow(/hueCurves.*unsupported key.*bogus/);
  });

  it("preserves unresolved variable references for runtime resolution", () => {
    const wholeGrade = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: "$interviewGrade",
    });
    expect(wholeGrade.value).toBe("$interviewGrade");

    const nested = applyMediaTreatmentToHtml(VIDEO, {
      selector: "#hero",
      grading: { adjust: { exposure: "$interviewExposure" } },
    });
    expect(JSON.parse(nested.value ?? "{}")).toMatchObject({
      adjust: { exposure: "$interviewExposure" },
    });

    const storedVariable = VIDEO.replace(" src=", ` data-color-grading="$interviewGrade" src=`);
    expect(() =>
      applyMediaTreatmentToHtml(storedVariable, {
        selector: "#hero",
        grading: { adjust: { exposure: 0.1 } },
      }),
    ).toThrow(/Cannot merge.*unresolved whole-grade variable/);
  });

  it("grades every matched image unless --selector-index picks one", () => {
    const source = `<img class="media" src="a.png"><img class="media" src="b.png">`;
    const all = applyMediaTreatmentToHtml(source, {
      selector: ".media",
      grading: { preset: "warm-daylight" },
    });
    expect((all.html.match(/data-color-grading/g) ?? []).length).toBe(2);

    const result = applyMediaTreatmentToHtml(source, {
      selector: ".media",
      selectorIndex: 1,
      grading: { preset: "warm-daylight" },
    });
    expect((result.html.match(/data-color-grading/g) ?? []).length).toBe(1);
  });

  it("persists grading inside composition templates", () => {
    const source = `<template><video id="hero" src="hero.mp4"></video></template>`;
    const result = applyMediaTreatmentToHtml(source, {
      selector: "#hero",
      grading: { preset: "warm-daylight" },
    });

    expect(result.changed).toBe(true);
    expect(result.html).toContain("data-color-grading=");
  });

  it("rejects non-media elements", () => {
    expect(() =>
      applyMediaTreatmentToHtml(`<div id="hero"></div>`, {
        selector: "#hero",
        grading: { preset: "warm-daylight" },
      }),
    ).toThrow(/requires an <img> or <video>/);
  });

  it("rejects unknown keys instead of silently dropping agent mistakes", () => {
    expect(() =>
      applyMediaTreatmentToHtml(VIDEO, {
        selector: "#hero",
        grading: { adjustments: { exposure: -0.45 }, effects: { dither: 1 } },
      }),
    ).toThrow(/grading.*adjustments/i);

    expect(() =>
      applyMediaTreatmentToHtml(VIDEO, {
        selector: "#hero",
        grading: { effects: { dithering: 1 } },
      }),
    ).toThrow(/effects.*dithering/i);
  });

  it("previews the exact grading attribute and lint verdict without --apply or writes", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-media-dry-run-"));
    const file = join(project, "index.html");
    const grading = '{"preset":"warm-daylight","intensity":0.8}';
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(file, VIDEO);
    const args = ["--project", project, "--selector", "#hero", "--grading", grading, "--json"];
    try {
      await runCommand(mediaTreatmentCommand, { rawArgs: [...args, "--dry-run"] });
      const preview = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(preview).toMatchObject({
        ok: true,
        dryRun: true,
        changed: true,
        attribute: "data-color-grading",
        lint: { ok: true, findings: [] },
      });
      expect(readFileSync(file, "utf8")).toBe(VIDEO);
      await runCommand(mediaTreatmentCommand, { rawArgs: [...args, "--apply"] });
      const applied = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      const written = parseHTML(readFileSync(file, "utf8"))
        .document.querySelector("#hero")
        ?.getAttribute("data-color-grading");
      expect(preview.value).toBe(written);
      expect(preview.value).toBe(applied.value);
      expect(preview.lint).toEqual(applied.lint);
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("reports how many elements an --apply treated", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-media-all-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(join(project, "index.html"), SEGMENTS);
    try {
      await runCommand(mediaTreatmentCommand, {
        rawArgs: [
          "--project",
          project,
          "--selector",
          "video",
          "--grading",
          '{"preset":"warm-daylight"}',
          "--apply",
          "--json",
        ],
      });

      const applied = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(applied).toMatchObject({ ok: true, count: 2, changed: true });
      expect(
        applied.targets.map(({ selectorIndex }: { selectorIndex: number }) => selectorIndex),
      ).toEqual([0, 1]);
      expect(gradingsOf(readFileSync(join(project, "index.html"), "utf8"))[1]).toContain(
        "warm-daylight",
      );
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("reports apply when any match keeps a grading after the patch", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-media-action-"));
    const html = applyMediaTreatmentToHtml(SEGMENTS, {
      selector: "video",
      selectorIndex: 1,
      grading: { wheels: { shadows: { hue: 205, amount: 0.08, level: 0.02 } } },
    }).html;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeFileSync(join(project, "index.html"), html);
    try {
      await runCommand(mediaTreatmentCommand, {
        rawArgs: [
          "--project",
          project,
          "--selector",
          "video",
          "--grading",
          '{"preset":"neutral"}',
          "--apply",
          "--json",
        ],
      });

      const applied = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(applied.targets.map(({ value }: { value: string | null }) => value === null)).toEqual([
        true,
        false,
      ]);
      expect(applied.action).toBe("apply");
    } finally {
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("requires --apply for --grading while keeping --clear explicit", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-media-treatment-"));
    const file = join(project, "index.html");
    const grading = '{"adjust":{"exposure":0.1}}';
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    writeFileSync(file, VIDEO);

    try {
      await expect(
        runCommand(mediaTreatmentCommand, {
          rawArgs: ["--project", project, "--selector", "#hero", "--grading", grading],
        }),
      ).rejects.toThrow(CliRuntimeError);
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining("--grading requires --apply"));
      expect(readFileSync(file, "utf8")).toBe(VIDEO);

      await runCommand(mediaTreatmentCommand, {
        rawArgs: ["--project", project, "--selector", "#hero", "--grading", grading, "--apply"],
      });
      expect(readFileSync(file, "utf8")).toContain("data-color-grading");

      await runCommand(mediaTreatmentCommand, {
        rawArgs: ["--project", project, "--selector", "#hero", "--clear"],
      });
      expect(readFileSync(file, "utf8")).not.toContain("data-color-grading");
    } finally {
      log.mockRestore();
      error.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("clears both explicit and normalized no-op grading", () => {
    const graded = VIDEO.replace(" src=", ` data-color-grading='{"preset":"warm-daylight"}' src=`);
    expect(
      applyMediaTreatmentToHtml(graded, { selector: "#hero", clear: true }).html,
    ).not.toContain("data-color-grading");
    expect(
      applyMediaTreatmentToHtml(graded, { selector: "#hero", grading: { preset: "neutral" } }).html,
    ).not.toContain("data-color-grading");
  });

  it("does not report or serialize a no-op clear because unrelated HTML formatting differs", () => {
    const source = `<!doctype html><html><head><meta charset="utf-8" /></head><body><video id="hero" src="hero.mp4"></video></body></html>`;
    const result = applyMediaTreatmentToHtml(source, { selector: "#hero", clear: true });

    expect(result.changed).toBe(false);
    expect(result.html).toBe(source);
  });
});
