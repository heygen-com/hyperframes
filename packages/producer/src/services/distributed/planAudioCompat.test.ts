import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPlanAudioArtifactPath,
  PLAN_AUDIO_LEGACY_RELATIVE_PATH,
  PLAN_AUDIO_RELATIVE_PATH,
  resolvePlanAudioPath,
} from "./shared.js";

/**
 * `plan` and `assemble` are separate invocations bridged by object storage, so a
 * rolling deploy can pair a pre-rollout planner with a post-rollout assembler.
 * Both readers locate the artifact by existence alone, which would make that
 * pairing a silently muted video rather than an error.
 *
 * Delete this file, the legacy constant, and the fallback branch one release
 * after the container change ships.
 */
describe("plan audio artifact compatibility", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const planDir = (files: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plan-audio-"));
    dirs.push(dir);
    for (const name of files) writeFileSync(join(dir, name), "audio");
    return dir;
  };

  it("prefers the current name", () => {
    const dir = planDir([PLAN_AUDIO_RELATIVE_PATH, PLAN_AUDIO_LEGACY_RELATIVE_PATH]);
    expect(resolvePlanAudioPath(dir)).toBe(join(dir, PLAN_AUDIO_RELATIVE_PATH));
  });

  it("falls back to a legacy plan's name so a rolling deploy keeps its audio", () => {
    const dir = planDir([PLAN_AUDIO_LEGACY_RELATIVE_PATH]);
    expect(resolvePlanAudioPath(dir)).toBe(join(dir, PLAN_AUDIO_LEGACY_RELATIVE_PATH));
  });

  it("reports no audio when the plan carries neither name", () => {
    expect(resolvePlanAudioPath(planDir([]))).toBeNull();
  });

  it("recognises both names as the audio artifact, and nothing else", () => {
    expect(isPlanAudioArtifactPath(PLAN_AUDIO_RELATIVE_PATH)).toBe(true);
    expect(isPlanAudioArtifactPath(PLAN_AUDIO_LEGACY_RELATIVE_PATH)).toBe(true);
    expect(isPlanAudioArtifactPath("plan.json")).toBe(false);
    expect(isPlanAudioArtifactPath("meta/chunks.json")).toBe(false);
  });

  it("writes only the current name", () => {
    expect(PLAN_AUDIO_RELATIVE_PATH).not.toBe(PLAN_AUDIO_LEGACY_RELATIVE_PATH);
    expect(PLAN_AUDIO_RELATIVE_PATH.endsWith(".m4a")).toBe(true);
  });
});
