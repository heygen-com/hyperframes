import { FRAME_STATUS_META, FRAME_STATUS_ORDER } from "./frameStatus";

/**
 * Explains the frame lifecycle: a frame advances outline → built → animated.
 * Mirrors the status chips on each tile (shares FRAME_STATUS_META).
 */
export function StoryboardStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-neutral-500">
      <span className="uppercase tracking-wider text-neutral-600">Status</span>
      {FRAME_STATUS_ORDER.map((status, i) => (
        <span key={status} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-neutral-700">→</span>}
          <span className={`h-2 w-2 rounded-full ${FRAME_STATUS_META[status].dotClass}`} />
          <span className="font-medium text-neutral-300">{FRAME_STATUS_META[status].label}</span>
          <span className="text-neutral-500">— {FRAME_STATUS_META[status].description}</span>
        </span>
      ))}
    </div>
  );
}
