import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studioCss = readFileSync(new URL("../../styles/studio.css", import.meta.url), "utf8");
const timelineClipSource = readFileSync(new URL("./TimelineClip.tsx", import.meta.url), "utf8");
const playheadSource = readFileSync(new URL("./PlayheadIndicator.tsx", import.meta.url), "utf8");

const allowedTimelineTransitionProperties = [
  "background-color",
  "border-color",
  "box-shadow",
  "color",
  "opacity",
];

function expectRule(css: string, selector: string): string {
  const selectorStart = css.indexOf(`${selector} {`);
  expect(selectorStart).toBeGreaterThanOrEqual(0);

  const bodyStart = css.indexOf("{", selectorStart);
  const bodyEnd = css.indexOf("}", bodyStart);
  expect(bodyStart).toBeGreaterThanOrEqual(0);
  expect(bodyEnd).toBeGreaterThan(bodyStart);

  return css.slice(bodyStart + 1, bodyEnd).trim();
}

function expectDeclaration(ruleBody: string, property: string): string {
  const declarationMatch = new RegExp(`${property}:\\s*([^;]+);`).exec(ruleBody);
  expect(declarationMatch?.[1]).toBeDefined();
  return declarationMatch?.[1].trim() ?? "";
}

function transitionProperties(transitionDeclaration: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let item = "";

  for (const char of transitionDeclaration) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(item.trim());
      item = "";
      continue;
    }
    item += char;
  }

  if (item.trim().length > 0) items.push(item.trim());

  return items.map((transition) => transition.split(/\s+/)[0]);
}

describe("timeline motion styles", () => {
  it("keeps clip motion reduced-motion gated and layout safe", () => {
    const mediaStart = studioCss.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);

    const beforeMotionMedia = studioCss.slice(0, mediaStart);
    const baseTimelineClipRule = expectRule(beforeMotionMedia, ".timeline-clip");
    expect(baseTimelineClipRule).not.toContain("transition");

    const motionMediaCss = studioCss.slice(mediaStart);
    const timelineClipMotionRule = expectRule(motionMediaCss, ".timeline-clip");
    const clipTransition = expectDeclaration(timelineClipMotionRule, "transition");

    expect(transitionProperties(clipTransition)).toEqual(allowedTimelineTransitionProperties);
    expect(clipTransition).not.toMatch(/\b(?:all|left|width|top|bottom|transform)\b/);
  });

  it("layers the active mint bloom through opacity instead of a gradient background swap", () => {
    const baseTimelineClipRule = expectRule(studioCss, ".timeline-clip");
    const activeTimelineClipRule = expectRule(studioCss, ".timeline-clip[data-active]");
    const bloomOverlayRule = expectRule(studioCss, ".timeline-clip::before");
    const activeBloomOverlayRule = expectRule(studioCss, ".timeline-clip[data-active]::before");

    expect(baseTimelineClipRule).toContain("background-color: rgba(255, 255, 255, 0.055)");
    expect(activeTimelineClipRule).not.toContain("background: linear-gradient");
    expect(activeTimelineClipRule).toContain("border-color: rgba(60, 230, 172, 0.55)");
    expect(activeTimelineClipRule).not.toContain("box-shadow");
    expect(bloomOverlayRule).toContain("background: rgba(60, 230, 172, 0.2)");
    expect(bloomOverlayRule).not.toContain("linear-gradient");
    expect(bloomOverlayRule).toContain("opacity: 0");
    expect(activeBloomOverlayRule).toContain("opacity: 1");
  });

  it("targets trim handle bars without changing drag geometry", () => {
    const handleClassMatches = timelineClipSource.match(/className="timeline-clip__handle-bar"/g);

    expect(handleClassMatches).toHaveLength(2);
    expect(timelineClipSource).toContain('transform: isDragging ? "translateY(-1px)" : undefined');
    expect(timelineClipSource).not.toContain("scale(");
  });

  it("keeps the playhead polish static, without transition-driven positioning", () => {
    expect(playheadSource).toContain("boxShadow");
    expect(playheadSource).toContain("rotate(45deg)");
    expect(playheadSource).not.toContain("transition");
  });
});
