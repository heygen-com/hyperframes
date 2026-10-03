import { listAuthoredChapters, parseChapters } from "@hyperframes/core/composition-contract";

export type PlayerChapter = {
  start: number;
  title: string;
  elementId: string;
};

/** Extract host-timeline chapter markers from a composition document. */
export function extractPlayerChapters(doc: Document | null | undefined): PlayerChapter[] {
  if (!doc) return [];
  return listAuthoredChapters(parseChapters(doc)).map(({ start, title, elementId }) => ({
    start,
    title,
    elementId,
  }));
}

export function chapterIndexAtTime(
  chapters: readonly PlayerChapter[],
  time: number,
): number | null {
  let index: number | null = null;
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (!chapter) continue;
    if (chapter.start <= time + 1e-6) index = i;
    else break;
  }
  return index;
}

export function previousChapterStart(
  chapters: readonly PlayerChapter[],
  time: number,
): number | null {
  const earlier = [...chapters].reverse().find((chapter) => chapter.start < time - 1e-3);
  return earlier?.start ?? null;
}

export function nextChapterStart(chapters: readonly PlayerChapter[], time: number): number | null {
  const later = chapters.find((chapter) => chapter.start > time + 1e-3);
  return later?.start ?? null;
}
