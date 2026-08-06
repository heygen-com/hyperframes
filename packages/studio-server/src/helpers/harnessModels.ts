import { spawn } from "node:child_process";
import { harnessModelListSchema, type AgentKind } from "./agentSchemas.js";

/**
 * Ask a harness which models it can actually run.
 *
 * A provider catalog lists everything the provider sells; a harness runs a much
 * smaller set, and an account narrows it further (a ChatGPT-plan Codex refuses
 * `gpt-5-nano` outright). Only the harness knows, so Studio asks it rather than
 * filtering a catalog by rules that would go stale.
 *
 * Codex answers over its app-server protocol: `model/list` returns exactly the
 * entries its own picker shows, with the reasoning efforts each one takes. The
 * hidden ones stay hidden — that flag is the harness saying "not for pickers".
 * Anything that fails or is unsupported returns null, and the caller falls back
 * to the catalog.
 */

export interface HarnessModel {
  id: string;
  name: string;
  effortOptions?: string[];
  defaultEffort?: string;
  isDefault?: boolean;
}

/** How each harness answers "what can you run". Absent means it cannot say. */
const MODEL_LIST_COMMAND: Partial<Record<AgentKind, { command: string; args: string[] }>> = {
  codex: { command: "codex", args: ["app-server"] },
};

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<AgentKind, { at: number; models: HarnessModel[] | null }>();

/**
 * One JSON-RPC round trip over stdio: initialize, then `model/list`.
 *
 * The protocol is line-delimited JSON, and the app-server keeps running until
 * its stdin closes, so the process is killed as soon as the answer arrives.
 */
function requestModelList(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), REQUEST_TIMEOUT_MS);

    child.on("error", () => finish(null));
    child.on("close", () => finish(null));

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let end = buffer.indexOf("\n");
      for (; end !== -1; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // Banner or log line, not protocol.
        }
        const id = message && typeof message === "object" ? Reflect.get(message, "id") : undefined;
        if (id === 1) {
          child.stdin?.write(`${JSON.stringify({ id: 2, method: "model/list", params: {} })}\n`);
        } else if (id === 2) {
          finish(Reflect.get(message as object, "result"));
        }
      }
    });

    child.stdin?.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "hyperframes-studio", version: "1" } },
      })}\n`,
    );
  });
}

/**
 * The models this harness will accept right now, or null when it cannot say.
 * Null and an empty list mean different things: "ask the catalog instead" and
 * "this harness reports no models".
 */
export async function listHarnessModels(kind: AgentKind): Promise<HarnessModel[] | null> {
  const cached = cache.get(kind);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;

  const spec = MODEL_LIST_COMMAND[kind];
  if (!spec) return null;

  const parsed = harnessModelListSchema.safeParse(await requestModelList(spec.command, spec.args));
  const models = parsed.success
    ? parsed.data.data
        .filter((entry) => !entry.hidden)
        .map((entry) => ({
          id: entry.model ?? entry.id,
          name: entry.displayName ?? entry.id,
          effortOptions: entry.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
          defaultEffort: entry.defaultReasoningEffort,
          isDefault: entry.isDefault,
        }))
    : null;

  cache.set(kind, { at: Date.now(), models });
  return models;
}

/** Test seam: drop the cached answers. */
export function clearHarnessModelCache(): void {
  cache.clear();
}
