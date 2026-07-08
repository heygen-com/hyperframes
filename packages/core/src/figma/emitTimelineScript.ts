import type { GsapTween, MotionTimelineSpec, TimelineSpec, TimelineTween } from "./types";

function lit(value: string): string {
  return JSON.stringify(value);
}

function num(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function ms(value: number): number {
  return num(value * 1000);
}

function val(value: number | string): string {
  return typeof value === "number" ? String(num(value)) : JSON.stringify(value);
}

interface EmittedStep {
  value: number | string;
  duration: number;
  ease: string;
}

function emitKeyframes(
  property: string,
  steps: EmittedStep[],
  durationValue: (duration: number) => number,
  easeValue: (ease: string) => string,
): string {
  return steps
    .map(
      (s) =>
        `{ ${property}: ${val(s.value)}, duration: ${durationValue(s.duration)}, ease: ${easeValue(
          s.ease,
        )} }`,
    )
    .join(", ");
}

function emitTween(t: GsapTween): string[] {
  const set = `tl.set(${lit(t.selector)}, { ${t.property}: ${val(t.initial)} }, 0);`;
  const kf = emitKeyframes(t.property, t.steps, num, lit);
  const repeat = t.repeat > 0 ? `, repeat: ${t.repeat}` : "";
  return [set, `tl.to(${lit(t.selector)}, { keyframes: [${kf}]${repeat} }, 0);`];
}

export function emitTimelineScript(spec: TimelineSpec): string {
  const lines: string[] = [];
  // Guard the whole script: if the composition author forgot the GSAP or
  // CustomEase CDN tag, warn loudly instead of throwing mid-script and
  // silently never registering the timeline.
  lines.push("(function () {");
  const needsCustomEase = spec.customEases.length > 0;
  const missing = needsCustomEase
    ? 'typeof gsap === "undefined" || typeof CustomEase === "undefined"'
    : 'typeof gsap === "undefined"';
  const libs = needsCustomEase ? "gsap + CustomEase" : "gsap";
  lines.push(
    `if (${missing}) { console.warn(${lit(`figma timeline ${spec.timelineId}: ${libs} not loaded — add the CDN <script> tags before this one`)}); return; }`,
  );
  for (const ce of spec.customEases) {
    const [x1, y1, x2, y2] = ce.bezier;
    lines.push(
      `CustomEase.create(${lit(ce.name)}, "M0,0 C${num(x1)},${num(y1)} ${num(x2)},${num(y2)} 1,1");`,
    );
  }
  lines.push("const tl = gsap.timeline({ paused: true });");
  for (const t of spec.tweens) lines.push(...emitTween(t));
  lines.push("window.__timelines = window.__timelines || {};");
  lines.push(`window.__timelines[${lit(spec.timelineId)}] = tl;`);
  lines.push("})();");
  return lines.join("\n");
}

function emitAnimeEase(ease: string, customEaseNames: Set<string>): string {
  return customEaseNames.has(ease) ? ease : lit(ease);
}

function emitAnimeTween(t: TimelineTween, customEaseNames: Set<string>): string[] {
  const set = `tl.set(${lit(t.selector)}, { ${t.property}: ${val(t.initial)} }, 0);`;
  const kf = emitKeyframes(t.property, t.steps, ms, (ease) => emitAnimeEase(ease, customEaseNames));
  const loop = t.repeat > 0 ? `, loop: ${t.repeat + 1}` : "";
  return [set, `tl.add(${lit(t.selector)}, { keyframes: [${kf}]${loop} }, 0);`];
}

export function emitAnimeTimelineScript(spec: MotionTimelineSpec): string {
  const lines: string[] = [];
  const customEaseNames = new Set(spec.customEases.map((ease) => ease.name));
  lines.push("(function () {");
  lines.push(
    `if (typeof anime === "undefined" || typeof hyperframesAnime === "undefined") { console.warn(${lit(`figma timeline ${spec.timelineId}: anime + hyperframesAnime not loaded — add the CDN/runtime <script> tags before this one`)}); return; }`,
  );
  for (const ease of spec.customEases) {
    lines.push(`const ${ease.name} = ${ease.ease};`);
  }
  lines.push("const tl = anime.createTimeline({ autoplay: false });");
  for (const tween of spec.tweens) lines.push(...emitAnimeTween(tween, customEaseNames));
  lines.push(`hyperframesAnime.register(${lit(spec.timelineId)}, tl, { labels: {} });`);
  lines.push("})();");
  return lines.join("\n");
}
