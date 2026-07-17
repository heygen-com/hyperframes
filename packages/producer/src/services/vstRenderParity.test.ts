/**
 * End-to-end integration test for the VST render path: a composition with a
 * `data-vst-chain` audio track is rendered through the real
 * `processCompositionAudio` mixer, which shells out to the Python VST host
 * sidecar (via `applyVstChainToWav`, `packages/engine/src/services/vstBounce.ts`)
 * to bounce the dry track through a plugin chain before mixing. The sidecar
 * itself lives in the standalone `heygen-com/hyperframes-vst-host` repo,
 * published to PyPI as `hyperframes-vst-host` — install with
 * `uv tool install hyperframes-vst-host` to run this test locally.
 *
 * Uses a BUILTIN pedalboard plugin (`Gain`) rather than a real VST3/AU
 * bundle: builtins are deterministic (see chain.py / Task 7's nondeterminism
 * caveat about some external plugins), so this test can assert bit-for-bit
 * reproducibility across two independent runs without depending on any
 * plugin being installed on the host machine.
 *
 * Skips when `hyperframes-vst` isn't on PATH — required to spawn the sidecar
 * via `resolveVstHostCommand()`'s bare-PATH fallback.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAudioElements, processCompositionAudio } from "@hyperframes/engine";
import { computeAudioResidualRmsDb } from "../utils/audioRegression.js";

// Mirrors resolveVstHostCommand's own bare-PATH fallback
// (packages/engine/src/services/vstBounce.ts) so the skip condition matches
// exactly what the sidecar spawn will look for.
const HAS_VST_HOST_CLI =
  spawnSync("hyperframes-vst", ["--help"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_VST_HOST_CLI)("VST render parity (integration)", () => {
  let projectDir: string;
  let workRoot: string;
  let outRoot: string;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-vst-parity-project-"));
    workRoot = mkdtempSync(join(tmpdir(), "hf-vst-parity-work-"));
    outRoot = mkdtempSync(join(tmpdir(), "hf-vst-parity-out-"));

    const assetsDir = join(projectDir, "assets");
    const fxDir = join(projectDir, "fx");
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(fxDir, { recursive: true });

    // 2-second 440 Hz sine dry source, same generation approach as
    // audioRegression.test.ts (spawn ffmpeg's `sine` lavfi source directly —
    // no hand-rolled PCM writer needed).
    const toneResult = spawnSync(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2:sample_rate=48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        join(assetsDir, "tone.wav"),
      ],
      { encoding: "utf-8" },
    );
    if (toneResult.status !== 0) {
      throw new Error(`ffmpeg sine generation failed: ${toneResult.stderr}`);
    }

    // Builtin pedalboard Gain(gain_db=-12) chain — deterministic, no
    // external plugin bundle required. Shape per
    // packages/studio/src/utils/vstChainFile.ts's ChainFileJson contract.
    const gainStateB64 = Buffer.from(JSON.stringify({ gain_db: -12 })).toString("base64");
    const chainJson = {
      version: 1,
      plugins: [
        {
          format: "builtin",
          path: "Gain",
          pluginName: null,
          name: "Gain",
          stateB64: gainStateB64,
        },
      ],
    };
    writeFileSync(join(fxDir, "t.vstchain.json"), JSON.stringify(chainJson, null, 2));
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  const wetHtml = `<!doctype html>
<html>
<body>
  <div data-composition-id="test" data-width="1920" data-height="1080" data-duration="2" data-fps="30"></div>
  <audio id="a1" src="assets/tone.wav" data-start="0" data-end="2" data-vst-chain="fx/t.vstchain.json"></audio>
</body>
</html>`;
  // Same composition, minus the VST chain attribute — the dry baseline mix
  // of the identical source track.
  const dryHtml = wetHtml.replace(' data-vst-chain="fx/t.vstchain.json"', "");

  async function renderMix(html: string, label: string): Promise<string> {
    const elements = parseAudioElements(html);
    const workDir = join(workRoot, `work-${label}`);
    const outputPath = join(outRoot, `${label}.m4a`);
    const result = await processCompositionAudio(elements, projectDir, workDir, outputPath, 2);
    if (!result.success) {
      throw new Error(
        `processCompositionAudio failed for "${label}": ${result.error ?? "unknown"}`,
      );
    }
    expect(result.tracksProcessed).toBe(1);
    return outputPath;
  }

  it("applies a measurable, real gain change vs. the dry mix", async () => {
    const dryOut = await renderMix(dryHtml, "dry");
    const wetOut = await renderMix(wetHtml, "wet-a");

    const residual = computeAudioResidualRmsDb(wetOut, dryOut);
    // A real -12 dB gain change is well outside the -50 dBFS noise floor
    // used to treat two streams as "effectively identical" — this proves
    // the plugin chain actually ran and altered the signal, rather than
    // silently falling back to the unprocessed dry track.
    expect(residual.error).toBeUndefined();
    expect(residual.ok).toBe(false);
    expect(residual.overallDb).toBeGreaterThan(-50);
  }, 30_000);

  it("is deterministic for a builtin plugin across two independent runs", async () => {
    const wetOut1 = await renderMix(wetHtml, "wet-b1");
    const wetOut2 = await renderMix(wetHtml, "wet-b2");

    const residual = computeAudioResidualRmsDb(wetOut1, wetOut2);
    // Two from-scratch renders of the same builtin-chain composition must
    // cancel to within the noise floor — no external-plugin-style
    // nondeterminism (see chain.py / Task 7 design notes) for builtins.
    expect(residual.error).toBeUndefined();
    expect(residual.ok).toBe(true);
  }, 30_000);
});
