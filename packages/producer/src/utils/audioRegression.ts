export function buildRmsEnvelope(samples: Int16Array, windowSize = 2048, hopSize = 1024): number[] {
  if (samples.length < windowSize) return [];
  const envelope: number[] = [];
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let energy = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const normalized = (samples[start + i] ?? 0) / 32768;
      energy += normalized * normalized;
    }
    envelope.push(Math.sqrt(energy / windowSize));
  }
  return envelope;
}

function correlationAtLag(a: number[], b: number[], lag: number): number {
  const startA = Math.max(0, lag);
  const startB = Math.max(0, -lag);
  const length = Math.min(a.length - startA, b.length - startB);
  if (length <= 32) return -1;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < length; i += 1) {
    meanA += a[startA + i] ?? 0;
    meanB += b[startB + i] ?? 0;
  }
  meanA /= length;
  meanB /= length;

  let numerator = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < length; i += 1) {
    const da = (a[startA + i] ?? 0) - meanA;
    const db = (b[startB + i] ?? 0) - meanB;
    numerator += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA <= 1e-12 || denB <= 1e-12) return -1;
  return numerator / Math.sqrt(denA * denB);
}

function bestEnvelopeCorrelation(
  rendered: number[],
  snapshot: number[],
  maxLagWindows: number,
): { correlation: number; lagWindows: number } {
  let best = -1;
  let bestLag = 0;
  for (let lag = -maxLagWindows; lag <= maxLagWindows; lag += 1) {
    const corr = correlationAtLag(rendered, snapshot, lag);
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  return { correlation: best, lagWindows: bestLag };
}

function isSilentEnvelope(envelope: number[]): boolean {
  return envelope.length > 0 && envelope.every((sample) => Math.abs(sample) <= 1e-9);
}

export function compareAudioEnvelopes(
  rendered: number[],
  snapshot: number[],
  maxLagWindows: number,
): { correlation: number; lagWindows: number } {
  if (rendered.length === 0 || snapshot.length === 0) {
    return { correlation: 1, lagWindows: 0 };
  }

  if (isSilentEnvelope(rendered) && isSilentEnvelope(snapshot)) {
    return { correlation: 1, lagWindows: 0 };
  }

  return bestEnvelopeCorrelation(rendered, snapshot, maxLagWindows);
}
