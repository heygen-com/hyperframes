#!/usr/bin/env node

// Standalone mirror of packages/core/src/colorLuts.ts. media-use cannot import
// the TypeScript source at runtime, so cube-validate.test.mjs mirrors core
// parser cases to catch drift in accepted .cube files before freezing them.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_CUBE_LUT_SIZE = 64;

const DEFAULT_DOMAIN_MIN = [0, 0, 0];
const DEFAULT_DOMAIN_MAX = [1, 1, 1];

class CubeValidateError extends Error {
  constructor(message, lineNumber = null) {
    super(lineNumber == null ? message : `${message} at line ${lineNumber}`);
    this.name = "CubeValidateError";
    this.lineNumber = lineNumber;
  }
}

function stripComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuote = !inQuote;
    if (char === "#" && !inQuote) return line.slice(0, i);
  }
  return line;
}

function parseFiniteNumber(value, lineNumber) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CubeValidateError(`Invalid number "${value}"`, lineNumber);
  }
  return parsed;
}

function parseVec3(parts, keyword, lineNumber) {
  if (parts.length !== 3) {
    throw new CubeValidateError(`${keyword} expects three numbers`, lineNumber);
  }
  return [
    parseFiniteNumber(parts[0], lineNumber),
    parseFiniteNumber(parts[1], lineNumber),
    parseFiniteNumber(parts[2], lineNumber),
  ];
}

function parseSize(value, keyword, lineNumber) {
  if (!value) throw new CubeValidateError(`${keyword} expects a size`, lineNumber);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2) {
    throw new CubeValidateError(`${keyword} must be an integer greater than 1`, lineNumber);
  }
  return parsed;
}

function validateDomain(domainMin, domainMax) {
  if (
    domainMax[0] <= domainMin[0] ||
    domainMax[1] <= domainMin[1] ||
    domainMax[2] <= domainMin[2]
  ) {
    throw new CubeValidateError("DOMAIN_MAX values must be greater than DOMAIN_MIN values");
  }
}

function isNumericDataLine(token) {
  return /^[+-]?(?:\d|\.\d)/.test(token);
}

function parseCube(input, options = {}) {
  const maxSize = options.maxSize ?? DEFAULT_MAX_CUBE_LUT_SIZE;
  let domainMin = DEFAULT_DOMAIN_MIN;
  let domainMax = DEFAULT_DOMAIN_MAX;
  let lut1dSize = null;
  let lut3dSize = null;
  let rows = 0;

  const lines = String(input)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = stripComment(lines[i] ?? "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const keyword = (parts[0] ?? "").toUpperCase();
    const rest = parts.slice(1);

    if (keyword === "TITLE") continue;
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
        throw new CubeValidateError(`${keyword} expects two numbers`, lineNumber);
      }
      const min = parseFiniteNumber(rest[0], lineNumber);
      const max = parseFiniteNumber(rest[1], lineNumber);
      if (max <= min) {
        throw new CubeValidateError("LUT_3D_INPUT_RANGE max must exceed min", lineNumber);
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
        throw new CubeValidateError(`LUT_3D_SIZE ${lut3dSize} exceeds max ${maxSize}`, lineNumber);
      }
      continue;
    }

    if (!isNumericDataLine(keyword)) {
      if (keyword.startsWith("LUT_")) {
        throw new CubeValidateError(`Unsupported cube keyword ${keyword}`, lineNumber);
      }
      continue;
    }
    if (!lut3dSize) {
      if (lut1dSize) {
        throw new CubeValidateError("1D cube LUTs are not supported yet", lineNumber);
      }
      throw new CubeValidateError("LUT data appears before LUT_3D_SIZE", lineNumber);
    }
    if (parts.length !== 3) {
      throw new CubeValidateError("LUT data rows must contain three numbers", lineNumber);
    }
    parseFiniteNumber(parts[0], lineNumber);
    parseFiniteNumber(parts[1], lineNumber);
    parseFiniteNumber(parts[2], lineNumber);
    rows++;
  }

  if (lut1dSize && lut3dSize) {
    throw new CubeValidateError("Mixed 1D and 3D cube LUTs are not supported yet");
  }
  if (!lut3dSize) {
    if (lut1dSize) throw new CubeValidateError("1D cube LUTs are not supported yet");
    throw new CubeValidateError("Missing LUT_3D_SIZE");
  }
  validateDomain(domainMin, domainMax);

  const expectedRows = lut3dSize * lut3dSize * lut3dSize;
  if (rows !== expectedRows) {
    throw new CubeValidateError(
      `Expected ${expectedRows} LUT rows for size ${lut3dSize}, found ${rows}`,
    );
  }

  return { size: lut3dSize };
}

export function validateCube(input, options = {}) {
  try {
    const parsed = parseCube(input, options);
    return { ok: true, size: parsed.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function validateCubeFile(filePath, options = {}) {
  return validateCube(readFileSync(filePath, "utf8"), options);
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error("usage: cube-validate.mjs <file.cube>");
    process.exit(2);
  }
  const result = validateCubeFile(file);
  if (!result.ok) {
    console.error(`error: ${result.error}`);
    process.exit(1);
  }
  console.log(`ok: LUT_3D_SIZE ${result.size}`);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
