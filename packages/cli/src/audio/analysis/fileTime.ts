import type {
  AudioCapability,
  Onsets,
  SnapReport,
  Span,
  Tempo,
} from "@hyperframes/core/audio-analysis";

const round = (t: number) => Math.round(t * 1000) / 1000;

type At = (t: number) => number;

/** A snap report's kept times are times too. */
function withSnap<V extends { snap?: SnapReport }>(value: V, at: At): V {
  return value.snap
    ? { ...value, snap: { ...value.snap, unsnapped: value.snap.unsnapped.map(at) } }
    : value;
}

const SHIFTS: Partial<Record<AudioCapability, (value: never, at: At, offset: number) => unknown>> =
  {
    moments: (m: Record<string, number>, at) =>
      Object.fromEntries(Object.entries(m).map(([k, t]) => [k, at(t)])),
    onsets: (o: Onsets, at) => ({ ...o, events: o.events.map((e) => ({ ...e, t: at(e.t) })) }),
    silence: (spans: Span[], at) => spans.map((s) => ({ start: at(s.start), end: at(s.end) })),
    loudness: (l: { clipping: { count: number; firstAt: number | null } }, at) => ({
      ...l,
      clipping: {
        ...l.clipping,
        firstAt: l.clipping.firstAt === null ? null : at(l.clipping.firstAt),
      },
    }),
    envelope: (e: object, _at, offset) => ({ startsAt: round(offset), ...e }),
    beats: (b: { times: number[]; snap?: SnapReport }, at) =>
      withSnap({ ...b, times: b.times.map(at) }, at),
    downbeats: (b: { times: number[]; snap?: SnapReport }, at) =>
      withSnap({ ...b, times: b.times.map(at) }, at),
    bpm: (tempo: Tempo, at) => ({
      ...tempo,
      curve: tempo.curve.map((p) => ({ ...p, t: at(p.t) })),
    }),
    sections: (s: { spans: Span[]; snap?: SnapReport }, at) =>
      withSnap(
        {
          ...s,
          spans: s.spans.map((span) => ({ ...span, start: at(span.start), end: at(span.end) })),
        },
        at,
      ),
  };

/** Move a capability's times from signal seconds to file seconds. */
export function shiftedTimes(capability: AudioCapability, value: unknown, offset: number): unknown {
  if (value === null || typeof value !== "object") return value;
  const shift = SHIFTS[capability];
  return shift ? shift(value as never, (t) => round(t + offset), offset) : value;
}
