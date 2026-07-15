import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVstChainToWav, resolveVstHostCommand } from "./vstBounce";

const cleanupEnv = () => {
  delete process.env.HF_VST_HOST_CMD;
};
afterEach(cleanupEnv);

function makeFakeSidecar(dir: string, body: string): string {
  const script = join(dir, "fake-vst.sh");
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
  return script;
}

describe("applyVstChainToWav", () => {
  it("returns the output path written by the sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-"));
    // fake sidecar: copy input to output (args: bounce --input X --chain C --output O)
    const script = makeFakeSidecar(
      dir,
      `
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
cp "$3" "$out" 2>/dev/null || echo processed > "$out"
`,
    );
    process.env.HF_VST_HOST_CMD = script;
    const wav = join(dir, "dry.wav");
    const chain = join(dir, "chain.json");
    writeFileSync(wav, "RIFF");
    writeFileSync(chain, "{}");
    const result = await applyVstChainToWav(wav, chain, dir, "music");
    expect(existsSync(result)).toBe(true);
    expect(result).not.toBe(wav);
  });

  it("names the missing plugin on exit code 3", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-"));
    const script = makeFakeSidecar(dir, `echo "PLUGIN_MISSING FabFilter Pro-Q 3" >&2; exit 3`);
    process.env.HF_VST_HOST_CMD = script;
    const wav = join(dir, "dry.wav");
    const chain = join(dir, "chain.json");
    writeFileSync(wav, "RIFF");
    writeFileSync(chain, "{}");
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
});
