import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plan } from "./plan.js";

const MASTER_CHAIN = '{"version":1,"nodes":[]}';
const seen = vi.hoisted((): { audioInput?: { masterFxChain?: string } } => ({}));

vi.mock("../render/stages/audioStage.js", () => ({
  runAudioStage: async (input: { masterFxChain?: string; workDir: string }) => {
    seen.audioInput = input;
    return {
      audioOutputPath: `${input.workDir}/audio.m4a`,
      hasAudio: false,
      audioProcessMs: 0,
    };
  },
}));

let runRoot: string;

beforeEach(() => {
  runRoot = mkdtempSync(join(tmpdir(), "hf-plan-master-bus-"));
});

afterEach(() => {
  rmSync(runRoot, { recursive: true, force: true });
});

it("plan() gives the audio stage the composition's master chain", async () => {
  const projectDir = join(runRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "index.html"),
    `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <div data-composition-id="root" data-width="320" data-height="240" data-duration="1" data-fx-chain='${MASTER_CHAIN}'>
    <p>master bus plan fixture</p>
  </div>
</body></html>`,
    "utf-8",
  );
  const planDir = join(runRoot, "plan");
  mkdirSync(planDir, { recursive: true });

  await plan(projectDir, { fps: 30, width: 320, height: 240, format: "mp4" }, planDir);

  expect(seen.audioInput?.masterFxChain).toBe(MASTER_CHAIN);
});
