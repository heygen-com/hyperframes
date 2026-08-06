import { catalogProviderSchema, type AgentKind, type CatalogModel } from "./agentSchemas.js";
import { listHarnessModels } from "./harnessModels.js";

/**
 * Which models a harness can be pointed at.
 *
 * Nothing here is a hardcoded model list. Two sources answer, in order:
 *
 * 1. The harness itself, when it can say (see helpers/harnessModels). This is
 *    the only source that knows what the user's account may actually run, so a
 *    model the harness would reject is never offered.
 * 2. models.dev, the community catalog opencode and friends read, for ids,
 *    names, capabilities and per-million-token pricing. Its list is everything
 *    a provider sells, so it is narrowed to the newest release per family:
 *    superseded models are what "outdated" means, and the catalog dates them.
 *
 * The two compose — a harness list is enriched with catalog pricing by id — so
 * a model shipped next week shows up without a release here.
 */

/** A model Studio can offer for a run. */
export interface AgentModel {
  id: string;
  name: string;
  /**
   * Reasoning levels this model accepts, lowest first, straight from the
   * catalog. Empty when the model reasons on a token budget instead (Anthropic)
   * or does not expose the knob at all.
   */
  effortOptions?: string[];
  /** USD per million input / output tokens, when the catalog prices them. */
  inputCost?: number;
  outputCost?: number;
  contextWindow?: number;
  /** The harness' own default, when it names one. */
  isDefault?: boolean;
}

const CATALOG_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 8000;

/**
 * The provider each harness authenticates against. Hermes and OpenClaw are
 * provider-agnostic — they take `provider/model` ids and default to whatever
 * their own config says — so Studio does not pretend to enumerate them.
 */
const PROVIDER_BY_KIND: Partial<Record<AgentKind, string>> = {
  claude: "anthropic",
  codex: "openai",
};

/**
 * How each harness takes a reasoning effort. Only the ones that actually expose
 * the knob appear — Claude Code sets thinking by budget, not by a flag, so a
 * run with it simply carries no effort.
 */
const EFFORT_ARGS: Partial<Record<AgentKind, (effort: string) => string[]>> = {
  codex: (effort) => ["-c", `model_reasoning_effort="${effort}"`],
};

/** The flag each harness takes its model on. */
const MODEL_FLAG: Partial<Record<AgentKind, string>> = {
  claude: "--model",
  codex: "-m",
  hermes: "-m",
  openclaw: "--model",
};

/** A coding run reads far more than it writes, so input is weighted 3:1. */
const INPUT_WEIGHT = 3;

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Models a coding agent can actually drive: it has to be able to call tools,
 * and it has to be the current member of its family. The catalog keeps every
 * generation ever shipped, and offering `gpt-4o mini` beside `gpt-5.6` is how a
 * picker rots — a family's newest release supersedes its older ones by
 * definition, and the catalog's own release dates say which that is.
 */
function toAgentModels(provider: unknown): AgentModel[] {
  const parsed = catalogProviderSchema.safeParse(provider);
  if (!parsed.success) return [];

  const newestPerFamily = new Map<string, { key: string; model: CatalogModel }>();
  for (const [key, model] of Object.entries(parsed.data.models)) {
    if (model.tool_call !== true) continue;
    const family = model.family ?? model.id ?? key;
    const held = newestPerFamily.get(family);
    if (!held || (model.release_date ?? "") > (held.model.release_date ?? "")) {
      newestPerFamily.set(family, { key, model });
    }
  }

  return [...newestPerFamily.values()]
    .map(({ key, model }) => ({
      id: model.id ?? key,
      name: model.name ?? key,
      inputCost: model.cost?.input,
      outputCost: model.cost?.output,
      contextWindow: model.limit?.context,
      effortOptions: model.reasoning_options?.find((option) => option.type === "effort")?.values,
    }))
    .sort((a, b) => modelCost(a) - modelCost(b));
}

// ── Catalog access ──────────────────────────────────────────────────────────

interface CatalogCache {
  readonly at: number;
  readonly byProvider: Map<string, AgentModel[]>;
}

let cache: CatalogCache | null = null;

/**
 * Rank a model by what a run of it costs. Unpriced models sort last rather
 * than pretending to be free.
 */
export function modelCost(model: AgentModel): number {
  if (model.inputCost === undefined && model.outputCost === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (model.inputCost ?? 0) * INPUT_WEIGHT + (model.outputCost ?? 0);
}

async function loadCatalog(): Promise<Map<string, AgentModel[]>> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.byProvider;

  let byProvider = new Map<string, AgentModel[]>();
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (response.ok) {
      const catalog: unknown = await response.json();
      // Only the harness providers are parsed: validating all 180 providers of
      // the catalog would cost far more than the two entries Studio can use.
      for (const provider of Object.values(PROVIDER_BY_KIND)) {
        const entry =
          catalog && typeof catalog === "object" ? Reflect.get(catalog, provider) : null;
        byProvider.set(provider, toAgentModels(entry));
      }
    }
  } catch {
    // Offline, or models.dev is down: the picker falls back to "harness
    // default" rather than a stale list we invented.
  }

  cache = { at: Date.now(), byProvider };
  return byProvider;
}

/**
 * Every model a harness can be pointed at, cheapest first. Empty when neither
 * source knows any, which the picker shows as "the harness decides".
 */
export async function listAgentModels(kind: AgentKind): Promise<AgentModel[]> {
  const provider = PROVIDER_BY_KIND[kind];
  const catalog = provider ? ((await loadCatalog()).get(provider) ?? []) : [];
  const harness = await listHarnessModels(kind);
  if (!harness) return catalog;

  // The harness has the final say on what exists AND on what each model
  // accepts; the catalog contributes prices only. Spreading the catalog entry
  // wholesale would hand back its effort list, which is the provider's API
  // surface rather than the harness' — and offering an effort the harness
  // rejects fails the run at the far end.
  const priced = new Map(catalog.map((model) => [model.id, model]));
  return harness
    .map((model) => {
      const price = priced.get(model.id);
      return {
        ...model,
        inputCost: price?.inputCost,
        outputCost: price?.outputCost,
        contextWindow: price?.contextWindow,
      };
    })
    .sort((a, b) => modelCost(a) - modelCost(b));
}

/**
 * What a run uses when nobody chose: the cheapest model that can do the job, so
 * a run never quietly costs frontier money because nobody picked. The harness'
 * own default is only consulted when nothing is priced and "cheapest" has no
 * meaning — a harness usually defaults to its flagship.
 */
export async function resolveDefaultModel(kind: AgentKind): Promise<string | null> {
  const models = await listAgentModels(kind);
  const priced = models.some((model) => modelCost(model) !== Number.MAX_SAFE_INTEGER);
  const chosen = priced ? models[0] : (models.find((model) => model.isDefault) ?? models[0]);
  return chosen?.id ?? null;
}

/** Append the harness' own model and effort flags, for the ones it takes. */
export function withModelArgs(
  kind: AgentKind,
  args: readonly string[],
  model?: string,
  effort?: string,
): string[] {
  const flag = MODEL_FLAG[kind];
  const extra: string[] = [];
  if (model && flag) extra.push(flag, model);
  if (effort) extra.push(...(EFFORT_ARGS[kind]?.(effort) ?? []));
  if (extra.length === 0) return [...args];

  // Codex reads the prompt from a trailing `-`; keep flags ahead of it.
  const stdinMarker = args.lastIndexOf("-");
  const insertAt = stdinMarker === -1 ? args.length : stdinMarker;
  return [...args.slice(0, insertAt), ...extra, ...args.slice(insertAt)];
}

/** The lowest effort a model offers — what a run uses unless asked otherwise. */
export async function resolveDefaultEffort(
  kind: AgentKind,
  modelId?: string,
): Promise<string | null> {
  if (!EFFORT_ARGS[kind]) return null;
  const models = await listAgentModels(kind);
  const model = modelId ? models.find((entry) => entry.id === modelId) : models[0];
  return model?.effortOptions?.[0] ?? null;
}

/** Test seam: drop the cached catalog. */
export function clearModelCatalogCache(): void {
  cache = null;
}
