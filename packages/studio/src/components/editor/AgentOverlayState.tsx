import type { CSSProperties, ReactNode } from "react";
import type { OverlayRect } from "./domEditOverlayGeometry";
import studioPreset from "../../styles/tailwind-preset.shared.js";
import type { OverlayKind, OverlayState } from "./overlayState";
import { ThinkingOrb } from "./ThinkingOrb";

/**
 * Renders an OverlayState on the selected element.
 *
 * Treatments live in one registry keyed by `kind` and `kind:scope`, so a new
 * state is an entry here rather than a change to this component, and a state
 * Studio does not recognise falls back to the plain editing sweep instead of
 * vanishing. Everything is additive: the chrome, the handles and the rotation
 * control keep working while an agent runs.
 */

/** The glyph set, drawn for this overlay: each mark mirrors its own treatment. */
const GLYPH_PATHS: Record<string, ReactNode> = {
  queued: (
    <>
      <path d="M2.75 3.5v9" />
      <path d="M6.25 4.75h7" />
      <path d="M6.25 8h7" />
      <path d="M6.25 11.25h7" />
    </>
  ),
  // The marching ants themselves.
  reading: (
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.25" strokeDasharray="3.3 2.5" />
  ),
  editing: (
    <>
      <path d="M2.75 13.25 4 9.75l7-7a1.8 1.8 0 0 1 2.5 2.5l-7 7z" />
      <path d="M9.5 4.25 11.75 6.5" />
    </>
  ),
  // A caret sitting on the rule that draws itself under the copy.
  text: (
    <>
      <path d="M2.75 5.25h6.25" />
      <path d="M11.5 3.25v6" />
      <path d="M2.75 12.75h10.5" />
    </>
  ),
  // The corner handles that pulse on the element.
  box: (
    <>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.25" />
      <circle cx="3.5" cy="3.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // A dot that has left its path behind.
  motion: (
    <>
      <path d="M3.5 11.75C5 6.5 8.75 4.25 12.5 4.75" />
      <circle cx="3.5" cy="11.75" r="1.6" />
      <circle cx="12.5" cy="4.75" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  // The neutral live state: something is happening on this box, kind unknown.
  working: (
    <>
      <rect x="3" y="3" width="10" height="10" rx="2.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // A question mark: the run is not working on anything, it is asking.
  asking: (
    <>
      <path d="M5.75 5.75a2.25 2.25 0 1 1 2.75 2.2v1.55" />
      <circle cx="8.5" cy="12.25" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  done: <path d="M3.25 8.5 6.5 11.75 12.75 4.5" />,
  failed: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M4.75 11.25 11.25 4.75" />
    </>
  ),
};

function OverlayGlyph({ name }: { name: string }) {
  const path = GLYPH_PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-[13px] w-[13px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

interface Treatment {
  tint: string;
  /** Glyph key, or "orb" for the thinking indicator. */
  glyph: string;
  render?: () => ReactNode;
}

const OUTLINE = "pointer-events-none absolute -inset-[9px] rounded-[3px]";

/**
 * The overlay's palette. Accent and danger come from Studio's own theme rather
 * than a second copy of the same hex; reading and thinking need hues the theme
 * does not carry, and they live here because this is the only thing that uses
 * them. Any of it can be overridden per run by a declared `accent`.
 */
const STUDIO_ACCENT = studioPreset.theme.extend.colors.studio.accent;
const STUDIO_DANGER = studioPreset.theme.extend.colors.panel.danger;
const QUIET = studioPreset.theme.extend.colors.panel["text-3"];
const READING_TINT = "#7aa2ff";
/** Amber, the one colour on the canvas that means "this is on you". */
const ASKING_TINT = "#f5b73d";
const THINKING_TINT = "#b79cff";

/** A light travelling the outline, with a soft glow behind it. */
const WORKING_SWEEP = (
  <>
    <div className="hf-overlay-aura pointer-events-none absolute -inset-[9px]" />
    <div
      className="hf-overlay-glow pointer-events-none absolute -inset-[9px] rounded-[5px]"
      style={{ boxShadow: "0 0 24px -4px var(--hf-overlay-tint)" }}
    />
  </>
);

/**
 * Keyed by `kind`, then `kind:scope`. The scoped entries are what an agent
 * unlocks by declaring what its edit is about; without a scope every edit is
 * the same sweep.
 */
const TREATMENTS: Record<string, Treatment> = {
  queued: {
    tint: QUIET,
    glyph: "queued",
    render: () => <div className={`${OUTLINE} border border-dashed border-white/25`} />,
  },
  reading: {
    tint: READING_TINT,
    glyph: "reading",
    render: () => (
      <svg
        className="hf-overlay-ants pointer-events-none absolute -left-[9px] -top-[9px] block overflow-visible"
        style={{ width: "calc(100% + 18px)", height: "calc(100% + 18px)" }}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* An <svg> is a replaced element: it needs a real width and height, an
            inset alone leaves it at its intrinsic size. */}
        <rect x="0" y="0" width="100%" height="100%" rx="3" />
      </svg>
    ),
  },
  thinking: {
    tint: THINKING_TINT,
    glyph: "orb",
    render: () => (
      <div
        className={`${OUTLINE} border border-dashed`}
        style={{ borderColor: "var(--hf-overlay-tint)" }}
      />
    ),
  },
  // A live run with nothing declared. Same sweep as a declared edit: Studio
  // knows work is happening, not what kind, and says exactly that.
  working: {
    tint: STUDIO_ACCENT,
    glyph: "working",
    render: () => WORKING_SWEEP,
  },
  editing: {
    tint: STUDIO_ACCENT,
    glyph: "editing",
    render: () => WORKING_SWEEP,
  },
  // The change is inside the copy, so the box is left alone.
  "editing:text": {
    tint: STUDIO_ACCENT,
    glyph: "text",
    render: () => (
      <>
        <div
          className="hf-overlay-rule pointer-events-none absolute -bottom-[6px] left-0 right-0 h-[1.5px]"
          style={{
            background:
              "linear-gradient(90deg, var(--hf-overlay-tint), color-mix(in oklab, var(--hf-overlay-tint) 25%, transparent))",
          }}
        />
        <div
          className="hf-overlay-caret pointer-events-none absolute -right-[6px] bottom-1 top-1 w-[2px] rounded-[1px]"
          style={{ background: "var(--hf-overlay-tint)" }}
        />
      </>
    ),
  },
  // The corners breathe instead of the whole outline, pointing at the part of
  // the box being changed.
  "editing:box": {
    tint: STUDIO_ACCENT,
    glyph: "box",
    render: () => (
      <>
        {(["nw", "ne", "sw", "se"] as const).map((corner, index) => (
          <div
            key={corner}
            className="hf-overlay-corner pointer-events-none absolute h-[14px] w-[14px] border-[1.5px]"
            style={{
              borderColor: "var(--hf-overlay-tint)",
              animationDelay: `${index * 0.12}s`,
              ...CORNER_SIDES[corner],
            }}
          />
        ))}
      </>
    ),
  },
  // The element is staying put; its animation is what is moving.
  "editing:motion": {
    tint: THINKING_TINT,
    glyph: "motion",
    render: () => (
      <div
        className="hf-overlay-ghost pointer-events-none absolute -inset-[9px] rounded-[3px] border border-dashed"
        style={{ borderColor: "color-mix(in oklab, var(--hf-overlay-tint) 55%, transparent)" }}
      />
    ),
  },
  asking: {
    tint: ASKING_TINT,
    glyph: "asking",
    // Solid and still, where every working state moves: a run that has stopped
    // must not look like one that is getting on with it.
    render: () => (
      <div
        className={`${OUTLINE} border-2`}
        style={{
          borderColor: "var(--hf-overlay-tint)",
          boxShadow: "0 0 30px -6px var(--hf-overlay-tint)",
        }}
      />
    ),
  },
  done: {
    tint: STUDIO_ACCENT,
    glyph: "done",
    render: () => (
      <div
        className={`${OUTLINE} border`}
        style={{
          borderColor: "var(--hf-overlay-tint)",
          boxShadow: "0 0 26px -6px var(--hf-overlay-tint)",
        }}
      />
    ),
  },
  failed: {
    tint: STUDIO_DANGER,
    glyph: "failed",
    render: () => (
      <div className={`${OUTLINE} border`} style={{ borderColor: "var(--hf-overlay-tint)" }} />
    ),
  },
};

const CORNER_SIDES: Record<string, CSSProperties> = {
  nw: { left: -11, top: -11, borderRight: 0, borderBottom: 0, borderRadius: "3px 0 0 0" },
  ne: { right: -11, top: -11, borderLeft: 0, borderBottom: 0, borderRadius: "0 3px 0 0" },
  sw: { left: -11, bottom: -11, borderRight: 0, borderTop: 0, borderRadius: "0 0 0 3px" },
  se: { right: -11, bottom: -11, borderLeft: 0, borderTop: 0, borderRadius: "0 0 3px 0" },
};

/** Scoped treatment when there is one, else the plain state, else editing. */
export function resolveTreatment(state: OverlayState): Treatment {
  return (
    (state.scope ? TREATMENTS[`${state.kind}:${state.scope}`] : undefined) ??
    TREATMENTS[state.kind] ??
    TREATMENTS.working!
  );
}

/** Default label when the agent declared a state but no words for it. */
const KIND_LABELS: Record<OverlayKind, string> = {
  queued: "Queued",
  working: "Working",
  reading: "Reading",
  thinking: "Thinking",
  editing: "Editing",
  asking: "Needs you",
  done: "Done",
  failed: "Failed",
};

export function AgentOverlayState({
  state,
  rect,
  toContainerStyle,
  pillSide = "above",
}: {
  state: OverlayState;
  rect: OverlayRect;
  /** Maps overlay-local coordinates into wherever this is actually drawn. */
  toContainerStyle: (style: CSSProperties) => CSSProperties;
  /** Side the label takes, so it never lands under the composer. */
  pillSide?: "above" | "below";
}) {
  const treatment = resolveTreatment(state);
  const tint = state.accent ?? treatment.tint;
  const label = state.label ?? KIND_LABELS[state.kind];
  const [verb, file] = label.split(" · ");

  return (
    <div
      aria-hidden="true"
      data-agent-overlay-state={state.kind}
      className="pointer-events-none"
      style={{
        ...toContainerStyle({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }),
        ["--hf-overlay-tint" as string]: tint,
      }}
    >
      {/* The treatment turns with the element — it is decorating the element's
          own geometry — while the badge stays upright outside the rotation. A
          label rotated with its subject is unreadable, and a flipped element
          (180°) rendered its badge in mirror writing. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: rect.angle ? `rotate(${rect.angle}deg)` : undefined }}
      >
        {treatment.render?.()}
      </div>
      <span
        className="absolute flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[7px] pl-[7px] pr-2 text-[11px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.5),0_6px_16px_-8px_rgba(0,0,0,0.7)]"
        style={{
          left: -9,
          [pillSide === "above" ? "bottom" : "top"]: "calc(100% + 15px)",
          background: "color-mix(in oklab, var(--hf-overlay-tint) 16%, #0b0b0f)",
          outline: "1px solid color-mix(in oklab, var(--hf-overlay-tint) 34%, transparent)",
          color: "color-mix(in oklab, var(--hf-overlay-tint) 70%, #ffffff)",
        }}
      >
        {treatment.glyph === "orb" ? <ThinkingOrb /> : <OverlayGlyph name={treatment.glyph} />}
        {verb}
        {file && (
          <>
            <span style={{ color: "color-mix(in oklab, var(--hf-overlay-tint) 30%, #6b6b74)" }}>
              ·
            </span>
            <span
              className="font-mono text-[10.5px] leading-none"
              style={{ color: "color-mix(in oklab, var(--hf-overlay-tint) 38%, #a9a9b2)" }}
            >
              {file}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
