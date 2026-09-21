import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studioCss = readFileSync(new URL("../../styles/studio.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../../styles/theme.css", import.meta.url), "utf8");
const timelineOverlaySources = [
  "TimelineShortcutHint.tsx",
  "LayerDisclosureRow.tsx",
  "ImageThumbnail.tsx",
  "AudioWaveform.tsx",
  "VideoThumbnail.tsx",
].map((fileName) => readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8"));
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

function themeTokenValue(token: string): string {
  const match = new RegExp(`${token}:\\s*([^;]+);`).exec(themeCss);
  expect(match?.[1]).toBeDefined();
  return match?.[1].trim() ?? "";
}

describe("timeline motion styles", () => {
  it.each([
    ["--timeline-track-label", "rgba(255, 255, 255, 0.5)"],
    ["--timeline-tick-text", "rgba(255, 255, 255, 0.34)"],
    ["--timeline-border-strong", "rgba(255, 255, 255, 0.2)"],
    ["--timeline-group-member-tint", "rgba(255, 255, 255, 0.035)"],
    ["--timeline-overlay-text", "rgba(255, 255, 255, 0.8)"],
    ["--timeline-clip-shadow-dragging", "rgba(0, 0, 0, 0.4)"],
    ["--timeline-playhead-glow", "rgba(60, 230, 172, 0.14)"],
    ["--timeline-playhead-shadow", "rgba(0, 0, 0, 0.55)"],
  ])("keeps the migrated default for %s", (token, expected) => {
    expect(themeTokenValue(token)).toBe(expected);
  });

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
    const timelineClipLabelRule = expectRule(studioCss, ".timeline-clip__label");
    const activeTimelineClipLabelRule = expectRule(
      studioCss,
      ".timeline-clip[data-active] .timeline-clip__label",
    );
    const timelineClipTimecodeRule = expectRule(studioCss, ".timeline-clip__timecode");
    const audioClipRule = expectRule(studioCss, ".timeline-clip.is-audio");
    const audioClipHoverRule = expectRule(studioCss, ".timeline-clip.is-audio.is-hovered");
    const audioClipDraggingRule = expectRule(studioCss, ".timeline-clip.is-audio.is-dragging");
    const activeTimelineClipRule = expectRule(studioCss, ".timeline-clip[data-active]");
    const selectedTimelineClipRule = expectRule(studioCss, ".timeline-clip.is-selected");
    const activeSelectedTimelineClipRule = expectRule(
      studioCss,
      ".timeline-clip[data-active].is-selected",
    );
    const selectedDraggingTimelineClipRule = expectRule(
      studioCss,
      ".timeline-clip.is-selected.is-dragging",
    );
    const bloomOverlayRule = expectRule(studioCss, ".timeline-clip::before");
    const activeBloomOverlayRule = expectRule(studioCss, ".timeline-clip[data-active]::before");

    expect(baseTimelineClipRule).toContain("background-color: var(--clip-bg)");
    expect(baseTimelineClipRule).toContain("border: 1px solid var(--clip-border)");
    expect(timelineClipLabelRule).toContain("color: var(--timeline-track-label)");
    expect(timelineClipLabelRule).toContain("text-shadow: var(--timeline-clip-label-shadow)");
    expect(timelineClipTimecodeRule).toContain("color: var(--timeline-tick-text)");
    expect(activeTimelineClipLabelRule).toContain("color: var(--timeline-clip-label-active)");
    expect(themeCss).toContain("--timeline-clip-bg: rgba(255, 255, 255, 0.12)");
    expect(themeCss).toContain("--timeline-clip-border: rgba(255, 255, 255, 0.22)");
    expect(themeCss).toContain("--timeline-track-label: rgba(255, 255, 255, 0.5)");
    expect(themeCss).toContain("--timeline-tick-text: rgba(255, 255, 255, 0.34)");
    expect(themeCss).toContain("--timeline-clip-label-active: rgba(232, 255, 247, 0.95)");
    expect(themeCss).toContain("--timeline-clip-label-shadow: 0 1px 2px rgba(0, 0, 0, 0.85)");
    expect(themeCss).toContain("--timeline-clip-selection: rgba(255, 255, 255, 0.85)");
    expect(themeCss).toContain("--timeline-clip-audio-bg: rgba(167, 139, 250, 0.16)");
    expect(themeCss).toContain("--timeline-clip-audio-border: rgba(167, 139, 250, 0.4)");
    expect(themeCss).toContain("--timeline-clip-audio-bg-hover: rgba(167, 139, 250, 0.24)");
    expect(themeCss).toContain("--timeline-clip-audio-bg-dragging: rgba(60, 52, 84, 0.96)");
    expect(audioClipRule).toContain("background-color: var(--timeline-clip-audio-bg)");
    expect(audioClipRule).toContain("border-color: var(--timeline-clip-audio-border)");
    expect(audioClipHoverRule).toContain("background-color: var(--timeline-clip-audio-bg-hover)");
    expect(audioClipDraggingRule).toContain(
      "background-color: var(--timeline-clip-audio-bg-dragging)",
    );
    expect(themeCss).toContain("--timeline-clip-selection: rgba(255, 255, 255, 0.85)");
    expect(selectedTimelineClipRule).toContain(
      "box-shadow: inset 0 0 0 1.5px var(--timeline-clip-selection)",
    );
    expect(activeSelectedTimelineClipRule).toContain(
      "box-shadow: inset 0 0 0 1.5px var(--timeline-clip-selection)",
    );
    expect(selectedDraggingTimelineClipRule).toContain(
      "inset 0 0 0 1.5px var(--timeline-clip-selection)",
    );
    expect(selectedDraggingTimelineClipRule).toContain(
      "0 8px 24px var(--timeline-clip-shadow-dragging)",
    );
    expect(activeTimelineClipRule).not.toContain("background: linear-gradient");
    expect(activeTimelineClipRule).toContain("border-color: var(--clip-border-active)");
    expect(activeTimelineClipRule).not.toContain("box-shadow");
    expect(bloomOverlayRule).toContain("background: var(--clip-bg-active)");
    expect(bloomOverlayRule).not.toContain("linear-gradient");
    expect(bloomOverlayRule).toContain("opacity: 0");
    expect(activeBloomOverlayRule).toContain("opacity: 1");
  });

  it("routes timeline overlay colours through theme tokens", () => {
    const overlaySource = timelineOverlaySources.join("\n");

    expect(overlaySource).toContain("var(--timeline-shortcut-bg)");
    expect(overlaySource).toContain("var(--timeline-thumbnail-shimmer)");
    expect(overlaySource).toContain("var(--timeline-thumbnail-label-gradient)");
    expect(overlaySource).toContain("var(--timeline-thumbnail-label-shadow)");
    expect(overlaySource).toContain('"--timeline-waveform-bar-rgb"');
    expect(overlaySource).toContain("var(--timeline-waveform-error)");
    expect(overlaySource).toContain("var(--timeline-waveform-label-shadow)");
    expect(overlaySource).toContain("var(--timeline-text-solid)");
    expect(overlaySource).toContain("var(--timeline-accent)");
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
