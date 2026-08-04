import { catalogProviderSchema, type AgentKind } from "./agentSchemas.js";

/**
 * Which models a harness can be pointed at.
 *
 * Nothing here is a hardcoded model list: the catalog is models.dev (the same
 * community index opencode and friends read), which publishes ids, names,
 * capabilities and per-million-token pricing for every provider. Studio only
 * decides which provider a harness talks to, and lets the catalog say what
 * exists today — a model shipped next week shows up without a release here.
 */

/** A model Studio can offer for a run. */
export interface AgentModel {
  id: string;
  name: string;
  /** USD per million input / output tokens, when the catalog prices them. */
  inputCost?: number;
  outputCost?: number;
  contextWindow?: number;
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

/** Models a coding agent can actually drive: it has to be able to call tools. */
function toAgentModels(provider: unknown): AgentModel[] {
  const parsed = catalogProviderSchema.safeParse(provider);
  if (!parsed.success) return [];

  return Object.entries(parsed.data.models)
    .filter(([, model]) => model.tool_call === true)
    .map(([key, model]) => ({
      id: model.id ?? key,
      name: model.name ?? key,
      inputCost: model.cost?.input,
      outputCost: model.cost?.output,
      contextWindow: model.limit?.context,
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

/** Every tool-capable model for a harness, cheapest first. Empty when unknown. */
export async function listAgentModels(kind: AgentKind): Promise<AgentModel[]> {
  const provider = PROVIDER_BY_KIND[kind];
  if (!provider) return [];
  return (await loadCatalog()).get(provider) ?? [];
}

/** Cheapest tool-capable model for a harness — what a run uses by default. */
export async function resolveDefaultModel(kind: AgentKind): Promise<string | null> {
  const [cheapest] = await listAgentModels(kind);
  return cheapest?.id ?? null;
}

/** Append the harness' own model flag, when it takes one and a model is set. */
export function withModelArgs(kind: AgentKind, args: readonly string[], model?: string): string[] {
  const flag = MODEL_FLAG[kind];
  if (!model || !flag) return [...args];
  // Codex reads the prompt from a trailing `-`; keep flags ahead of it.
  const stdinMarker = args.lastIndexOf("-");
  const insertAt = stdinMarker === -1 ? args.length : stdinMarker;
  return [...args.slice(0, insertAt), flag, model, ...args.slice(insertAt)];
}

/** Test seam: drop the cached catalog. */
export function clearModelCatalogCache(): void {
  cache = null;
}
