import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "../player/store/playerStore";
import { fitsBeatAnalysis, resolveBeatSourceTrack } from "../utils/timelineInspector";
import { analyzeMusicFromSignal, type MusicBeatAnalysis } from "@hyperframes/core/beats";
import { analysisRateOf, readPcmChannels } from "../utils/projectPcm";
import { whenTimelineIdle } from "../player/components/timelineMotion";
import { useFileManagerContextOptional } from "../contexts/FileManagerContext";
import { mergeUserBeats } from "../utils/beatEditing";
import { getTimelineElementIndexes } from "../player/lib/timelineElementIndexes";
import { remapBeatAnalysisToComposition } from "../utils/beatEditActions";
import {
  audioRelPathForSrc,
  beatFilePathForSrc,
  serializeBeats,
  parseBeats,
} from "@hyperframes/core/beats";

// Module-level cache so the same URL isn't re-decoded/analyzed on re-mount.
// Capped so decoded PCM buffers don't accumulate unbounded across a session.
const analysisCache = new Map<string, Promise<MusicBeatAnalysis>>();
const MAX_ANALYSIS_CACHE = 4;

const PERSIST_DEBOUNCE_MS = 350;

function cacheAnalysis(url: string, promise: Promise<MusicBeatAnalysis>): void {
  analysisCache.set(url, promise);
  while (analysisCache.size > MAX_ANALYSIS_CACHE) {
    const oldest = analysisCache.keys().next().value;
    if (oldest === undefined) break;
    analysisCache.delete(oldest);
  }
}

type ProjectIo = { readOptionalProjectFile: (p: string) => Promise<string> };

type Beats = { times: number[]; strengths: number[] };

/** The track's saved beats file, or null when it is missing, unreadable or holds no beat (detection then retries). */
async function readSavedBeats(io: ProjectIo, beatPath: string): Promise<Beats | null> {
  try {
    const content = await io.readOptionalProjectFile(beatPath);
    const parsed = content ? parseBeats(content) : null;
    return parsed && parsed.times.length > 0
      ? { times: parsed.times, strengths: parsed.strengths }
      : null;
  } catch {
    return null;
  }
}

type MusicAnalysis = MusicBeatAnalysis;

type Loaded = { analysis: MusicAnalysis } & Beats;

async function analyzeTrack(url: string): Promise<MusicBeatAnalysis> {
  await whenTimelineIdle();
  const rate = await analysisRateOf([url]);
  const channels = await readPcmChannels(url, rate, (r) => new OfflineAudioContext(1, 1, r));
  return analyzeMusicFromSignal({ sampleRate: rate, channels }, { pause: whenTimelineIdle });
}

/** A track's analysis (memoized per URL), or null when decode or analysis fails. */
async function decodeTrack(musicSrc: string): Promise<MusicAnalysis | null> {
  let promise = analysisCache.get(musicSrc);
  if (!promise) {
    promise = analyzeTrack(musicSrc);
    cacheAnalysis(musicSrc, promise);
  }
  return promise.catch(() => null);
}

/** What a track shows. A fallback track (audio dropped in with no role) is analysed so the Beat tool works at once; a
 * marked music track only once the person saved beats for it, so unrelated assets add no beat lines. A file that does
 * not fit the decode keeps its saved beats, with no strengths measured from the audio. */
async function loadTrack(
  musicSrc: string,
  beatPath: string,
  io: ProjectIo,
  isFallbackTrack: boolean,
  decodable: boolean,
): Promise<Loaded | null> {
  const saved = await readSavedBeats(io, beatPath);
  if (!isFallbackTrack && !saved) return null;
  if (!decodable) return saved && { analysis: savedOnly(saved), ...saved };
  const analysis = await decodeTrack(musicSrc);
  if (!analysis) return null;
  return {
    analysis,
    ...(saved ?? { times: analysis.beatTimes, strengths: analysis.beatStrengths }),
  };
}

const savedOnly = ({ times, strengths }: Beats): MusicAnalysis => ({
  beatTimes: times,
  beatStrengths: strengths,
  bpm: null,
  bpmConfidence: "uncertain",
  channelData: null,
  sampleRate: 0,
  peak: 0,
});

/** The current beat analysis, remapped onto the composition's edited beat grid. */
export function useAdjustedBeatAnalysis() {
  const beatAnalysis = usePlayerStore((s) => s.beatAnalysis);
  const musicElement = usePlayerStore((s) => getTimelineElementIndexes(s.elements).musicElement);
  const beatEdits = usePlayerStore((s) => s.beatEdits);
  return useMemo(
    () => remapBeatAnalysisToComposition(beatAnalysis, musicElement, beatEdits),
    [beatAnalysis, musicElement, beatEdits],
  );
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

  const { musicSrc, isFallbackTrack, decodable } = useMemo(() => {
    const resolved = resolveBeatSourceTrack(elements);
    return {
      musicSrc: resolved?.element.src ?? null,
      isFallbackTrack: resolved?.isFallback ?? false,
      decodable: resolved ? fitsBeatAnalysis(resolved.element) : false,
    };
  }, [elements]);
  // Read at load, never a reason to load again: a file length arriving for the same track must keep its edits.
  const decodableRef = useRef(decodable);
  decodableRef.current = decodable;

  // ── Load: the track's beats (loadTrack). Resets edits + history on track change. ──
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
    const beatPath = beatFilePathForSrc(musicSrc);
    const io = ioRef.current;

    (async () => {
      if (!beatPath || !io) return;
      const result = await loadTrack(musicSrc, beatPath, io, isFallbackTrack, decodableRef.current);
      if (cancelled) return;
      if (!result) {
        setBeatAnalysis(null);
        analysisCache.delete(musicSrc);
        return;
      }
      setBeatEdits(null);
      resetBeatHistory();
      setBeatAnalysis({
        ...result.analysis,
        beatTimes: result.times,
        beatStrengths: result.strengths,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [musicSrc, isFallbackTrack, setBeatAnalysis, setBeatEdits, resetBeatHistory]);

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
