import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVstChainToWav, resolveVstHostCommand } from "./vstBounce";
import { makeFakeSidecar } from "./vstSidecarTestFixture";

const cleanupEnv = () => {
  delete process.env.HF_VST_HOST_CMD;
};
afterEach(cleanupEnv);

/** Sets up a fresh temp dir with a stub dry `.wav` + empty chain file, and
 *  points `HF_VST_HOST_CMD` at a fake sidecar running `sidecarBody`. */
function setupBounceFixture(sidecarBody: string): { dir: string; wav: string; chain: string } {
  const dir = mkdtempSync(join(tmpdir(), "vst-"));
  process.env.HF_VST_HOST_CMD = makeFakeSidecar(dir, sidecarBody);
  const wav = join(dir, "dry.wav");
  const chain = join(dir, "chain.json");
  writeFileSync(wav, "RIFF");
  writeFileSync(chain, "{}");
  return { dir, wav, chain };
}

describe("applyVstChainToWav", () => {
  it("returns the output path written by the sidecar", async () => {
    // fake sidecar: copy input to output (args: bounce --input X --chain C --output O)
    const { dir, wav, chain } = setupBounceFixture(`
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
cp "$3" "$out" 2>/dev/null || echo processed > "$out"
`);
    const result = await applyVstChainToWav(wav, chain, dir, "music");
    expect(existsSync(result)).toBe(true);
    expect(result).not.toBe(wav);
  });

  it("names the missing plugin on exit code 3", async () => {
    const { dir, wav, chain } = setupBounceFixture(
      `echo "PLUGIN_MISSING FabFilter Pro-Q 3" >&2; exit 3`,
    );
    await expect(applyVstChainToWav(wav, chain, dir, "music")).rejects.toThrow(
      /plugin "FabFilter Pro-Q 3" is not installed/,
    );
  });
});

describe("resolveVstHostCommand", () => {
  it("prefers HF_VST_HOST_CMD", () => {
    process.env.HF_VST_HOST_CMD = "/opt/custom vst-host";
    expect(resolveVstHostCommand()).toEqual(["/opt/custom", "vst-host"]);
  });

  it("falls back to the bare hyperframes-vst command on PATH", () => {
    delete process.env.HF_VST_HOST_CMD;
    expect(resolveVstHostCommand()).toEqual(["hyperframes-vst"]);
  });
});
