import { useRef, useState } from "react";
import { projectAxes, projectCubeFaces, wrapDeg } from "./transform3dProjection";

export interface CubePose {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

const VIEW_W = 132;
const VIEW_H = 112;
const CX = VIEW_W / 2;
const CY = 54;
const RADIUS = 26;
// The cube mirrors the element's orientation 1:1 — no decorative viewing camera,
// so at rotation 0/0/0 it faces front (flat) exactly like the un-rotated element.
// The X/Y/Z axis gizmo keeps the flat-at-rest state readable.
const SENSITIVITY = 0.6; // degrees per pixel of drag

/**
 * Draggable 3D-orientation cube. Drag to tilt (X/Y); Shift-drag to roll (Z).
 * Presentational only: emits a live draft pose while dragging and a final pose
 * on release — the parent owns live-previewing and committing to GSAP props.
 */
// transformPerspective (px) is inversely related to effect strength, with 0 = off.
// Map a 0..1 slider strength to px and to the cube's weak-perspective projection.
const STRONG_PX = 200;
const WEAK_PX = 1600;
const PX_RANGE = WEAK_PX - STRONG_PX;
const strengthToPx = (s: number) => (s <= 0.01 ? 0 : Math.round(WEAK_PX - s * PX_RANGE));
const pxToStrength = (px: number) =>
  px <= 0
    ? 0
    : Math.max(0, Math.min(1, (WEAK_PX - Math.max(STRONG_PX, Math.min(WEAK_PX, px))) / PX_RANGE));
const pxToProjPersp = (px: number) => (px > 0 ? Math.max(2.2, Math.min(14, px / 130)) : 14);

/** Horizontal "perspective strength" slider — left = none, right = dramatic. */
function PerspectiveSlider({
  value,
  onDraft,
  onCommit,
}: {
  value: number;
  onDraft?: (px: number) => void;
  onCommit: (px: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const strength = pxToStrength(value);
  const fromEvent = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return strengthToPx(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
      <span className="text-[8px] font-medium uppercase tracking-wide text-neutral-600">Persp</span>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          onDraft?.(fromEvent(e.clientX));
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) onDraft?.(fromEvent(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          onCommit(fromEvent(e.clientX));
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        className="relative h-3 flex-1 cursor-ew-resize touch-none"
      >
        <div className="absolute top-1/2 h-0.5 w-full -translate-y-1/2 rounded-full bg-neutral-700" />
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[#5ff0bf]"
          style={{ width: `${strength * 100}%` }}
        />
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-900 bg-[#5ff0bf]"
          style={{ left: `${strength * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Transform3DCube({
  pose,
  perspective = 0,
  onPoseDraft,
  onPoseCommit,
  onPerspectiveDraft,
  onPerspectiveCommit,
  onRecenter,
  onKeyframe,
  keyframed,
}: {
  pose: CubePose;
  /** Element's transformPerspective (px); drives the cube's foreshortening. */
  perspective?: number;
  /** Fires on every drag move with the in-progress pose (parent live-previews). */
  onPoseDraft?: (pose: CubePose) => void;
  /** Fires once on pointer release with the final pose (commit). */
  onPoseCommit: (pose: CubePose) => void;
  /** Live + committed perspective (px) from the in-cube slider. */
  onPerspectiveDraft?: (px: number) => void;
  onPerspectiveCommit?: (px: number) => void;
  /** Reset to identity orientation. */
  onRecenter?: () => void;
  /** Toggle keyframing the 3D transform (convert the static set → keyframes). */
  onKeyframe?: () => void;
  /** Whether the 3D transform is already keyframed (drives the toggle's state). */
  keyframed?: boolean;
}) {
  const [draft, setDraft] = useState<CubePose | null>(null);
  const dragRef = useRef<{ x: number; y: number; pose: CubePose } | null>(null);
  const shown = draft ?? pose;
  const projOpts = {
    cx: CX,
    cy: CY,
    r: RADIUS,
    persp: pxToProjPersp(perspective),
  };
  const faces = projectCubeFaces(shown.rotationX, shown.rotationY, shown.rotationZ, projOpts);
  const axes = projectAxes(shown.rotationX, shown.rotationY, shown.rotationZ, projOpts);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, pose: shown };
    setDraft(shown);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const next: CubePose = e.shiftKey
      ? { ...d.pose, rotationZ: wrapDeg(d.pose.rotationZ + dx * SENSITIVITY) }
      : {
          rotationX: wrapDeg(d.pose.rotationX - dy * SENSITIVITY),
          rotationY: wrapDeg(d.pose.rotationY + dx * SENSITIVITY),
          rotationZ: d.pose.rotationZ,
        };
    setDraft(next);
    onPoseDraft?.(next);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (draft) onPoseCommit(draft);
    setDraft(null);
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="Drag to rotate in 3D; hold Shift to roll"
        aria-valuetext={`X ${Math.round(shown.rotationX)}°, Y ${Math.round(
          shown.rotationY,
        )}°, Z ${Math.round(shown.rotationZ)}°`}
      >
        <defs>
          <radialGradient id="cube3d-bg" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#172220" />
            <stop offset="100%" stopColor="#070a09" />
          </radialGradient>
          {/* Soft halo so the cube floats; SourceGraphic stays crisp on top. */}
          <filter id="cube3d-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#cube3d-bg)" />
        {/* Grounding shadow under the cube. */}
        <ellipse
          cx={CX}
          cy={CY + RADIUS + 22}
          rx={RADIUS * 1.2}
          ry={6.5}
          fill="#000"
          opacity={0.4}
        />
        {/* Away-facing axes are drawn behind the cube, dimmed. */}
        {axes
          .filter((a) => !a.front)
          .map((a) => (
            <line
              key={a.id}
              x1={CX}
              y1={CY}
              x2={a.x2}
              y2={a.y2}
              stroke={a.color}
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={0.3}
            />
          ))}
        <g filter="url(#cube3d-glow)">
          {faces.map((f) => (
            <polygon
              key={f.id}
              points={f.points}
              // Muted teal face, lit by direction; edges are a soft mint that
              // brightens with how front-facing the face is, so corners read as
              // crisp bevels instead of flat neon outlines.
              fill={`hsl(166 44% ${Math.round(17 + f.shade * 37)}%)`}
              stroke={`hsl(164 72% ${Math.round(56 + f.shade * 22)}%)`}
              strokeWidth={1.1}
              strokeOpacity={0.82}
              strokeLinejoin="round"
              strokeLinecap="round"
              paintOrder="stroke"
            />
          ))}
        </g>
        {/* Toward-facing axes on top, with a tip dot + X/Y/Z label. */}
        {axes
          .filter((a) => a.front)
          .map((a) => (
            <g key={a.id}>
              <line
                x1={CX}
                y1={CY}
                x2={a.x2}
                y2={a.y2}
                stroke={a.color}
                strokeWidth={1.6}
                strokeLinecap="round"
                opacity={0.95}
              />
              <circle cx={a.x2} cy={a.y2} r={2.4} fill={a.color} />
              <text
                x={a.x2 + (a.x2 - CX) * 0.12}
                y={a.y2 + (a.y2 - CY) * 0.12 + 2}
                fill={a.color}
                fontSize={7}
                fontWeight={700}
                textAnchor="middle"
              >
                {a.id.toUpperCase()}
              </text>
            </g>
          ))}
      </svg>
      {onRecenter && (
        <button
          type="button"
          onClick={onRecenter}
          title="Reset 3D orientation"
          aria-label="Reset 3D orientation"
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="9" strokeWidth="2" />
            <path d="M12 3v18M3 12h18" strokeWidth="1.5" />
          </svg>
        </button>
      )}
      {onKeyframe && (
        <button
          type="button"
          onClick={onKeyframe}
          title={
            keyframed
              ? "3D transform is keyframed — click a field diamond to add keyframes"
              : "Keyframe the 3D transform (animate it over time)"
          }
          aria-label="Keyframe 3D transform"
          aria-pressed={keyframed}
          className={`absolute left-1.5 top-1.5 rounded p-0.5 hover:bg-neutral-800 ${
            keyframed ? "text-[#5ff0bf]" : "text-neutral-500 hover:text-neutral-200"
          }`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill={keyframed ? "currentColor" : "none"}
            stroke="currentColor"
          >
            <path d="M6 1.5L10.5 6 6 10.5 1.5 6z" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {onPerspectiveCommit && (
        <PerspectiveSlider
          value={perspective}
          onDraft={onPerspectiveDraft}
          onCommit={onPerspectiveCommit}
        />
      )}
    </div>
  );
}
