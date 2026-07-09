import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const registryRoot = resolve(repoRoot, "registry");

const uiPrimitives = [
  "accordion",
  "alert",
  "alert-dialog",
  "aspect-ratio",
  "avatar",
  "badge",
  "blur-in",
  "breadcrumb",
  "button",
  "button-group",
  "calendar",
  "card",
  "carousel",
  "caret",
  "chart",
  "checkbox",
  "collapsible",
  "combobox",
  "command-menu",
  "context-menu",
  "cursor",
  "dialog",
  "drawer",
  "dropdown-menu",
  "empty",
  "field",
  "hover-card",
  "input",
  "input-group",
  "input-otp",
  "item",
  "kbd",
  "label",
  "menubar",
  "native-select",
  "navigation-menu",
  "pagination",
  "popover",
  "progress",
  "radio",
  "resizable",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "slider",
  "spinner",
  "stepper",
  "switch",
  "tabs",
  "table",
  "textarea",
  "toggle",
  "toast",
  "toggle-group",
  "tooltip",
] as const;

const transitionPrimitives = [
  "avatar-group-hover",
  "badge-pop",
  "card-resize",
  "icon-swap",
  "input-feedback",
  "menu-morph",
  "micro-transitions",
  "number-pop-in",
  "page-slide",
  "panel-reveal",
  "skeleton-reveal",
  "success-check",
  "tabs-slide-indicator",
  "text-state-swap",
  "text-stagger",
  "tilt-card",
] as const;

const uiFlows = [
  "ai-prompt-flow",
  "checkout-flow",
  "onboarding-stepper-flow",
  "settings-toggle-flow",
  "signup-flow",
] as const;

const typographyPrimitives = [
  "blur-out-up",
  "focus-blur-resolve",
  "kinetic-center-build",
  "line-by-line-slide",
  "marker-highlight",
  "mask-reveal-up",
  "masked-slide-reveal",
  "matrix-decode",
  "per-character-rise",
  "per-word-crossfade",
  "perspective-marquee",
  "rgb-glitch-text",
  "rolling-number",
  "scale-down-fade",
  "shared-axis-y",
  "shared-axis-z",
  "short-slide-down",
  "short-slide-right",
  "slot-machine-roll",
  "spring-scale-in",
  "staggered-fade-up",
  "strikethrough-replace",
  "top-down-letters",
  "typewriter",
] as const;

const remainingRemocnComponents = [
  "ai-generation-canvas",
  "animated-bar-chart",
  "animated-line-chart",
  "backdrop",
  "browser-flow",
  "chat-gpt",
  "chat-to-preview-layout",
  "chromatic-aberration-wipe",
  "claude-chat",
  "claude-code",
  "code-accordion",
  "code-diff-wipe",
  "command-menu-item",
  "confetti",
  "dashboard-populate",
  "data-flow-pipes",
  "device-mockup-zoom",
  "directional-wipe",
  "drag-and-drop-flow",
  "dropdown-menu-item",
  "ecosystem-constellation",
  "frosted-glass-wipe",
  "github-stars",
  "glass-code-block",
  "hero-device-assemble",
  "image-expand-to-fullscreen",
  "infinite-bento-pan",
  "infinite-marquee",
  "landing-code-showcase",
  "live-code-compilation",
  "mesh-gradient-bg",
  "micro-scale-fade",
  "opencode",
  "pricing-tier-focus",
  "progress-steps",
  "registry",
  "remocn-ui",
  "select-item",
  "skeleton-block",
  "spatial-push",
  "spotlight-card",
  "terminal-simulator",
  "terminal-to-browser-deploy",
  "tool-menu-slide-in",
  "v0",
  "x-follow-card",
  "x-followers-overview",
  "zoom-through-transition",
] as const;

const advancedHyperframesPrimitives = [
  "arc-motion-path",
  "bezier-callout-route",
  "orbital-feature-path",
  "svg-line-draw-loader",
  "stagger-lattice",
  "keyframe-scrub-stack",
  "three-orbiting-cards",
  "three-particle-ribbon",
  "shader-displacement-panel",
  "camera-rig-depth-stack",
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function expectRegisteredComponents(names: readonly string[], expectedTags: string[]): void {
  const registry = readJson<{ items: { name: string; type: string }[] }>(
    resolve(registryRoot, "registry.json"),
  );
  const componentEntries = new Map(
    registry.items
      .filter((item) => item.type === "hyperframes:component")
      .map((item) => [item.name, item]),
  );

  for (const name of names) {
    expect(componentEntries.has(name)).toBe(true);

    const componentDir = resolve(registryRoot, "components", name);
    const manifest = readJson<{
      type: string;
      tags?: string[];
      files?: { path: string; target: string; type: string }[];
    }>(resolve(componentDir, "registry-item.json"));

    expect(manifest.type).toBe("hyperframes:component");
    for (const tag of expectedTags) {
      expect(manifest.tags).toContain(tag);
    }
    expect(manifest.files).toEqual([
      {
        path: `${name}.html`,
        target: `compositions/components/${name}.html`,
        type: "hyperframes:snippet",
      },
    ]);
    expect(existsSync(resolve(componentDir, `${name}.html`))).toBe(true);
    expect(existsSync(resolve(componentDir, "demo.html"))).toBe(true);
  }
}

describe("remocn UI primitives catalog slice", () => {
  it("registers shadcn-style UI primitives as installable HyperFrames components", () => {
    expectRegisteredComponents(uiPrimitives, ["ui-primitive", "remocn-port"]);
  });

  it("ports transitions.dev-style microinteractions as deterministic transition primitives", () => {
    expectRegisteredComponents(transitionPrimitives, [
      "transition-primitive",
      "transitions-dev-port",
    ]);
  });

  it("registers composed Remocn UI flows as reusable agent building blocks", () => {
    expectRegisteredComponents(uiFlows, ["ui-flow", "remocn-port"]);
  });

  it("ports remocn typography motion primitives into HyperFrames snippets", () => {
    expectRegisteredComponents(typographyPrimitives, [
      "motion-primitive",
      "remocn-port",
      "typography",
    ]);
  });

  it("ports the remaining remocn showcase, effect, transition, and social entries", () => {
    expectRegisteredComponents(remainingRemocnComponents, ["remocn-port"]);
  });

  it("registers HyperFrames-native advanced motion primitives", () => {
    expectRegisteredComponents(advancedHyperframesPrimitives, ["hyperframes-native"]);
  });
});
