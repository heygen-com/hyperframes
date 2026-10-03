import type { TimelineChapterTick } from "../lib/timelineElementHelpers";

export function chapterTitleFits(title: string, availablePx: number): boolean {
  return title.length * 6 < availablePx;
}

export function TimelineChapterTicks({
  chapters,
  pps,
  duration,
}: {
  chapters: readonly TimelineChapterTick[];
  pps: number;
  duration: number;
}) {
  return (
    <>
      {chapters.map((chapter, index) => {
        const next = chapters[index + 1];
        const availablePx = ((next?.start ?? duration) - chapter.start) * pps;
        const showTitle = chapterTitleFits(chapter.title, availablePx);
        return (
          <div
            key={`chapter-${chapter.start}-${chapter.title}`}
            data-timeline-chapter-tick=""
            className="absolute top-0 pointer-events-auto"
            style={{ left: chapter.start * pps - 0.5 }}
            title={chapter.title}
          >
            <div className="w-px h-3 bg-sky-400" />
            {showTitle ? (
              <span
                className="absolute left-1 top-0 font-mono text-[9px] leading-none whitespace-nowrap text-sky-300"
                data-timeline-chapter-label=""
              >
                {chapter.title}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
