import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AudioAnalysisProvider, AudioSignal } from "@hyperframes/core/audio-analysis";
import { isolatedPythonCode } from "../../../tts/python.js";
import {
  AVAILABLE,
  downbeatsWithMeter,
  perSignal,
  rounded,
  runFile,
  unavailable,
  withWavFile,
} from "./shared.js";

const PYTHON_ENV = "HYPERFRAMES_BEAT_THIS_PYTHON";
const CHECKPOINT_ENV = "HYPERFRAMES_BEAT_THIS_CHECKPOINT";

/** Where Beat This! keeps the small0 weights after its own first download, unless a path is configured. */
function checkpointPath(): string {
  const configured = process.env[CHECKPOINT_ENV]?.trim();
  if (configured) return configured;
  const torchHome = process.env.TORCH_HOME ?? join(homedir(), ".cache", "torch");
  return join(torchHome, "hub", "checkpoints", "beat_this-small0.ckpt");
}

const FIND_PACKAGE = isolatedPythonCode(
  "import importlib.util,sys; sys.exit(importlib.util.find_spec('beat_this') is None)",
);

// The checkpoint is a local file path, so Beat This! loads it from disk and never downloads.
const TRACK = isolatedPythonCode(`
import json, sys
from beat_this.inference import File2Beats
beats, downbeats = File2Beats(checkpoint_path=sys.argv[2], device="cpu", dbn=False)(sys.argv[1])
print(json.dumps({"beats": [float(t) for t in beats], "downbeats": [float(t) for t in downbeats]}))
`);

const installed = new Map<string, Promise<boolean>>();

function hasPackage(python: string): Promise<boolean> {
  let found = installed.get(python);
  if (!found) {
    found = runFile(python, ["-c", FIND_PACKAGE], { timeout: 30_000, windowsHide: true }).then(
      () => true,
      () => false,
    );
    installed.set(python, found);
  }
  return found;
}

const track = perSignal((signal: AudioSignal) =>
  withWavFile(signal, async (wav) => {
    const python = process.env[PYTHON_ENV]!.trim();
    const { stdout } = await runFile(python, ["-c", TRACK, wav, checkpointPath()], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60_000,
      windowsHide: true,
    });
    const answer = JSON.parse(stdout.trim().split("\n").pop()!) as {
      beats: number[];
      downbeats: number[];
    };
    return { beats: rounded(answer.beats), downbeats: rounded(answer.downbeats) };
  }),
);

/** CPJKU's Beat This! (MIT), opt-in: a Python with `beat-this` installed and its small0 weights on disk. */
export const beatThisProvider: AudioAnalysisProvider<AudioSignal> = {
  id: "beat-this",
  local: true,
  capabilities: ["beats", "downbeats"],
  async available() {
    const python = process.env[PYTHON_ENV]?.trim();
    if (!python) return unavailable(`${PYTHON_ENV} is not set`);
    if (!existsSync(python)) return unavailable(`${PYTHON_ENV} names no file`);
    if (!existsSync(checkpointPath()))
      return unavailable(`no Beat This! weights at ${checkpointPath()}`);
    if (!(await hasPackage(python))) return unavailable(`beat_this is not installed for ${python}`);
    return AVAILABLE;
  },
  async analyze(capability, signal) {
    const { beats, downbeats } = await track(signal);
    return capability === "beats" ? { times: beats } : downbeatsWithMeter(beats, downbeats);
  },
};
