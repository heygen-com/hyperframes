/**
 * Audio Extractor Service
 *
 * Extracts audio from media elements in the composition HTML,
 * applies timeline positioning, and mixes into a single audio track.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface AudioElement {
  id: string;
  src: string;
  start: number;
  duration: number;
  mediaStart: number;
  volume: number;
  tagName: "audio" | "video";
}

export interface AudioTrack {
  id: string;
  srcPath: string;
  start: number;
  duration: number;
  mediaStart: number;
  volume: number;
}

/**
 * Parse audio/video elements from HTML to find media with audio.
 */
export function parseAudioElements(html: string): AudioElement[] {
  const elements: AudioElement[] = [];

  // Match <audio> and <video> elements with data-start
  const mediaRegex = /<(audio|video)\s[^>]*data-start=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = mediaRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = (match[1] ?? "").toLowerCase() as "audio" | "video";
    const start = parseFloat(match[2] ?? "");

    const idMatch = fullTag.match(/id=["']([^"']+)["']/);
    const srcMatch = fullTag.match(/src=["']([^"']+)["']/);
    if (!srcMatch) continue;

    const durationMatch = fullTag.match(/data-duration=["']([^"']+)["']/);
    const endMatch = fullTag.match(/data-end=["']([^"']+)["']/);
    const mediaStartMatch = fullTag.match(/data-media-start=["']([^"']+)["']/);
    const volumeMatch = fullTag.match(/data-volume=["']([^"']+)["']/);
    const parsedVolume = volumeMatch ? parseFloat(volumeMatch[1] ?? "") : 1.0;
    const safeVolume = Number.isFinite(parsedVolume) ? parsedVolume : 1.0;
    const durationFromDuration = durationMatch ? parseFloat(durationMatch[1] ?? "") : NaN;
    const end = endMatch ? parseFloat(endMatch[1] ?? "") : NaN;
    const duration =
      !isNaN(durationFromDuration) && durationFromDuration > 0
        ? durationFromDuration
        : !isNaN(end) && end > start
          ? end - start
          : 0;

    elements.push({
      id: idMatch?.[1] || `media-${elements.length}`,
      src: srcMatch[1] ?? "",
      start: isNaN(start) ? 0 : start,
      duration,
      mediaStart: mediaStartMatch ? parseFloat(mediaStartMatch[1] ?? "") : 0,
      volume: safeVolume,
      tagName,
    });
  }

  return elements;
}

/**
 * Run an FFmpeg command and return a promise.
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Extract audio from a single media file.
 */
async function extractAudioTrack(
  srcPath: string,
  outputPath: string,
  playbackStart: number,
  duration: number,
): Promise<boolean> {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [];

  if (playbackStart > 0) {
    args.push("-ss", String(playbackStart));
  }

  if (duration > 0) {
    args.push("-t", String(duration));
  }

  args.push(
    "-i",
    srcPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-y",
    outputPath,
  );

  try {
    await runFFmpeg(args);
    return true;
  } catch (err) {
    console.warn(
      `[AudioExtractor] Failed to extract audio from ${srcPath}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return false;
  }
}

/**
 * Generate a silence audio file.
 */
async function generateSilence(outputPath: string, duration: number): Promise<void> {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  await runFFmpeg([
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(duration),
    "-acodec",
    "pcm_s16le",
    "-y",
    outputPath,
  ]);
}

/**
 * Mix multiple audio tracks with timeline positioning.
 */
async function mixTracks(
  tracks: AudioTrack[],
  outputPath: string,
  totalDuration: number,
): Promise<void> {
  if (tracks.length === 0) {
    await generateSilence(outputPath, totalDuration);
    return;
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const inputs: string[] = [];
  const filterParts: string[] = [];

  tracks.forEach((track, i) => {
    inputs.push("-i", track.srcPath);

    const delayMs = Math.round(track.start * 1000);
    const trimDuration = track.duration > 0 ? track.duration : totalDuration;

    filterParts.push(
      `[${i}:a]atrim=0:${trimDuration},volume=${track.volume},adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`,
    );
  });

  const mixInputs = tracks.map((_, i) => `[a${i}]`).join("");
  const mixFilter = `${mixInputs}amix=inputs=${tracks.length}:duration=longest:normalize=0[out]`;
  const fullFilter = [...filterParts, mixFilter].join(";");

  const args = [
    ...inputs,
    "-filter_complex",
    fullFilter,
    "-map",
    "[out]",
    "-acodec",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(totalDuration),
    "-y",
    outputPath,
  ];

  await runFFmpeg(args);
}

/**
 * Process all audio for a composition.
 *
 * @param htmlPath - Path to the composition HTML (for parsing media elements)
 * @param projectDir - Base directory for resolving relative media paths
 * @param workDir - Temporary working directory for intermediate files
 * @param outputPath - Final mixed audio output path
 * @param totalDuration - Total composition duration in seconds
 * @returns true if audio was produced, false if no audio elements found
 */
export async function processAudio(
  htmlPath: string,
  projectDir: string,
  workDir: string,
  outputPath: string,
  totalDuration: number,
): Promise<boolean> {
  const html = readFileSync(htmlPath, "utf-8");
  const elements = parseAudioElements(html);

  if (elements.length === 0) {
    console.log("[AudioExtractor] No audio elements found");
    return false;
  }

  console.log(`[AudioExtractor] Processing ${elements.length} audio element(s)...`);

  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
  }

  const tracks: AudioTrack[] = [];

  for (const element of elements) {
    // Resolve source path relative to project directory
    let srcPath = element.src;
    if (!srcPath.startsWith("/") && !srcPath.startsWith("http")) {
      srcPath = join(projectDir, srcPath);
    }

    if (!existsSync(srcPath)) {
      console.warn(`[AudioExtractor] Source not found: ${srcPath}`);
      continue;
    }

    const extractedPath = join(workDir, `${element.id}-extracted.wav`);
    const success = await extractAudioTrack(
      srcPath,
      extractedPath,
      element.mediaStart,
      element.duration,
    );

    if (success) {
      tracks.push({
        id: element.id,
        srcPath: extractedPath,
        start: element.start,
        duration: element.duration,
        mediaStart: element.mediaStart,
        volume: element.volume,
      });
    }
  }

  console.log(`[AudioExtractor] Mixing ${tracks.length} track(s) into final audio...`);
  await mixTracks(tracks, outputPath, totalDuration);

  // Clean up work directory
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  console.log("[AudioExtractor] Audio processing complete");
  return true;
}
