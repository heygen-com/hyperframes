import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { runCommand } from "citty";
import type { ArgsDef } from "citty";
import { ensureDOMParser } from "../utils/dom.js";
import keyframesCommand from "./keyframes.js";
import {
  collectCompositions,
  collectShotSelectors,
  resolveScope,
  singleFileStage,
  surfaceComposition,
} from "./keyframes.js";
import { ensureShotOutputDir } from "./motionShot.js";

// citty types `args` as Resolvable<ArgsDef> (object | promise | thunk); this
// command always uses a static object, same narrowing as assertKnownFlags.
function layoutArgDescription(): string {
  const rawDef = keyframesCommand.args;
  const args = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const layout = args?.["layout"];
  if (!layout || typeof layout !== "object" || !("description" in layout)) {
    throw new Error("expected keyframesCommand.args.layout.description to be defined");
  }
  return String(layout.description);
}

beforeAll(() => ensureDOMParser());

const wrap = (script: string) =>
  `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="4"><div id="dot" class="clip"></div></div><script>${script}</script></body></html>`;

describe("keyframes JSON output", () => {
  it.each(["css", "anime"])("emits parseable JSON with --runtime %s", async (runtime) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-keyframes-json-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, "index.html");
    writeFileSync(source, wrap(""));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await runCommand(keyframesCommand, { rawArgs: [source, "--runtime", runtime, "--json"] });

    const output = log.mock.calls.map((args) => args.join(" ")).join("\n");
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({
      project: "index.html",
      runtime,
      compositions: [{ composition: "index.html", tweens: [], cssKeyframes: [], anime: [] }],
    });
  });
});

describe("keyframes human output", () => {
  it("prints selectors, values and keyframe text from the project with control characters escaped", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const dir = mkdtempSync(join(tmpdir(), "hf-keyframes-human-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, "index.html");
    writeFileSync(
      source,
      wrap(
        `const tl = gsap.timeline({ paused: true }); tl.to("#dot${esc}[2J", { x: "40px${esc}]52;c;cA==${bel}", duration: 1 }, 0); window.__timelines = { main: tl };`,
      ).replace(
        "</body>",
        `<style>@keyframes pulse { from { content: "a${esc}[1A"; } to { opacity: 1; } } #dot { animation: pulse 1s; }</style></body>`,
      ),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await runCommand(keyframesCommand, { rawArgs: [source, "--runtime", "all"] });

    const colors = new RegExp(`${esc}\\[[0-9;]*m`, "g");
    const output = log.mock.calls
      .map((args) => args.join(" "))
      .join("\n")
      .replace(colors, "");
    expect(output).not.toContain(esc);
    expect(output).not.toContain(bel);
    expect(output).toContain("#dot\\x1b[2J");
    expect(output).toContain("40px\\x1b]52;c;cA==\\x07");
    expect(output).toContain("a\\x1b[1A");
  });
});

describe("keyframes direct composition scope", () => {
  it("keeps the project root and passes the nested HTML entry to --shot", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-keyframes-target-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    const compositionsDir = join(projectDir, "compositions");
    mkdirSync(compositionsDir);
    writeFileSync(join(projectDir, "index.html"), wrap(""));
    const scenePath = join(compositionsDir, "scene.html");
    writeFileSync(scenePath, wrap(""));

    const scope = resolveScope({ target: scenePath });

    expect(scope.projectDir).toBe(projectDir);
    expect(scope.entryFile).toBe("compositions/scene.html");
    expect(scope.singleFile).toBe(scenePath);
  });
});

describe("keyframes --shot on a bare HTML file", () => {
  const scene = `<template id="scene-template"><div data-composition-id="scene"></div></template>`;
  const mountingIndex = wrap("").replace(
    '<div id="dot" class="clip"></div>',
    '<div data-composition-id="scene" data-composition-src="compositions/scene.html"></div>',
  );

  function project(index: string) {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-keyframes-stage-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    mkdirSync(join(projectDir, "compositions"));
    writeFileSync(join(projectDir, "index.html"), index);
    return projectDir;
  }

  it("stages a scene its project mounts from the project, so the scene keeps its shell", async () => {
    const projectDir = project(mountingIndex);
    const scenePath = join(projectDir, "compositions", "scene.html");
    writeFileSync(scenePath, scene);

    expect(await singleFileStage(scenePath, projectDir)).toEqual({
      root: projectDir,
      entries: [join(projectDir, "index.html"), scenePath],
      entryFile: "compositions/scene.html",
    });
  });

  it("stages any other file from its own folder, even under a folder holding index.html", async () => {
    const projectDir = project(wrap(""));
    const sentPath = join(projectDir, "compositions", "sent.html");
    writeFileSync(sentPath, scene);

    expect(await singleFileStage(sentPath, projectDir)).toEqual({
      root: join(projectDir, "compositions"),
      entries: [sentPath],
      entryFile: "sent.html",
    });
  });
});

describe("keyframes shot output", () => {
  it("rejects an output path that would overwrite the composition source", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-keyframes-shot-source-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    const sourcePath = join(projectDir, "index.html");
    writeFileSync(sourcePath, wrap(""));

    expect(() => ensureShotOutputDir(sourcePath, sourcePath)).toThrow(
      /must not overwrite the composition source/,
    );
    expect(readFileSync(sourcePath, "utf8")).toBe(wrap(""));
  });

  it("rejects an existing output alias that refers to the composition source", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-keyframes-shot-alias-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    const sourcePath = join(projectDir, "index.html");
    const aliasPath = join(projectDir, "shot.png");
    writeFileSync(sourcePath, wrap(""));
    linkSync(sourcePath, aliasPath);

    expect(() => ensureShotOutputDir(aliasPath, sourcePath)).toThrow(
      /must not overwrite the composition source/,
    );
  });

  it("creates a missing parent directory before writing --shot", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-keyframes-shot-dir-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    const outputDir = join(projectDir, "nested", "proofs");
    ensureShotOutputDir(join(outputDir, "shot.png"));
    expect(existsSync(outputDir)).toBe(true);
  });
});

describe("keyframes multi-stroke traces", () => {
  it("composites ≥2 position strokes on one element into a single trace", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: -100, y: -150 }, "100%": { x: 80, y: -120 } }, duration: 1 });
      tl.to("#dot", { keyframes: { "0%": { x: 80, y: 120 }, "100%": { x: 85, y: 140 } }, duration: 1 });
      window.__timelines = [tl];
    `);
    const { traces } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.target).toBe("#dot");
    expect(traces[0]!.strokes).toHaveLength(2);
  });

  it("treats a 0-duration set() between strokes as a pen-up jump, not a drawn stroke", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 100, y: 0 } }, duration: 1 });
      tl.set("#dot", { x: 200, y: 200 });
      tl.to("#dot", { keyframes: { "0%": { x: 200, y: 200 }, "100%": { x: 250, y: 250 } }, duration: 1 });
      window.__timelines = [tl];
    `);
    const { traces } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(1);
    // two DRAWN strokes; the set() is the pen-up gap and is excluded
    expect(traces[0]!.strokes).toHaveLength(2);
  });

  it("leaves a single-stroke element untraced (normal per-tween output)", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 200, y: -100 }, "100%": { x: 0, y: 0 } }, duration: 3 });
      window.__timelines = [tl];
    `);
    const { traces, tweens } = surfaceComposition(html, "index.html", "index.html");
    expect(traces).toHaveLength(0);
    expect(tweens.length).toBeGreaterThan(0);
  });
});

describe("keyframes composed-ancestor surfacing (nested elements)", () => {
  const nested = (script: string) =>
    `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="4"><div id="stage"><div id="hero"><div id="core" class="clip"></div></div></div></div><script>${script}</script></body></html>`;

  it("annotates a child tween with its animated ANCESTOR's motion", () => {
    const html = nested(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { keyframes: { "0%": { x: -300, y: 0 }, "100%": { x: 300, y: 0 } }, duration: 4 }, 0);
      tl.to("#core", { keyframes: { "0%": { scale: 1 }, "100%": { scale: 1.5 } }, duration: 4 }, 0);
      window.__timelines = [tl];
    `);
    const { tweens } = surfaceComposition(html, "index.html", "index.html");
    const core = tweens.find((t) => t.target === "#core");
    expect(core?.composedWith?.map((a) => a.selector)).toContain("#hero");
    // and the ancestor's path EXTENT is summarised (range, not endpoints — so a
    // closed loop still reveals its travel)
    expect(core?.composedWith?.[0]!.summary).toMatch(/x -300\.\.300/);
  });

  it("does not annotate when the parent isn't animated", () => {
    const html = nested(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#core", { keyframes: { "0%": { scale: 1 }, "100%": { scale: 1.5 } }, duration: 4 }, 0);
      window.__timelines = [tl];
    `);
    const { tweens } = surfaceComposition(html, "index.html", "index.html");
    expect(tweens.find((t) => t.target === "#core")?.composedWith).toBeUndefined();
  });

  it.each(["template", "nested template"])(
    "keeps the parent motion of a child authored in a %s",
    (mode) => {
      const content = `<div id="hero"><div id="core" class="clip"></div></div><script>
        const tl = gsap.timeline({ paused: true });
        tl.to("#hero", { keyframes: { "0%": { x: -300 }, "100%": { x: 300 } }, duration: 4 }, 0);
        tl.to("#core", { keyframes: { "0%": { scale: 1 }, "100%": { scale: 1.5 } }, duration: 4 }, 0);
        window.__timelines = { beat: tl };
      </script>`;
      const html =
        mode === "template"
          ? `<template>${content}</template>`
          : `<template><div><template>${content}</template></div></template>`;
      const { tweens } = surfaceComposition(html, "beat.html", "beat.html");
      expect(tweens).toHaveLength(2);
      expect(tweens.find((t) => t.target === "#core")?.composedWith).toEqual([
        { selector: "#hero", summary: "x -300..300" },
      ]);
    },
  );

  it("keeps animated ancestors ordered from the parent to the outer group", () => {
    const html = `<template><div id="stage"><div id="hero"><div id="core"></div></div></div><script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#stage", { y: 0 }, { y: 100, duration: 4 }, 0);
      tl.fromTo("#hero", { x: 0 }, { x: 300, duration: 4 }, 0);
      tl.fromTo("#core", { scale: 1 }, { scale: 1.5, duration: 4 }, 0);
      window.__timelines = { beat: tl };
    </script></template>`;
    const { tweens } = surfaceComposition(html, "beat.html", "beat.html");
    expect(tweens.find((t) => t.target === "#core")?.composedWith).toEqual([
      { selector: "#hero", summary: "x 0..300" },
      { selector: "#stage", summary: "y 0..100" },
    ]);
  });

  it("keeps implicit parent starting values unresolved inside a template", () => {
    const html = `<template><div id="hero"><div id="core"></div></div><script>
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 300, duration: 4 }, 0);
      tl.to("#core", { scale: 1.5, duration: 4 }, 0);
      window.__timelines = { beat: tl };
    </script></template>`;
    const { tweens } = surfaceComposition(html, "beat.html", "beat.html");
    const hero = tweens.find((t) => t.target === "#hero");
    expect(hero?.keyframes[0]?.properties.x).toBeUndefined();
    expect(hero?.unresolved).toContain("endpointProperties");
    expect(tweens.find((t) => t.target === "#core")?.composedWith).toEqual([
      { selector: "#hero", summary: "(no resolved variation; runtime verification required)" },
    ]);
  });

  it("uses document matches before template matches for a repeated selector", () => {
    const html = `<div id="core"></div><template><div id="hero"><div id="core"></div></div><script>
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 300, duration: 4 }, 0);
      tl.to("#core", { scale: 1.5, duration: 4 }, 0);
      window.__timelines = { beat: tl };
    </script></template>`;
    const { tweens } = surfaceComposition(html, "beat.html", "beat.html");
    expect(tweens.find((t) => t.target === "#core")?.composedWith).toBeUndefined();
  });

  it("does not treat an animated sibling as a template child's ancestor", () => {
    const html = `<template><div id="hero"></div><div id="core"></div><script>
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 300, duration: 4 }, 0);
      tl.to("#core", { scale: 1.5, duration: 4 }, 0);
      window.__timelines = { beat: tl };
    </script></template>`;
    const { tweens } = surfaceComposition(html, "beat.html", "beat.html");
    expect(tweens).toHaveLength(2);
    expect(tweens.every((tween) => tween.composedWith === undefined)).toBe(true);
  });
});

describe("keyframes runtime surfacing", () => {
  it("surfaces CSS @keyframes and their animated selectors", () => {
    const html = `<!doctype html><html><head><style>
      .dot { animation: rise 1200ms ease-out both; }
      @keyframes rise {
        0% { opacity: 0; transform: translateY(40px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    </style></head><body><div class="dot"></div></body></html>`;
    const { cssKeyframes } = surfaceComposition(html, "index.html", "index.html");
    expect(cssKeyframes).toHaveLength(1);
    expect(cssKeyframes[0]!.name).toBe("rise");
    expect(cssKeyframes[0]!.selectors).toContain(".dot");
    expect(cssKeyframes[0]!.keyframes.map((kf) => kf.selector)).toEqual(["0%", "100%"]);
  });

  it("does not let a CSS comment before @keyframes leak into the next rule's selector", () => {
    const html = `<!doctype html><html><head><style>
      /* Grain animation */
      @keyframes rise { 0% { opacity: 0; } 100% { opacity: 1; } }
      .dot { animation: rise 1s both; }
    </style></head><body><div class="dot"></div></body></html>`;
    const { cssKeyframes } = surfaceComposition(html, "index.html", "index.html");
    expect(cssKeyframes[0]!.selectors).toEqual([".dot"]);
  });

  it("surfaces Anime.js calls and explicit HyperFrames registration", () => {
    const html = wrap(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(".chip", { translateX: [0, 240], duration: 900 });
      window.__hfAnime = window.__hfAnime || [];
      window.__hfAnime.push(tl);
    `);
    const { anime } = surfaceComposition(html, "index.html", "index.html");
    expect(anime).toHaveLength(1);
    expect(anime[0]!.kind).toBe("timeline");
    expect(anime[0]!.registered).toBe(true);
    expect(anime[0]!.targets).toContain(".chip");
    expect(anime[0]!.durations).toContain(900);
  });

  it("uses CSS and Anime targets as onion-shot candidates", () => {
    const cssHtml = `<!doctype html><html><head><style>
      .dot { animation: rise 1200ms ease-out both; }
      @keyframes rise {
        0% { transform: translateY(40px); }
        100% { transform: translateY(0); }
      }
    </style></head><body><div class="dot"></div></body></html>`;
    const animeHtml = wrap(`
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(".chip", { translateX: [0, 240], duration: 900 });
      window.__hfAnime = window.__hfAnime || [];
      window.__hfAnime.push(tl);
    `);

    const selectors = collectShotSelectors([
      surfaceComposition(cssHtml, "css.html", "css.html"),
      surfaceComposition(animeHtml, "anime.html", "anime.html"),
    ]).map((item) => item.selector);

    expect(selectors).toEqual(expect.arrayContaining([".dot", ".chip"]));
  });

  it("does not forward unresolved static targets as concrete shot selectors", () => {
    const html = wrap(`
      const tl = gsap.timeline({ paused: true });
      tl.to(runtimeOnlyTarget(), { x: 240, duration: 1 });
      tl.to("#drag", { x: 240, duration: 1 });
    `);

    const selectors = collectShotSelectors([
      surfaceComposition(html, "helper.html", "helper.html"),
    ]).map((item) => item.selector);

    expect(selectors).toEqual(["#drag"]);
  });
});

describe("keyframes template-wrapped sub-compositions", () => {
  // Sub-compositions are REQUIRED to put markup + script + style inside <template>.
  // Template content is an inert DocumentFragment that document-level
  // querySelectorAll does not traverse, so extraction must walk template.content
  // too — otherwise every spec-conformant sub-composition surfaces zero motion.
  const templateWrapped = `<template>
    <style>
      #hero { opacity: 0; }
      @keyframes rise {
        0% { transform: translateY(40px); }
        100% { transform: translateY(0); }
      }
    </style>
    <div id="root" data-composition-id="beat" data-duration="4">
      <div id="hero" class="clip"></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#hero", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.75 }, 0.5);
      window.__timelines = { beat: tl };
    </script>
  </template>`;

  it("surfaces GSAP tweens from a script inside <template>", () => {
    const { tweens } = surfaceComposition(templateWrapped, "beat.html", "beat.html");
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.target).toBe("#hero");
  });

  it("surfaces @keyframes from a style inside <template>", () => {
    const { cssKeyframes } = surfaceComposition(templateWrapped, "beat.html", "beat.html");
    expect(cssKeyframes.map((k) => k.name)).toContain("rise");
  });

  it("aggregates extraction across multiple <template> blocks in one document", () => {
    // Pins the every-template-fragment walk: styles from BOTH templates must
    // surface, and a script in a NON-FIRST template must surface. (Two GSAP
    // timelines in one file is a separate parser limitation — the static parser
    // follows a single __timelines registration — so scripts are split so that
    // the tween lives in the second template.)
    const twoTemplates = `<template>
      <style>
        @keyframes rise { 0% { opacity: 0; } 100% { opacity: 1; } }
      </style>
      <div id="a" class="clip"></div>
    </template>
    <template>
      <style>
        @keyframes spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }
      </style>
      <div id="b" class="clip"></div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.to("#b", { y: 50, duration: 1 });
        window.__timelines = { multi: tl };
      </script>
    </template>`;
    const { tweens, cssKeyframes } = surfaceComposition(twoTemplates, "multi.html", "multi.html");
    expect(cssKeyframes.map((k) => k.name)).toEqual(expect.arrayContaining(["rise", "spin"]));
    expect(tweens.map((t) => t.target)).toContain("#b");
  });

  it("reaches a <template> nested inside another template's fragment", () => {
    const nested = `<template>
      <div id="outer" class="clip"></div>
      <template>
        <style>
          @keyframes inner-spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }
        </style>
        <div id="inner" class="clip"></div>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#inner", { rotation: 360, duration: 1 });
          window.__timelines = { nested: tl };
        </script>
      </template>
    </template>`;
    const { tweens, cssKeyframes } = surfaceComposition(nested, "nested.html", "nested.html");
    expect(tweens.map((t) => t.target)).toContain("#inner");
    expect(cssKeyframes.map((k) => k.name)).toContain("inner-spin");
  });

  it("parses mixed top-level + template scripts (join is not source order)", () => {
    // A top-level script precedes the template script in the joined text even
    // though extraction order differs from source order — the join must still
    // parse and the template timeline must still surface.
    const mixed = `<!doctype html><html><body>
    <script>const themeUtil = { accent: "#7c3aed" };</script>
    <template>
      <div id="hero" class="clip"></div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.to("#hero", { x: 120, duration: 1 });
        window.__timelines = { mixed: tl };
      </script>
    </template>
    </body></html>`;
    const { tweens } = surfaceComposition(mixed, "mixed.html", "mixed.html");
    expect(tweens.map((t) => t.target)).toContain("#hero");
  });

  it("still surfaces top-level scripts outside any template", () => {
    const topLevel = `<!doctype html><html><body><div id="dot" class="clip"></div><script>
      const tl = gsap.timeline({ paused: true });
      tl.to("#dot", { x: 100, duration: 1 });
      window.__timelines = [tl];
    </script></body></html>`;
    const { tweens } = surfaceComposition(topLevel, "index.html", "index.html");
    expect(tweens.length).toBeGreaterThan(0);
  });
});

// PRINFRA-667: `--layout strip` only does a real per-time pixel capture when
// the sampled selector is an SVG element (see motionShot.ts's stripTargetsSvg
// gate); every other selector -- including every nested sub-composition host,
// always a <div data-composition-src> -- silently falls back to one live
// frame plus vector position markers. The old help text's unqualified
// "filmstrip by time" promised the former for the latter case. This guards
// against reintroducing that over-promise without a matching capability.
describe("--layout strip help text", () => {
  it("does not promise a universal per-time filmstrip", () => {
    expect(layoutArgDescription()).not.toMatch(
      /^--shot layout: 'path'.*or 'strip' \(filmstrip by time/,
    );
  });

  it("discloses the SVG-only condition for a real per-time capture", () => {
    const description = layoutArgDescription();
    expect(description).toContain("SVG");
    expect(description.toLowerCase()).toContain("only when");
  });
});

describe("keyframes project compositions", () => {
  it("skips a data-composition-src that points at a folder instead of crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-keyframes-folder-src-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "compositions", "intro"), { recursive: true });
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><body><div data-composition-id="main" data-duration="4"><div data-composition-id="intro" data-composition-src="compositions/intro"></div></div></body></html>`,
    );

    expect(collectCompositions(join(dir, "index.html"))).toHaveLength(1);
  });

  it.each(["../outside.html", "OUTSIDE"])(
    "does not read a data-composition-src outside the project (%s)",
    (written) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-keyframes-outside-src-"));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const project = join(dir, "project");
      mkdirSync(project);
      const outside = join(dir, "outside.html");
      writeFileSync(outside, `<div data-composition-id="outside"></div>`);
      const src = written === "OUTSIDE" ? outside : written;
      writeFileSync(
        join(project, "index.html"),
        `<!doctype html><html><body><div data-composition-id="main" data-duration="4"><div data-composition-id="intro" data-composition-src="${src}"></div></div></body></html>`,
      );

      expect(collectCompositions(join(project, "index.html"))).toHaveLength(1);
    },
  );
});

describe("keyframes text output", () => {
  const printed = async (html: string, extra: string[], file = "index.html") => {
    const dir = mkdtempSync(join(tmpdir(), "hf-keyframes-text-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, file);
    writeFileSync(source, html);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    await runCommand(keyframesCommand, { rawArgs: [source, ...extra] });
    return log.mock.calls.map((args) => args.join(" ")).join("\n");
  };

  // fails without the fix: a tween target or CSS rule from the project reached the terminal with its control bytes.
  it.each([
    [
      "a GSAP tween target",
      wrap(`
        const tl = gsap.timeline({ paused: true });
        tl.to("#dot\u001b]52;c;cGF5\u0007", { x: 10, duration: 1 });
        window.__timelines = [tl];
      `),
      [],
      "\\x1b]52;c;cGF5\\x07",
    ],
    [
      "a GSAP tween property name",
      wrap(`
        const tl = gsap.timeline({ paused: true });
        tl.to("#dot", { "\u001b]52;c;cGF5\u0007": 1, duration: 1 });
        window.__timelines = [tl];
      `),
      [],
      "\\x1b]52;c;cGF5\\x07",
    ],
    [
      "a CSS keyframes rule",
      `<!doctype html><html><head><style>
        .dot { animation: rise 1s both; }
        @keyframes rise { 0% { content: "\u001b[2J\u0007"; } 100% { opacity: 1; } }
      </style></head><body><div class="dot"></div></body></html>`,
      ["--runtime", "css"],
      "\\x1b[2J\\x07",
    ],
  ])(
    "prints %s with its control characters as visible escapes",
    async (_what, html, extra, escaped) => {
      const output = await printed(html, extra);
      expect(output).toContain(escaped);
      expect(output).not.toContain("\u001b");
      expect(output).not.toContain("\u0007");
    },
  );

  // Windows file names cannot hold control characters.
  it.skipIf(process.platform === "win32")(
    "prints a file name with control characters as visible escapes",
    async () => {
      const output = await printed(
        `<!doctype html><html><body></body></html>`,
        [],
        "a\u001b]0;x\u0007.html",
      );
      expect(output).toContain("a\\x1b]0;x\\x07.html");
      expect(output).not.toContain("\u001b");
      expect(output).not.toContain("\u0007");
    },
  );
});
