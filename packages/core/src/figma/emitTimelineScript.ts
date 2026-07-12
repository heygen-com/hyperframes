import type { GsapTween, TimelineSpec } from "./types";

function lit(value: string): string {
  return JSON.stringify(value);
}

function num(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function val(value: number | string): string {
  return typeof value === "number" ? String(num(value)) : JSON.stringify(value);
}

function emitTween(t: GsapTween): string[] {
  const set = `tl.set(${lit(t.selector)}, { ${t.property}: ${val(t.initial)} }, 0);`;
  const kf = t.steps
    .map(
      (s) =>
        `{ ${t.property}: ${val(s.value)}, duration: ${num(s.duration)}, ease: ${lit(s.ease)} }`,
    )
    .join(", ");
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
