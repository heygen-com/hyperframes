import { withAcpAgent } from "./connection.js";
import type { HarnessModel } from "../harnessModels.js";

/**
 * Which models an ACP agent will actually run.
 *
 * The protocol hands these back when a session opens, which means asking costs
 * a session — but it is the only answer that reflects the user's own account,
 * the same reason Studio asks Codex over its app-server instead of filtering a
 * catalog.
 *
 * Nothing here is a model list. Whatever the agent names is what Studio
 * offers, so a model released next week appears without a change to this file.
 */

/**
 * Reasoning level carried inside the id, e.g. `gpt-5.6-sol[high]`.
 *
 * That is the Codex adapter's convention rather than the protocol's, so it is
 * read when present and ignored when not: an agent with plain ids simply has
 * no effort knob, which is already how Claude Code is treated.
 */
const EFFORT_IN_ID = /^(.+)\[([^\]]+)\]$/;

interface AcpModel {
  base: string;
  effort?: string;
  name: string;
}

function readModel(entry: unknown): AcpModel | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { modelId, name } = entry as { modelId?: unknown; name?: unknown };
  if (typeof modelId !== "string" || !modelId.trim()) return null;

  const match = EFFORT_IN_ID.exec(modelId);
  const label = typeof name === "string" && name.trim() ? name.trim() : modelId;
  if (!match) return { base: modelId, name: label };

  // "GPT-5.6-Sol (high)" describes one entry of a group whose members differ
  // only by effort; the group's name is the model's, without the level.
  return {
    base: match[1]!,
    effort: match[2]!,
    name: label.replace(/\s*\([^)]*\)\s*$/, ""),
  };
}

/**
 * One entry per model, with the levels it takes — not one entry per
 * model-and-level, which would put the same model in the picker six times and
 * leave the effort chip with nothing to do.
 */
export function readAcpModels(result: unknown): HarnessModel[] | null {
  const models = (result as { models?: { availableModels?: unknown; currentModelId?: unknown } })
    ?.models;
  if (!models || !Array.isArray(models.availableModels)) return null;

  const current =
    typeof models.currentModelId === "string"
      ? readModel({ modelId: models.currentModelId })
      : null;

  const byBase = new Map<string, HarnessModel>();
  for (const entry of models.availableModels) {
    const model = readModel(entry);
    if (!model) continue;

    const existing = byBase.get(model.base);
    const target = existing ?? {
      id: model.base,
      name: model.name,
      isDefault: model.base === current?.base,
    };
    if (model.effort) {
      target.effortOptions = [...(target.effortOptions ?? []), model.effort];
      if (model.effort === current?.effort && target.isDefault) target.defaultEffort = model.effort;
    }
    byBase.set(model.base, target);
  }

  return byBase.size > 0 ? [...byBase.values()] : null;
}

/** Open a session purely to read its model list, then close it again. */
export async function listAcpModels(spec: {
  command: string;
  args: readonly string[];
  cwd: string;
}): Promise<HarnessModel[] | null> {
  try {
    return await withAcpAgent(spec, {}, async ({ context }) =>
      readAcpModels(await context.request("session/new", { cwd: spec.cwd, mcpServers: [] })),
    );
  } catch {
    // An agent that will not start cannot say what it runs. The catalog answers
    // instead, and the run itself is where the failure belongs.
    return null;
  }
}

/**
 * The id that means "this model at this reasoning level".
 *
 * ACP has no separate effort knob: the level is written into the id, and this
 * is the inverse of how the list above was read, so the two agree by
 * construction.
 */
export function acpModelId(model?: string, effort?: string): string | null {
  if (!model) return null;
  return effort ? `${model}[${effort}]` : model;
}
