import { useRef, useState } from "react";
import { projectCubeFaces, wrapDeg } from "./transform3dProjection";

export interface CubePose {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

const VIEW = 120;
const CENTER = VIEW / 2;
const RADIUS = 30;
const SENSITIVITY = 0.6; // degrees per pixel of drag

/**
 * Draggable 3D-orientation cube. Drag to tilt (X/Y); Shift-drag to roll (Z).
 * Presentational only: it renders the pose and emits draft poses while dragging
 * plus a final pose on release — the parent owns committing to GSAP props.
 */
export function Transform3DCube({
  pose,
  onPoseDraft,
  onPoseCommit,
  onRecenter,
}: {
  pose: CubePose;
  /** Fires on every drag move with the in-progress pose (live preview). */
  onPoseDraft?: (pose: CubePose) => void;
  /** Fires once on pointer release with the final pose (commit). */
  onPoseCommit: (pose: CubePose) => void;
  /** Reset to identity orientation. */
  onRecenter?: () => void;
}) {
  const [draft, setDraft] = useState<CubePose | null>(null);
  const dragRef = useRef<{ x: number; y: number; pose: CubePose } | null>(null);
  const shown = draft ?? pose;
  const faces = projectCubeFaces(shown.rotationX, shown.rotationY, shown.rotationZ, {
    cx: CENTER,
    cy: CENTER,
    r: RADIUS,
  });

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
    <div className="relative rounded-lg bg-neutral-900/50 p-2">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ aspectRatio: "1 / 1" }}
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
        {faces.map((f) => (
          <polygon
            key={f.id}
            points={f.points}
            fill={`hsl(162 58% ${Math.round(16 + f.shade * 46)}%)`}
            stroke="#3CE6AC"
            strokeWidth={1}
            strokeLinejoin="round"
            opacity={0.92}
          />
        ))}
        {/* Center handle dot — the grab indicator. */}
        <circle cx={CENTER} cy={CENTER} r={3.2} fill="#3CE6AC" />
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
    </div>
  );
}
