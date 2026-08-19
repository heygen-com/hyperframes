import { COLOR_GRADING_MAX_CURVE_POINTS } from "@hyperframes/parsers/color-grading-contract";

export type HfColorCurvePoint = readonly [input: number, output: number];
export type HfHueCurvePoint = readonly [hueDegrees: number, delta: number];

export const HF_COLOR_CURVE_LUT_SIZE = 1024;
export const HF_COLOR_CURVE_MAX_POINTS = COLOR_GRADING_MAX_CURVE_POINTS;

function endpointSlope(
  firstSpan: number,
  secondSpan: number,
  firstSlope: number,
  secondSlope: number,
): number {
  const slope =
    ((2 * firstSpan + secondSpan) * firstSlope - firstSpan * secondSlope) /
    (firstSpan + secondSpan);
  if (Math.sign(slope) !== Math.sign(firstSlope)) return 0;
  if (
    Math.sign(firstSlope) !== Math.sign(secondSlope) &&
    Math.abs(slope) > 3 * Math.abs(firstSlope)
  ) {
    return 3 * firstSlope;
  }
  return slope;
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError("Color curve points must be contiguous");
  return value;
}

function pointSlopes(points: readonly HfColorCurvePoint[]): number[] {
  const spans: number[] = [];
  const slopes: number[] = [];
  let previous = valueAt(points, 0);
  for (const point of points.slice(1)) {
    const span = point[0] - previous[0];
    spans.push(span);
    slopes.push((point[1] - previous[1]) / span);
    previous = point;
  }
  const firstSlope = valueAt(slopes, 0);
  if (points.length === 2) return [firstSlope, firstSlope];

  const result = new Array<number>(points.length);
  result[0] = endpointSlope(valueAt(spans, 0), valueAt(spans, 1), firstSlope, valueAt(slopes, 1));
  result[result.length - 1] = endpointSlope(
    valueAt(spans, spans.length - 1),
    valueAt(spans, spans.length - 2),
    valueAt(slopes, slopes.length - 1),
    valueAt(slopes, slopes.length - 2),
  );

  for (let index = 1; index < points.length - 1; index += 1) {
    const before = valueAt(slopes, index - 1);
    const after = valueAt(slopes, index);
    if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) {
      result[index] = 0;
      continue;
    }
    const beforeSpan = valueAt(spans, index - 1);
    const afterSpan = valueAt(spans, index);
    const beforeWeight = 2 * afterSpan + beforeSpan;
    const afterWeight = afterSpan + 2 * beforeSpan;
    result[index] = (beforeWeight + afterWeight) / (beforeWeight / before + afterWeight / after);
  }
  return result;
}

function validateCurvePoints(points: readonly HfColorCurvePoint[], size: number): void {
  if (points.length < 2) throw new RangeError("A color curve requires at least two points");
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError("Curve LUT size must be at least 2");
  }
  let previousInput = Number.NEGATIVE_INFINITY;
  for (const [input, output] of points) {
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      throw new TypeError("Color curve points must be finite");
    }
    if (input <= previousInput) {
      throw new RangeError("Color curve inputs must be strictly increasing");
    }
    previousInput = input;
  }
}

function validateOutputRange(
  points: readonly HfColorCurvePoint[],
  outputMin: number,
  outputMax: number,
): void {
  if (!Number.isFinite(outputMin) || !Number.isFinite(outputMax) || outputMin >= outputMax) {
    throw new RangeError("Curve output bounds must be finite and increasing");
  }
  if (points.some(([, output]) => output < outputMin || output > outputMax)) {
    throw new RangeError(`Curve outputs must be between ${outputMin} and ${outputMax}`);
  }
}

function interpolateCurveSegment(
  input: number,
  start: HfColorCurvePoint,
  end: HfColorCurvePoint,
  startTangent: number,
  endTangent: number,
): number {
  const span = end[0] - start[0];
  const t = Math.min(1, Math.max(0, (input - start[0]) / span));
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * start[1] +
    (t3 - 2 * t2 + t) * span * startTangent +
    (-2 * t3 + 3 * t2) * end[1] +
    (t3 - t2) * span * endTangent
  );
}

function compileCurveSamples(
  points: readonly HfColorCurvePoint[],
  size: number,
  inputAt: (index: number) => number,
  outputMin: number,
  outputMax: number,
): Float32Array {
  validateOutputRange(points, outputMin, outputMax);

  const tangents = pointSlopes(points);
  const samples = new Float32Array(size);
  let segment = 0;
  for (let index = 0; index < size; index += 1) {
    const input = inputAt(index);
    while (segment < points.length - 2 && input > valueAt(points, segment + 1)[0]) {
      segment += 1;
    }
    const start = valueAt(points, segment);
    const end = valueAt(points, segment + 1);
    const output = interpolateCurveSegment(
      input,
      start,
      end,
      valueAt(tangents, segment),
      valueAt(tangents, segment + 1),
    );
    samples[index] = Math.min(outputMax, Math.max(outputMin, output));
  }
  return samples;
}

/** Samples a shape-preserving cubic curve into a GPU-ready 1D lookup table. */
export function compileHfColorCurve(
  points: readonly HfColorCurvePoint[],
  size = HF_COLOR_CURVE_LUT_SIZE,
): Float32Array {
  validateCurvePoints(points, size);
  if (points.length > HF_COLOR_CURVE_MAX_POINTS) {
    throw new RangeError(`A color curve supports at most ${HF_COLOR_CURVE_MAX_POINTS} points`);
  }
  if (points.some(([input]) => input < 0 || input > 1)) {
    throw new RangeError("Color curve inputs must be between 0 and 1");
  }
  if (points[0]?.[0] !== 0 || points[points.length - 1]?.[0] !== 1) {
    throw new RangeError("Color curves must include input endpoints 0 and 1");
  }
  return compileCurveSamples(points, size, (index) => index / (size - 1), 0, 1);
}

/** Samples a periodic hue curve without duplicating the 0/360-degree texel. */
export function compileHfHueCurve(
  points: readonly HfHueCurvePoint[],
  outputMin: number,
  outputMax: number,
  size = HF_COLOR_CURVE_LUT_SIZE,
): Float32Array {
  if (points.length < 3) throw new RangeError("A hue curve requires at least three points");
  if (points.length > HF_COLOR_CURVE_MAX_POINTS) {
    throw new RangeError(`A hue curve supports at most ${HF_COLOR_CURVE_MAX_POINTS} points`);
  }
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index];
    if (!point || point[0] < 0 || point[0] >= 360) {
      throw new RangeError("Hue curve inputs must be from 0 up to 360 degrees");
    }
    if (index > 0 && point[0] === sorted[index - 1]?.[0]) {
      throw new RangeError("Hue curve inputs must be unique");
    }
  }
  const before = sorted.slice(-2).map(([hue, delta]) => [hue - 360, delta] as const);
  const after = sorted.slice(0, 2).map(([hue, delta]) => [hue + 360, delta] as const);
  const periodic = [...before, ...sorted, ...after];
  validateCurvePoints(periodic, size);
  return compileCurveSamples(periodic, size, (index) => (index / size) * 360, outputMin, outputMax);
}
