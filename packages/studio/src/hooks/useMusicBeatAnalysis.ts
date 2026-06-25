import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "../player/store/playerStore";
import { isMusicTrack } from "../utils/timelineInspector";
import { analyzeMusicFromUrl } from "@hyperframes/core/beats";
import { useFileManagerContextOptional } from "../contexts/FileManagerContext";
import { mergeUserBeats } from "../utils/beatEditing";
import {
  audioRelPathForSrc,
  beatFilePathForSrc,
  serializeBeats,
  parseBeats,
} from "@hyperframes/core/beats";

// Module-level cache so the same URL isn't re-decoded/analyzed on re-mount.
// Capped so decoded PCM buffers don't accumulate unbounded across a session.
const analysisCache = new Map<string, ReturnType<typeof analyzeMusicFromUrl>>();
const MAX_ANALYSIS_CACHE = 4;

const PERSIST_DEBOUNCE_MS = 350;

function cacheAnalysis(url: string, promise: ReturnType<typeof analyzeMusicFromUrl>): void {
  analysisCache.set(url, promise);
  while (analysisCache.size > MAX_ANALYSIS_CACHE) {
    const oldest = analysisCache.keys().next().value;
    if (oldest === undefined) break;
    analysisCache.delete(oldest);
  }
}

type ProjectIo = { readOptionalProjectFile: (p: string) => Promise<string> };

/**
 * Resolve the effective beat list for a track: a saved file with real beats
 * wins; otherwise the detected beats are used (and `hasFile` is false so the
 * caller seeds a new file). An empty saved file is ignored so detection retries.
 */
async function resolveBeats(
  beatPath: string | null,
  detected: { times: number[]; strengths: number[] },
  io: ProjectIo,
): Promise<{ times: number[]; strengths: number[]; hasFile: boolean }> {
  if (!beatPath) return { ...detected, hasFile: false };
  try {
    const content = await io.readOptionalProjectFile(beatPath);
    const parsed = content ? parseBeats(content) : null;
    if (parsed && parsed.times.length > 0) {
      return { times: parsed.times, strengths: parsed.strengths, hasFile: true };
    }
  } catch {
    /* fall back to detected beats */
  }
  return { ...detected, hasFile: false };
}

export function useMusicBeatAnalysis(): void {
  const elements = usePlayerStore((s) => s.elements);
  const setBeatAnalysis = usePlayerStore((s) => s.setBeatAnalysis);
  const setBeatEdits = usePlayerStore((s) => s.setBeatEdits);
  const setBeatPersist = usePlayerStore((s) => s.setBeatPersist);
  const resetBeatHistory = usePlayerStore((s) => s.resetBeatHistory);
  const fileManager = useFileManagerContextOptional();
  const readOptionalProjectFile = fileManager?.readOptionalProjectFile;
  const writeProjectFile = fileManager?.writeProjectFile;

  // File IO via ref so the effects only re-run when the track changes.
  const ioRef = useRef<
    (ProjectIo & { writeProjectFile: (p: string, c: string) => Promise<void> }) | null
  >(null);
  ioRef.current =
    readOptionalProjectFile && writeProjectFile
      ? { readOptionalProjectFile, writeProjectFile }
      : null;

  const musicSrc = useMemo(() => {
    const el = elements.find((e) => isMusicTrack(e));
    return el?.src ?? null;
  }, [elements]);

  // ── Load: decode for strength data, then use the saved beat file if present,
  //    otherwise seed it from detection. Resets edits + history on track change. ──
  useEffect(() => {
    if (!musicSrc) {
      setBeatAnalysis(null);
      setBeatEdits(null);
      resetBeatHistory();
      return;
    }
    if (!ioRef.current) {
      setBeatAnalysis(null);
      setBeatEdits(null);
      resetBeatHistory();
      return;
    }
    let cancelled = false;

    let promise = analysisCache.get(musicSrc);
    if (!promise) {
      promise = analyzeMusicFromUrl(musicSrc);
      cacheAnalysis(musicSrc, promise);
    }

    const beatPath = beatFilePathForSrc(musicSrc);
    promise
      .then(async (analysis) => {
        const detected = { times: analysis.beatTimes, strengths: analysis.beatStrengths };
        const io = ioRef.current;
        if (!io) return;
        const { times, strengths, hasFile } = await resolveBeats(beatPath, detected, io);
        if (cancelled) return;
        setBeatEdits(null);
        resetBeatHistory();
        setBeatAnalysis({ ...analysis, beatTimes: times, beatStrengths: strengths });
        // Seed a missing file through the SAME debounced writer the edits use, so
        // the initial write can't race a near-simultaneous edit's persist.
        if (beatPath && !hasFile && times.length > 0) usePlayerStore.getState().beatPersist?.();
      })
      .catch(() => {
        if (cancelled) return;
        setBeatAnalysis(null);
        analysisCache.delete(musicSrc);
      });

    return () => {
      cancelled = true;
    };
  }, [musicSrc, setBeatAnalysis, setBeatEdits, resetBeatHistory]);

  // ── Persist: register a debounced writer fired by every beat edit/undo/redo.
  //    Flushes any pending write on cleanup so the last edit is never lost. ──
  useEffect(() => {
    const beatPath = beatFilePathForSrc(musicSrc);
    if (!musicSrc || !beatPath || !ioRef.current) {
      setBeatPersist(null);
      return;
    }
    const io = ioRef.current;
    const audio = audioRelPathForSrc(musicSrc) ?? "audio";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null = null;

    const flush = () => {
      if (pending === null) return;
      const content = pending;
      pending = null;
      void io.writeProjectFile(beatPath, content).catch(() => {});
    };

    const persist = () => {
      const s = usePlayerStore.getState();
      const a = s.beatAnalysis;
      if (!a) return;
      const merged = mergeUserBeats(a.beatTimes, a.beatStrengths, s.beatEdits, musicSrc);
      pending = serializeBeats(merged.times, merged.strengths, audio);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, PERSIST_DEBOUNCE_MS);
    };

    setBeatPersist(persist);
    return () => {
      if (timer) clearTimeout(timer);
      flush(); // write the last pending edit before tearing down
      setBeatPersist(null);
    };
  }, [musicSrc, setBeatPersist]);
}
