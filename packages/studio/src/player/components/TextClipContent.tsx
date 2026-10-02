import type { TimelineText } from "../store/timelineElement";

/** A text layer's row: its own words in its own font and colour, live, on one clipped line. */
export function TextClipContent({ text }: { text: TimelineText }) {
  return (
    <div
      className="absolute inset-0 flex items-center overflow-hidden px-2"
      style={{ background: "#1c2028" }}
    >
      <span
        className="whitespace-nowrap text-[15px] leading-none"
        style={{ fontFamily: text.fontFamily, fontWeight: text.fontWeight, color: text.color }}
      >
        {text.value}
      </span>
    </div>
  );
}
