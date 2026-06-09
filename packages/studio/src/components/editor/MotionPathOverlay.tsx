import { memo, useMemo, type RefObject } from "react";
import type { ArcPathConfig } from "@hyperframes/core/gsap-parser";

interface MotionPathOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  arcPath: ArcPathConfig | null;
  waypoints: Array<{ x: number; y: number }> | null;
  elementBaseRect: { left: number; top: number; scaleX: number; scaleY: number } | null;
}

function buildSvgPath(
  waypoints: Array<{ x: number; y: number }>,
  segments: ArcPathConfig["segments"],
  base: { left: number; top: number; scaleX: number; scaleY: number },
): string {
  if (waypoints.length < 2) return "";

  const toPixel = (wp: { x: number; y: number }) => ({
    x: base.left + wp.x * base.scaleX,
    y: base.top + wp.y * base.scaleY,
  });

  const first = toPixel(waypoints[0]!);
  const parts = [`M ${first.x} ${first.y}`];

  for (let i = 0; i < segments.length && i < waypoints.length - 1; i++) {
    const seg = segments[i]!;
    const end = toPixel(waypoints[i + 1]!);

    if (seg.cp1 && seg.cp2) {
      const c1 = toPixel(seg.cp1);
      const c2 = toPixel(seg.cp2);
      parts.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`);
    } else {
      const start = toPixel(waypoints[i]!);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const c = seg.curviness ?? 1;
      const offset = c * Math.abs(dx) * 0.25;
      const c1x = start.x + dx * 0.33;
      const c1y = start.y + dy * 0.33 - offset;
      const c2x = start.x + dx * 0.66;
      const c2y = start.y + dy * 0.66 - offset;
      parts.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${end.x} ${end.y}`);
    }
  }

  return parts.join(" ");
}

export const MotionPathOverlay = memo(function MotionPathOverlay({
  arcPath,
  waypoints,
  elementBaseRect,
}: MotionPathOverlayProps) {
  const pathD = useMemo(() => {
    if (!arcPath?.enabled || !waypoints || waypoints.length < 2 || !elementBaseRect) return "";
    return buildSvgPath(waypoints, arcPath.segments, elementBaseRect);
  }, [arcPath, waypoints, elementBaseRect]);

  const anchorPoints = useMemo(() => {
    if (!waypoints || !elementBaseRect) return [];
    return waypoints.map((wp) => ({
      x: elementBaseRect.left + wp.x * elementBaseRect.scaleX,
      y: elementBaseRect.top + wp.y * elementBaseRect.scaleY,
    }));
  }, [waypoints, elementBaseRect]);

  const controlPoints = useMemo(() => {
    if (!arcPath?.enabled || !elementBaseRect) return [];
    const points: Array<{
      segIndex: number;
      type: "cp1" | "cp2";
      x: number;
      y: number;
      anchorX: number;
      anchorY: number;
    }> = [];
    for (let i = 0; i < arcPath.segments.length; i++) {
      const seg = arcPath.segments[i]!;
      if (seg.cp1 && seg.cp2 && waypoints) {
        const anchor1 = waypoints[i]!;
        const anchor2 = waypoints[i + 1]!;
        points.push({
          segIndex: i,
          type: "cp1",
          x: elementBaseRect.left + seg.cp1.x * elementBaseRect.scaleX,
          y: elementBaseRect.top + seg.cp1.y * elementBaseRect.scaleY,
          anchorX: elementBaseRect.left + anchor1.x * elementBaseRect.scaleX,
          anchorY: elementBaseRect.top + anchor1.y * elementBaseRect.scaleY,
        });
        points.push({
          segIndex: i,
          type: "cp2",
          x: elementBaseRect.left + seg.cp2.x * elementBaseRect.scaleX,
          y: elementBaseRect.top + seg.cp2.y * elementBaseRect.scaleY,
          anchorX: elementBaseRect.left + anchor2.x * elementBaseRect.scaleX,
          anchorY: elementBaseRect.top + anchor2.y * elementBaseRect.scaleY,
        });
      }
    }
    return points;
  }, [arcPath, waypoints, elementBaseRect]);

  if (!pathD) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none z-20 overflow-visible">
      <path d={pathD} fill="none" stroke="rgba(45, 212, 191, 0.4)" strokeWidth={2} />

      {controlPoints.map((cp) => (
        <g key={`${cp.segIndex}-${cp.type}`}>
          <line
            x1={cp.anchorX}
            y1={cp.anchorY}
            x2={cp.x}
            y2={cp.y}
            stroke="rgba(167, 139, 250, 0.3)"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          <circle
            cx={cp.x}
            cy={cp.y}
            r={4}
            fill="#a78bfa"
            className="pointer-events-auto cursor-grab"
          />
        </g>
      ))}

      {anchorPoints.map((pt, i) => (
        <circle
          key={i}
          cx={pt.x}
          cy={pt.y}
          r={5}
          fill="#3CE6AC"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={1}
          className="pointer-events-auto cursor-pointer"
        />
      ))}
    </svg>
  );
});
