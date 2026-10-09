import { defineCommand } from "citty";
import * as clack from "@clack/prompts";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { formatBytes } from "../ui/format.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { createRenderCancellationScope } from "../utils/renderCancellation.js";
import { PARAKEET_MODEL_LABEL } from "../whisper/parakeet.js";

export const examples: Example[] = [
  ["List the speech models transcribe can use", "hyperframes models list --json"],
  [
    "Download the Parakeet speech model that transcribe uses",
    "hyperframes models install parakeet",
  ],
];

function fail(message: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(c.error(message));
  failCommand();
}

/** A cancel is the user's choice, not a command failure: exit 130 without a cli_error. */
function reportCancel(json: boolean): void {
  const message = "Parakeet install cancelled; nothing partial was kept.";
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(c.warn(message));
  setCommandExitCode(130);
}

function downloadProgress(spin: Spinner) {
  let lastPct = -1;
  return (done: number, total: number) => {
    const pct = Math.floor((done / total) * 100);
    if (pct <= lastPct) return;
    lastPct = pct;
    spin?.message(
      `Downloading Parakeet TDT 0.6B v3 — ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(done) + " / " + formatBytes(total) + ")")}`,
    );
  };
}

type Sherpa = typeof import("../whisper/sherpa.js");
type Spinner = ReturnType<typeof clack.spinner> | null;

/** Installs missing pieces and carries the selected runtime provenance into the result. */
async function installMissing(sherpa: Sherpa, spin: Spinner, signal: AbortSignal) {
  const runtime = await sherpa.installSherpaRuntime({ signal });
  spin?.message("Verifying the Parakeet model...");
  const modelFetched = await sherpa.ensureParakeetModel({
    signal,
    onBytes: downloadProgress(spin),
  });
  return { changed: runtime.installed || modelFetched, runtimePath: runtime.runtimePath };
}

/** Cancellation can reach the child before the scope observes the signal. */
const wasCancelled = (err: unknown, signal: AbortSignal, sherpa: Sherpa) =>
  signal.aborted || err instanceof sherpa.DecodeCancelled;

async function installParakeet(json: boolean): Promise<void> {
  const sherpa = await import("../whisper/sherpa.js");
  const unsupported = sherpa.sherpaUnsupportedReason();
  if (unsupported) fail(unsupported, json);

  const spin = json ? null : clack.spinner({ output: process.stderr });
  // Ctrl-C must stop a 650 MB download, not just print "Canceled" over it.
  const cancellation = createRenderCancellationScope();
  spin?.start("Checking the sherpa-onnx runtime (installing it from npm if it does not load)...");
  try {
    const { changed, runtimePath } = await installMissing(sherpa, spin, cancellation.signal);
    spin?.stop(c.success(changed ? "Parakeet installed" : "Parakeet is already installed"));
    if (json) {
      const { SHERPA_RUNTIME_DIR: runtimeDir, PARAKEET_MODEL_DIR: modelDir } = sherpa;
      console.log(
        JSON.stringify({
          ok: true,
          model: PARAKEET_MODEL_LABEL,
          changed,
          runtimeDir,
          runtimePath,
          modelDir,
        }),
      );
    }
  } catch (err) {
    const cancelled = wasCancelled(err, cancellation.signal, sherpa);
    spin?.stop(
      cancelled ? c.warn("Parakeet install cancelled") : c.error("Parakeet install failed"),
    );
    if (cancelled) return reportCancel(json);
    fail(err instanceof Error ? err.message : String(err), json);
  } finally {
    cancellation.dispose();
  }
}

type ModelRow = {
  engine: string;
  model: string;
  installed: boolean;
  path: string;
  unsupported?: string;
};

/** Parakeet as transcribe judges it, then every downloaded whisper model. */
async function listModels(json: boolean): Promise<void> {
  const sherpa = await import("../whisper/sherpa.js");
  const { listWhisperModels } = await import("../whisper/manager.js");
  const unsupported = sherpa.sherpaUnsupportedReason();
  const models: ModelRow[] = [
    {
      engine: "parakeet",
      model: PARAKEET_MODEL_LABEL,
      installed: !unsupported && sherpa.sherpaParakeetInstalled(),
      path: sherpa.PARAKEET_MODEL_DIR,
      ...(unsupported ? { unsupported } : {}),
    },
    ...listWhisperModels().map(({ model, path }) => ({
      engine: "whisper",
      model,
      installed: true,
      path,
    })),
  ];
  if (json) {
    console.log(JSON.stringify({ ok: true, models }));
    return;
  }
  for (const m of models) {
    const state = m.installed
      ? c.success("installed")
      : c.dim(m.unsupported ?? "not installed: hyperframes models install parakeet");
    console.log(`${m.engine.padEnd(9)}${m.model.padEnd(22)}${state}`);
  }
}

export default defineCommand({
  meta: {
    name: "models",
    description: "List or download on-device models (models list, models install parakeet)",
  },
  args: {
    action: { type: "positional", description: "list or install", required: true },
    name: { type: "positional", description: "Model to install: parakeet", required: false },
    json: { type: "boolean", description: "Print one JSON result, no progress", default: false },
  },
  async run({ args }) {
    if (args.action === "list") return listModels(args.json);
    if (args.action !== "install" || args.name !== "parakeet") {
      fail(
        `Unknown: models ${[args.action, args.name].filter(Boolean).join(" ")}. Try: hyperframes models list, or hyperframes models install parakeet`,
        args.json,
      );
    }
    return installParakeet(args.json);
  },
});
