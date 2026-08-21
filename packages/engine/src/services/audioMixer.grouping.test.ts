import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { MIXED_AUDIO_FILENAME, processCompositionAudio } from "./audioMixer.js";

/**
 * Level arithmetic across the mix graph.
 *
 * `mixAudioTracks` corrects for amix's own normalisation with a single global
 * `masterOutputGain * tracks.length`. That correction is exact for one flat
 * amix and wrong for any other shape — and it fails SILENTLY, in the export
 * rather than in preview, because preview mixes through Web Audio and never
 * runs this graph at all.
 *
 * Measured on a four-track mix (spike, 2026-08-14): keeping the global track
 * count on an outer amix that only has three inputs lands the whole mix
 * +2.499 dB hot — exactly 20·log10(4/3). Nothing errors; the file is just
 * loud. These tests are the instrument that catches that class.
 */

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

/** Mean level of a whole file, or of one window when `from`/`to` are given. */
function meanVolumeDb(path: string, from?: number, to?: number): number {
  const filter =
    from === undefined ? "volumedetect" : `atrim=${from}:${to},asetpts=N/SR/TB,volumedetect`;
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", filter, "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (result.status !== 0 || !match?.[1]) {
    throw new Error(`Could not measure mean volume: ${result.stderr}`);
  }
  return Number(match[1]);
}

/** A sine at `freq`, scaled by `gain`, written as PCM so the source is exact. */
function writeTone(path: string, freq: number, seconds: number, gain: number): void {
  const result = spawnSync(
    getFfmpegBinary(),
    [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`,
      "-af",
      `volume=${gain}`,
      "-c:a",
      "pcm_s16le",
      path,
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`Could not write tone: ${result.stderr}`);
}

const track = (id: string, end: number, volume = 1) => ({
  id,
  src: `${id}.wav`,
  start: 0,
  end,
  mediaStart: 0,
  layer: 0,
  volume,
  type: "audio" as const,
});

describe.skipIf(!HAS_FFMPEG)("mix level arithmetic", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps every track at its authored level regardless of how many there are", async () => {
    // The property the compensation exists to hold: adding tracks must not
    // duck the ones already there. Mixing the SAME tone twice is the cleanest
    // probe — two coherent copies sum to exactly +6.02 dB, so any residual
    // normalisation shows up as a plain arithmetic miss rather than something
    // that has to be teased out of unrelated material.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-grp-count-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-grp-count-work-"));
    tempDirs.push(projectDir, workDir);

    writeTone(join(projectDir, "a.wav"), 440, 2, 0.4);
    writeTone(join(projectDir, "b.wav"), 440, 2, 0.4);
    const oneUp = join(projectDir, `one-${MIXED_AUDIO_FILENAME}`);
    const twoUp = join(projectDir, `two-${MIXED_AUDIO_FILENAME}`);

    const one = await processCompositionAudio([track("a", 2)], projectDir, workDir, oneUp, 2);
    const two = await processCompositionAudio(
      [track("a", 2), track("b", 2)],
      projectDir,
      workDir,
      twoUp,
      2,
    );
    expect(one.success).toBe(true);
    expect(two.success).toBe(true);

    // Two coherent copies of one tone = +6.02 dB. If amix's 1/N ever survives
    // the correction, this lands at 0 dB instead.
    expect(meanVolumeDb(twoUp) - meanVolumeDb(oneUp)).toBeCloseTo(6.02, 0);
  }, 30_000);

  it("does not lift the survivors when a shorter track ends", async () => {
    // amix with normalize=true rescales by the number of CURRENTLY ACTIVE
    // inputs, so a track ending mid-composition would hand the remaining ones
    // a level jump. `apad` to the full duration is what holds every input
    // active for the whole graph and neutralises that — an invariant the
    // filter string relies on without saying so.
    //
    // Measured without apad (spike, 2026-08-14): the tail runs +1.94 dB hot.
    // Any group work that builds its own amix has to keep the padding, or
    // inherit that bug one level down.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-grp-drop-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-grp-drop-work-"));
    tempDirs.push(projectDir, workDir);

    writeTone(join(projectDir, "short.wav"), 440, 1, 0.5);
    writeTone(join(projectDir, "long.wav"), 880, 3, 0.5);
    const together = join(projectDir, `both-${MIXED_AUDIO_FILENAME}`);
    const alone = join(projectDir, `alone-${MIXED_AUDIO_FILENAME}`);

    const both = await processCompositionAudio(
      [track("short", 1), track("long", 3)],
      projectDir,
      workDir,
      together,
      3,
    );
    const solo = await processCompositionAudio([track("long", 3)], projectDir, workDir, alone, 3);
    expect(both.success).toBe(true);
    expect(solo.success).toBe(true);

    // After 1.5 s only `long` is sounding. It must read the same whether or not
    // a second track happened to end earlier.
    const tailTogether = meanVolumeDb(together, 1.5, 3);
    const tailAlone = meanVolumeDb(alone, 1.5, 3);
    expect(Math.abs(tailTogether - tailAlone)).toBeLessThan(0.5);
  }, 30_000);

  /**
   * The gate for group buses (plans/audio-mixer-groups.md §1).
   *
   * Grouping is routing, not processing: a group whose FX chain is empty must
   * be a no-op on the mix. Enable this the moment `data-audio-group` routes
   * through a nested amix — it is the definition of done for §1.3, and the
   * only thing standing between a wrong gain correction and a silently loud
   * export.
   *
   * Proven reachable in the spike: nesting with each amix compensated by ITS
   * OWN input count nulls against the flat mix to -inf (sample-identical), as
   * does `amix=normalize=0` with no correction at all.
   */
  it("mixes a grouped composition at the same level as the ungrouped one", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-grp-level-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-grp-level-work-"));
    tempDirs.push(projectDir, workDir);

    writeTone(join(projectDir, "a.wav"), 440, 2, 0.4);
    writeTone(join(projectDir, "b.wav"), 660, 2, 0.4);
    const flatOut = join(projectDir, `flat-${MIXED_AUDIO_FILENAME}`);
    const groupedOut = join(projectDir, `grouped-${MIXED_AUDIO_FILENAME}`);

    const flat = await processCompositionAudio(
      [track("a", 2), track("b", 2)],
      projectDir,
      workDir,
      flatOut,
      2,
    );
    const grouped = await processCompositionAudio(
      [
        { ...track("a", 2), groupId: "voiceover" },
        { ...track("b", 2), groupId: "voiceover" },
      ],
      projectDir,
      workDir,
      groupedOut,
      2,
    );
    expect(flat.success).toBe(true);
    expect(grouped.success).toBe(true);

    // An empty group chain is pure routing — the export must read the same
    // whether or not the two tones happened to share a group.
    expect(Math.abs(meanVolumeDb(groupedOut) - meanVolumeDb(flatOut))).toBeLessThan(0.3);
  }, 30_000);

  it("a group FX chain fully cutting its members leaves an ungrouped track untouched (routing isolation)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-grp-fx-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-grp-fx-work-"));
    tempDirs.push(projectDir, workDir);

    writeTone(join(projectDir, "voice.wav"), 440, 2, 0.4);
    writeTone(join(projectDir, "sfx.wav"), 880, 2, 0.4);
    const mixedOut = join(projectDir, `mixed-${MIXED_AUDIO_FILENAME}`);
    const sfxAloneOut = join(projectDir, `sfx-alone-${MIXED_AUDIO_FILENAME}`);

    const groupChain = JSON.stringify({
      version: 1,
      nodes: [{ type: "gain", id: "g", params: { gain: -60 } }],
    });

    const mixed = await processCompositionAudio(
      [{ ...track("voice", 2), groupId: "vo", groupFxChain: groupChain }, track("sfx", 2)],
      projectDir,
      workDir,
      mixedOut,
      2,
    );
    const sfxAlone = await processCompositionAudio(
      [track("sfx", 2)],
      projectDir,
      workDir,
      sfxAloneOut,
      2,
    );
    expect(mixed.success).toBe(true);
    expect(sfxAlone.success).toBe(true);

    // The voice group is cut ~60 dB — the mix should read close to sfx alone,
    // and the ungrouped sfx track's own processing is unaffected by the
    // group existing at all.
    expect(Math.abs(meanVolumeDb(mixedOut) - meanVolumeDb(sfxAloneOut))).toBeLessThan(0.5);
  }, 30_000);

  it("a member's own volume envelope still applies inside a group", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-grp-env-"));
    const workDir = mkdtempSync(join(tmpdir(), "hf-grp-env-work-"));
    tempDirs.push(projectDir, workDir);

    writeTone(join(projectDir, "a.wav"), 440, 4, 0.5);
    const groupedOut = join(projectDir, `grouped-${MIXED_AUDIO_FILENAME}`);
    const flatOut = join(projectDir, `flat-${MIXED_AUDIO_FILENAME}`);

    const withEnvelope = {
      ...track("a", 4),
      volumeKeyframes: [
        { time: 0, volume: 1 },
        { time: 4, volume: 0 },
      ],
    };

    const grouped = await processCompositionAudio(
      [{ ...withEnvelope, groupId: "vo" }],
      projectDir,
      workDir,
      groupedOut,
      4,
    );
    const flat = await processCompositionAudio([withEnvelope], projectDir, workDir, flatOut, 4);
    expect(grouped.success).toBe(true);
    expect(flat.success).toBe(true);

    // The envelope fades to silent — the tail should read the same whether
    // the track is grouped or not, proving member-level processing survives
    // the group path unchanged.
    const groupedTail = meanVolumeDb(groupedOut, 3, 4);
    const flatTail = meanVolumeDb(flatOut, 3, 4);
    expect(Math.abs(groupedTail - flatTail)).toBeLessThan(0.5);
  }, 30_000);
});
