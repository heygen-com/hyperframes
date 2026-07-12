export type CubeLutVec3 = readonly [number, number, number];

export interface CubeLut3D {
  title: string | null;
  size: number;
  domainMin: CubeLutVec3;
  domainMax: CubeLutVec3;
  data: Float32Array;
}

export interface PackedCubeLut2D {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ParseCubeLutOptions {
  maxSize?: number;
}

export class CubeLutParseError extends Error {
  readonly lineNumber: number | null;

  constructor(message: string, lineNumber: number | null = null) {
    super(lineNumber == null ? message : `${message} at line ${lineNumber}`);
    this.name = "CubeLutParseError";
    this.lineNumber = lineNumber;
  }
}

const DEFAULT_DOMAIN_MIN: CubeLutVec3 = [0, 0, 0];
const DEFAULT_DOMAIN_MAX: CubeLutVec3 = [1, 1, 1];
export const DEFAULT_MAX_CUBE_LUT_SIZE = 64;

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuote = !inQuote;
    if (char === "#" && !inQuote) return line.slice(0, i);
  }
  return line;
}

function parseFiniteNumber(value: string, lineNumber: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CubeLutParseError(`Invalid number "${value}"`, lineNumber);
  }
  return parsed;
}

function parseVec3(parts: string[], keyword: string, lineNumber: number): CubeLutVec3 {
  if (parts.length !== 3) {
    throw new CubeLutParseError(`${keyword} expects three numbers`, lineNumber);
  }
  return [
    parseFiniteNumber(parts[0]!, lineNumber),
    parseFiniteNumber(parts[1]!, lineNumber),
    parseFiniteNumber(parts[2]!, lineNumber),
  ];
}

function parseSize(value: string | undefined, keyword: string, lineNumber: number): number {
  if (!value) throw new CubeLutParseError(`${keyword} expects a size`, lineNumber);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2) {
    throw new CubeLutParseError(`${keyword} must be an integer greater than 1`, lineNumber);
  }
  return parsed;
}

function validateDomain(domainMin: CubeLutVec3, domainMax: CubeLutVec3): void {
  if (
    domainMax[0] <= domainMin[0] ||
    domainMax[1] <= domainMin[1] ||
    domainMax[2] <= domainMin[2]
  ) {
    throw new CubeLutParseError("DOMAIN_MAX values must be greater than DOMAIN_MIN values");
  }
}

function parseTitle(line: string): string | null {
  const quoted = /^TITLE\s+"([^"]*)"\s*$/i.exec(line);
  if (quoted) return quoted[1] ?? null;
  const bare = /^TITLE\s+(.+)\s*$/i.exec(line);
  return bare ? (bare[1] ?? "").trim() || null : null;
}

function isNumericDataLine(token: string): boolean {
  return /^[+-]?(?:\d|\.\d)/.test(token);
}

// fallow-ignore-next-line complexity
export function parseCubeLut(input: string, options: ParseCubeLutOptions = {}): CubeLut3D {
  const maxSize = options.maxSize ?? DEFAULT_MAX_CUBE_LUT_SIZE;
  let title: string | null = null;
  let domainMin: CubeLutVec3 = DEFAULT_DOMAIN_MIN;
  let domainMax: CubeLutVec3 = DEFAULT_DOMAIN_MAX;
  let lut1dSize: number | null = null;
  let lut3dSize: number | null = null;
  const rows: number[] = [];

  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = stripComment(lines[i] ?? "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const keyword = (parts[0] ?? "").toUpperCase();
    const rest = parts.slice(1);

    if (keyword === "TITLE") {
      title = parseTitle(line);
      continue;
    }
    if (keyword === "DOMAIN_MIN") {
      domainMin = parseVec3(rest, keyword, lineNumber);
      continue;
    }
    if (keyword === "DOMAIN_MAX") {
      domainMax = parseVec3(rest, keyword, lineNumber);
      continue;
    }
    if (keyword === "LUT_3D_INPUT_RANGE") {
      if (rest.length !== 2) {
        throw new CubeLutParseError(`${keyword} expects two numbers`, lineNumber);
      }
      const min = parseFiniteNumber(rest[0]!, lineNumber);
      const max = parseFiniteNumber(rest[1]!, lineNumber);
      if (max <= min) {
        throw new CubeLutParseError("LUT_3D_INPUT_RANGE max must exceed min", lineNumber);
      }
      domainMin = [min, min, min];
      domainMax = [max, max, max];
      continue;
    }
    if (keyword === "LUT_1D_SIZE") {
      lut1dSize = parseSize(rest[0], keyword, lineNumber);
      continue;
    }
    if (keyword === "LUT_3D_SIZE") {
      lut3dSize = parseSize(rest[0], keyword, lineNumber);
      if (lut3dSize > maxSize) {
        throw new CubeLutParseError(`LUT_3D_SIZE ${lut3dSize} exceeds max ${maxSize}`, lineNumber);
      }
      continue;
    }

    if (!isNumericDataLine(keyword)) {
      if (keyword.startsWith("LUT_")) {
        throw new CubeLutParseError(`Unsupported cube keyword ${keyword}`, lineNumber);
      }
      continue;
    }
    if (!lut3dSize) {
      if (lut1dSize) {
        throw new CubeLutParseError("1D cube LUTs are not supported yet", lineNumber);
      }
      throw new CubeLutParseError("LUT data appears before LUT_3D_SIZE", lineNumber);
    }
    if (parts.length !== 3) {
      throw new CubeLutParseError("LUT data rows must contain three numbers", lineNumber);
    }
    rows.push(
      parseFiniteNumber(parts[0]!, lineNumber),
      parseFiniteNumber(parts[1]!, lineNumber),
      parseFiniteNumber(parts[2]!, lineNumber),
    );
  }

  if (lut1dSize && lut3dSize) {
    throw new CubeLutParseError("Mixed 1D and 3D cube LUTs are not supported yet");
  }
  if (!lut3dSize) {
    if (lut1dSize) throw new CubeLutParseError("1D cube LUTs are not supported yet");
    throw new CubeLutParseError("Missing LUT_3D_SIZE");
  }
  validateDomain(domainMin, domainMax);

  const expectedRows = lut3dSize * lut3dSize * lut3dSize;
  if (rows.length !== expectedRows * 3) {
    throw new CubeLutParseError(
      `Expected ${expectedRows} LUT rows for size ${lut3dSize}, found ${rows.length / 3}`,
    );
  }

  return {
    title,
    size: lut3dSize,
    domainMin,
    domainMax,
    data: new Float32Array(rows),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toByte(value: number): number {
  return Math.round(clampUnit(value) * 255);
}

export function packCubeLutToRgba8(lut: CubeLut3D): PackedCubeLut2D {
  const size = lut.size;
  const width = size * size;
  const height = size;
  const packed = new Uint8Array(width * height * 4);

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const lutIndex = ((b * size + g) * size + r) * 3;
        const pixelIndex = (g * width + b * size + r) * 4;
        packed[pixelIndex] = toByte(lut.data[lutIndex] ?? 0);
        packed[pixelIndex + 1] = toByte(lut.data[lutIndex + 1] ?? 0);
        packed[pixelIndex + 2] = toByte(lut.data[lutIndex + 2] ?? 0);
        packed[pixelIndex + 3] = 255;
      }
    }
  }

  return { width, height, data: packed };
}
