import { useTranslation } from "react-i18next";
import { getFrameStatusMeta, FRAME_STATUS_ORDER } from "./frameStatus";

/**
 * Explains the frame lifecycle: a frame advances outline → built → animated.
 * Mirrors the status chips on each tile (shares getFrameStatusMeta).
 */
export function StoryboardStatusLegend() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-neutral-500">
      <span className="uppercase tracking-wider text-neutral-600">
        {t("storyboard.statusLabel")}
      </span>
      {FRAME_STATUS_ORDER.map((status, i) => {
        const meta = getFrameStatusMeta(status);
        return (
          <span key={status} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-neutral-700">→</span>}
            <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
            <span className="font-medium text-neutral-300">{meta.label}</span>
            <span className="text-neutral-500">— {meta.description}</span>
          </span>
        );
      })}
    </div>
  );
}
