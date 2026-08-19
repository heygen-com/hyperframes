import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FIXTURE_CONFIG_FILE = ".plan-parity-fixture.json";

interface GeneratedAudioConfig {
  path: string;
  durationSeconds: number;
  frequencyHz: number;
  sampleRate: number;
}

interface GeneratedPressureFileConfig {
  path: string;
  bytes: number;
  seed: number;
}

interface PlanParityFixtureConfig {
  generatedAudio?: GeneratedAudioConfig;
  generatedPressureFile?: GeneratedPressureFileConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${FIXTURE_CONFIG_FILE}: ${key} must be a positive number`);
  }
  return value;
}

function relativePath(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`${FIXTURE_CONFIG_FILE}: ${key} must be a safe relative path`);
  }
  return value;
}

function parseGeneratedAudio(value: unknown): GeneratedAudioConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${FIXTURE_CONFIG_FILE}: generatedAudio must be an object`);
  return {
    path: relativePath(value, "path"),
    durationSeconds: positiveNumber(value, "durationSeconds"),
    frequencyHz: positiveNumber(value, "frequencyHz"),
    sampleRate: positiveNumber(value, "sampleRate"),
  };
}

function parsePressureFile(value: unknown): GeneratedPressureFileConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${FIXTURE_CONFIG_FILE}: generatedPressureFile must be an object`);
  }
  const bytes = positiveNumber(value, "bytes");
  const seed = positiveNumber(value, "seed");
  if (!Number.isInteger(bytes) || !Number.isInteger(seed)) {
    throw new Error(`${FIXTURE_CONFIG_FILE}: pressure bytes and seed must be integers`);
  }
  return {
    path: relativePath(value, "path"),
    bytes,
    seed,
  };
}

function readFixtureConfig(projectDir: string): PlanParityFixtureConfig {
  const configPath = join(projectDir, FIXTURE_CONFIG_FILE);
  if (!existsSync(configPath)) return {};
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
  if (!isRecord(raw)) throw new Error(`${FIXTURE_CONFIG_FILE}: root must be an object`);
  return {
    generatedAudio: parseGeneratedAudio(raw.generatedAudio),
    generatedPressureFile: parsePressureFile(raw.generatedPressureFile),
  };
}

function writeAscii(buffer: Buffer, offset: number, value: string): void {
  buffer.write(value, offset, value.length, "ascii");
}

/** Generate a deterministic mono PCM WAV without relying on ffmpeg. */
export function generateToneWav(config: Omit<GeneratedAudioConfig, "path">): Buffer {
  const sampleCount = Math.round(config.durationSeconds * config.sampleRate);
  const pcmBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  writeAscii(wav, 0, "RIFF");
  wav.writeUInt32LE(36 + pcmBytes, 4);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(config.sampleRate, 24);
  wav.writeUInt32LE(config.sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  writeAscii(wav, 36, "data");
  wav.writeUInt32LE(pcmBytes, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const phase = (2 * Math.PI * config.frequencyHz * sample) / config.sampleRate;
    const value = Math.round(Math.sin(phase) * 0.25 * 32767);
    wav.writeInt16LE(value, 44 + sample * 2);
  }
  return wav;
}

/** Deterministic xorshift bytes that do not collapse into a tiny gzip. */
export function generatePressureBytes(bytes: number, seed: number): Buffer {
  const output = Buffer.alloc(bytes);
  let state = seed >>> 0;
  for (let index = 0; index < bytes; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = state & 0xff;
  }
  return output;
}

/**
 * Copy a checked-in fixture into a driver-owned project directory and
 * materialize its generated binary assets. Source fixtures stay small and
 * reviewable; size-pressure tests can vary their v1 cap without allocating
 * multi-gigabyte files.
 */
export function preparePlanParityFixture(sourceDir: string, projectDir: string): void {
  mkdirSync(projectDir, { recursive: true });
  cpSync(sourceDir, projectDir, { recursive: true });
  const config = readFixtureConfig(projectDir);

  if (config.generatedAudio) {
    const target = join(projectDir, config.generatedAudio.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, generateToneWav(config.generatedAudio));
  }
  if (config.generatedPressureFile) {
    const target = join(projectDir, config.generatedPressureFile.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      generatePressureBytes(config.generatedPressureFile.bytes, config.generatedPressureFile.seed),
    );
  }
}
