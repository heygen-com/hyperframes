import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliRuntimeError, consumeCommandResult } from "../utils/commandResult.js";

const sherpa = {
  SHERPA_RUNTIME_DIR: "/cache/optional/sherpa-onnx-node@1.13.8",
  PARAKEET_MODEL_DIR: "/cache/parakeet/parakeet-tdt-0.6b-v3-int8",
  sherpaUnsupportedReason: vi.fn(),
  installSherpaRuntime: vi.fn(),
  ensureParakeetModel: vi.fn(),
  DecodeCancelled: class extends Error {},
};
vi.mock("../whisper/sherpa.js", () => sherpa);

// The command's Ctrl-C scope, driven by the test instead of a real signal.
let cancel = new AbortController();
const dispose = vi.fn();
vi.mock("../utils/renderCancellation.js", () => ({
  createRenderCancellationScope: () => ({ signal: cancel.signal, dispose, checkAncestors() {} }),
}));

import modelsCmd from "./models.js";

async function install() {
  let exitCode = 0;
  let threw = false;
  try {
    await modelsCmd.run!({ args: { action: "install", name: "parakeet", json: true } } as never);
  } catch (err) {
    if (!(err instanceof CliRuntimeError)) throw err;
    exitCode = err.result.exitCode;
    threw = true;
  }
  exitCode ||= consumeCommandResult().exitCode;
  const out: Record<string, unknown> = JSON.parse(
    String(vi.mocked(console.log).mock.calls.at(-1)?.[0]),
  );
  return { exitCode, threw, out };
}

describe("models install parakeet --json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancel = new AbortController();
    consumeCommandResult();
    vi.spyOn(console, "log").mockImplementation(() => {});
    sherpa.sherpaUnsupportedReason.mockReturnValue(null);
    sherpa.installSherpaRuntime.mockResolvedValue(true);
    sherpa.ensureParakeetModel.mockResolvedValue(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints one result naming what it installed and where", async () => {
    expect(await install()).toEqual({
      exitCode: 0,
      threw: false,
      out: {
        ok: true,
        model: "parakeet-tdt-0.6b-v3",
        changed: true,
        runtimeDir: sherpa.SHERPA_RUNTIME_DIR,
        modelDir: sherpa.PARAKEET_MODEL_DIR,
      },
    });
    expect(dispose).toHaveBeenCalled();
  });

  it("reports changed: false when the runtime loads and the model verifies", async () => {
    sherpa.installSherpaRuntime.mockResolvedValue(false);
    expect((await install()).out).toMatchObject({ ok: true, changed: false });
  });

  it("reports a failed install as ok:false with exit 1", async () => {
    sherpa.ensureParakeetModel.mockRejectedValue(new Error("tokens.txt did not match"));
    expect(await install()).toEqual({
      exitCode: 1,
      threw: true,
      out: { ok: false, error: "tokens.txt did not match" },
    });
  });

  it("refuses an unsupported system before downloading anything", async () => {
    sherpa.sherpaUnsupportedReason.mockReturnValue("Parakeet needs glibc 2.32 or newer");
    expect(await install()).toEqual({
      exitCode: 1,
      threw: true,
      out: { ok: false, error: "Parakeet needs glibc 2.32 or newer" },
    });
    expect(sherpa.installSherpaRuntime).not.toHaveBeenCalled();
    expect(sherpa.ensureParakeetModel).not.toHaveBeenCalled();
  });

  it("stops with exit 130 when Ctrl-C stops the runtime check before any listener runs", async () => {
    sherpa.installSherpaRuntime.mockRejectedValue(new sherpa.DecodeCancelled("cancelled"));
    const { exitCode, threw, out } = await install();
    expect(exitCode).toBe(130);
    expect(threw).toBe(false);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
  });

  it("stops with exit 130 when cancelled mid-download", async () => {
    sherpa.ensureParakeetModel.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      cancel.abort();
      signal.throwIfAborted();
    });
    const { exitCode, threw, out } = await install();
    expect(exitCode).toBe(130);
    expect(threw).toBe(false);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    expect(sherpa.installSherpaRuntime).toHaveBeenCalledWith({ signal: cancel.signal });
  });
});
