import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVstSidecar, startVstSidecar, __resetForTests } from "./sidecar";

afterEach(() => {
  __resetForTests();
  delete process.env.HF_VST_HOST_CMD;
});

function fakeServe(dir: string, lines: string): string {
  const script = join(dir, "fake-serve.sh");
  writeFileSync(script, `#!/bin/sh\n${lines}\n`);
  chmodSync(script, 0o755);
  return script;
}

describe("startVstSidecar", () => {
  it("resolves the announced port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(dir, `echo "VST-HOST-LISTENING port=9555"; sleep 60`);
    const { port, stop } = await startVstSidecar();
    expect(port).toBe(9555);
    expect(getVstSidecar()?.port).toBe(9555);
    stop();
  });

  it("is a singleton while running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vst-cli-"));
    process.env.HF_VST_HOST_CMD = fakeServe(dir, `echo "VST-HOST-LISTENING port=9556"; sleep 60`);
    const a = await startVstSidecar();
    const b = await startVstSidecar();
    expect(b.port).toBe(a.port);
    a.stop();
  });

  it("rejects with install hint when command is missing", async () => {
    process.env.HF_VST_HOST_CMD = "/definitely/not/here";
    await expect(startVstSidecar()).rejects.toThrow(/uv tool install hyperframes-vst-host/);
  });
});
