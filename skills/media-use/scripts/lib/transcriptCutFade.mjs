function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

// 30ms in/out ramps kill the click at every concat boundary. A segment shorter
// than 4x the ramp would spend its whole length fading, so scale down there and
// skip entirely on a degenerate one. fadeIn/fadeOut are false at the export's
// own true start/end, where there is no splice to smooth.
export function fadeFilterFor(durationSeconds, { fadeIn, fadeOut }) {
  if (!fadeIn && !fadeOut) return null;
  const FADE_SECONDS = 0.03;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.01) return null;
  const d = Math.min(FADE_SECONDS, durationSeconds / 4);
  const parts = [];
  if (fadeIn) parts.push(`afade=t=in:st=0:d=${round3(d)}`);
  if (fadeOut) {
    const out = round3(durationSeconds - d);
    if (out > 0) parts.push(`afade=t=out:st=${out}:d=${round3(d)}`);
  }
  return parts.length ? parts.join(",") : null;
}
