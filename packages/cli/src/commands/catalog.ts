import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["List all blocks and components", "hyperframes catalog"],
  ["List blocks only", "hyperframes catalog --type block"],
  ["Filter by tag", "hyperframes catalog --type block --tag social"],
  ["Machine-readable JSON", "hyperframes catalog --json"],
  ["Interactive picker (install on select)", "hyperframes catalog --human-friendly"],
];

import * as clack from "@clack/prompts";
import { type ItemType } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { listRegistryItems, loadAllItems } from "../registry/resolver.js";
import { loadProjectConfig, DEFAULT_PROJECT_CONFIG } from "../utils/projectConfig.js";
import { resolve } from "node:path";
import { finishCommand } from "../utils/commandResult.js";
import { runAdd } from "./add.js";
import { searchByWords } from "../registry/localSearch.js";
import {
  downloadOfferMessage,
  ensureLocalModel,
  localModelConsent,
  localModelStatus,
  nonInteractiveConsentMessage,
  recordLocalModelConsent,
} from "../registry/localModel.js";
import { localRuntimeAvailable } from "../registry/localEmbedder.js";
import {
  fetchLocalVectors,
  hasLocalVectors,
  localSemanticRanking,
} from "../registry/localSemantic.js";

/**
 * Get the offline tier ready, and report every reason it could not be.
 *
 * A per-run opt-in, so an agent or CI run can reach the offline tier at all:
 * the only other route is a prompt that fires exclusively on a terminal.
 *
 * Warnings are returned as well as printed so `--json` can carry the same
 * reasons the terminal shows.
 */
// a consent gate: each branch is a distinct reason the tier cannot run, and each has to be reported separately
// fallow-ignore-next-line complexity
async function prepareOnDeviceTier(opts: {
  assumedYes: boolean;
  registry: string;
}): Promise<string[]> {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    console.error(message);
  };

  // The flag is the record that a person agreed. The CLI cannot ask here, so it
  // trusts the caller to have asked, and says as much in the docs. A person
  // present gets asked. The flag only stands in for consent when there is
  // nobody to ask, or when they said so with --yes.
  if (!opts.assumedYes && localModelStatus().status === "not-asked") {
    const answer = await clack.confirm({
      message: downloadOfferMessage(0),
      initialValue: true,
    });
    if (clack.isCancel(answer) || answer !== true) {
      recordLocalModelConsent(false);
      warn("on-device search skipped: the download was declined.");
    }
  }

  if (localModelConsent() !== false && !(await localRuntimeAvailable())) {
    // Checked before downloading. Fetching 32 MB and then discovering the
    // runtime is missing wastes the bandwidth the consent was granted for.
    warn(
      "on-device search needs the native ONNX runtime, which a single-file build cannot load. " +
        "Install the CLI normally (npm i -g hyperframes) to use this tier.",
    );
    return warnings;
  }

  recordLocalModelConsent(true);
  const model = await ensureLocalModel();
  const vectors = hasLocalVectors() || (await fetchLocalVectors(opts.registry));
  if (!model || !vectors) {
    warn(
      `on-device search unavailable: ${!model ? "model" : "catalog vectors"} could not be fetched`,
    );
  }
  return warnings;
}

export default defineCommand({
  meta: {
    name: "catalog",
    description: "Browse and install blocks and components from the registry",
  },
  args: {
    type: {
      type: "string",
      description: 'Filter by type: "block" or "component"',
    },
    tag: {
      type: "string",
      description: "Filter by tag (e.g. social, transition, text)",
    },
    json: {
      type: "boolean",
      description: "Print matching items as JSON to stdout",
    },
    "human-friendly": {
      type: "boolean",
      description: "Interactive picker — select an item to install",
    },
    query: {
      type: "string",
      description:
        "Search by meaning when the on-device model is on, otherwise by name, title and description",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Assume yes for prompts this run, including the on-device model download",
    },
    "on-device": {
      type: "boolean",
      // Consent for the model download is otherwise only reachable through a
      // prompt that fires on a TTY, which leaves every agent and CI run unable
      // to opt in at all.
      description: "Use on-device meaning search, downloading the model if needed",
    },
  },
  // one flag-parsing entry point feeding three output paths (json, interactive, table); splitting those is its own change
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const json = args.json === true;
    const interactive = args["human-friendly"] === true;
    const dir = resolve(process.cwd());
    const config = loadProjectConfig(dir) ?? DEFAULT_PROJECT_CONFIG;

    let typeFilter: ItemType | undefined;
    if (args.type === "block") typeFilter = "hyperframes:block";
    else if (args.type === "component") typeFilter = "hyperframes:component";
    else if (args.type) {
      console.error(`Invalid --type: "${args.type}". Use "block" or "component".`);
      finishCommand(1);
    }

    // Asked for unnarrowed on purpose. `listRegistryItems` filters the same
    // in-memory manifest either way, so the whole list costs no extra fetch,
    // and its names are the only honest definition of "in this registry" once
    // the user's own --type/--tag has narrowed what gets loaded.
    const entries = await listRegistryItems(undefined, { baseUrl: config.registry });
    const catalog = entries.filter((e) => e.type !== "hyperframes:example");
    const registryNames = new Set(catalog.map((e) => e.name));
    const filtered = typeFilter ? catalog.filter((e) => e.type === typeFilter) : catalog;

    if (filtered.length === 0) {
      if (json) console.log("[]");
      else console.log("No items found in registry.");
      return;
    }

    const items = await loadAllItems(filtered, { baseUrl: config.registry });

    const tagFilter = args.tag?.toLowerCase();
    const tagged = tagFilter
      ? items.filter((item) => item.tags?.some((t) => t.toLowerCase() === tagFilter))
      : items;

    const query = typeof args.query === "string" ? args.query.trim() : "";
    // Collected rather than only printed, so --json can carry the same reasons
    // the terminal shows. A machine that asked for a tier deserves to be told
    // it did not run.
    const warnings =
      query && args["on-device"] === true
        ? await prepareOnDeviceTier({
            assumedYes: args.yes === true || !process.stdout.isTTY || json,
            registry: config.registry,
          })
        : [];
    const searched = query ? await applySearch(tagged, query, registryNames) : null;
    const matching = searched ? searched.items : tagged;

    if (matching.length === 0) {
      // An empty result is exactly when the tier matters most: nothing found on
      // the weakest tier means something different from nothing found on the
      // best one.
      if (json && query) {
        console.log(
          JSON.stringify(
            {
              query,
              tier: tierToken(searched),
              tier_detail: tierDetail(searched),
              dropped: searched?.missing ?? 0,
              shown: 0,
              total: tagged.length,
              ...(warnings.length ? { warnings } : {}),
              results: [],
            },
            null,
            2,
          ),
        );
      } else if (json) console.log("[]");
      else {
        // Name whichever filter actually emptied the list. Reporting a tag
        // miss for a query miss sends people to fix the wrong thing.
        const criteria = [
          query ? `query "${query}"` : null,
          args.tag ? `tag "${args.tag}"` : null,
        ].filter(Boolean);
        console.log(`No items match ${criteria.join(" and ")}.`);
      }
      if (query) await offerLocalModel(0, json, config.registry);
      return;
    }

    if (json) {
      const output = matching.map((item) => ({
        name: item.name,
        type: item.type.replace("hyperframes:", ""),
        title: item.title,
        description: item.description,
        tags: item.tags ?? [],
        ...("dimensions" in item && item.dimensions ? { dimensions: item.dimensions } : {}),
        ...("duration" in item && item.duration ? { duration: item.duration } : {}),
      }));
      if (!query) {
        // A plain listing has no tier and no drop count, and this array shape
        // is already released. Leave it alone.
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      console.log(
        JSON.stringify(
          {
            query,
            tier: tierToken(searched),
            tier_detail: tierDetail(searched),
            dropped: searched?.missing ?? 0,
            shown: output.length,
            total: tagged.length,
            ...(warnings.length ? { warnings } : {}),
            results: output,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (searched) {
      // Name the search that actually ran. A user seeing worse results has to
      // be able to tell which tier produced them.
      const how = tierDetail(searched);
      const unshowable =
        searched.missing > 0
          ? ` · ${searched.missing} ranked ${searched.missing === 1 ? "move" : "moves"} not in this registry`
          : "";
      console.log(c.dim(`  ${matching.length} of ${tagged.length} moves · ${how}${unshowable}`));
      if (searched.localMode === "words") {
        // Suppressed when on-device was asked for and refused: telling someone
        // to pass a flag one line after explaining that flag cannot work here
        // reads as the tool arguing with itself.
        if (warnings.length === 0) {
          reportLocalModelOption(json);
          await offerLocalModel(matching.length, json, config.registry);
        }
      }
    }

    if (interactive) {
      const options = matching.map((item) => ({
        value: item.name,
        label: item.name,
        hint: item.description,
      }));

      const selected = await clack.select({
        message: `${matching.length} items available — pick one to install`,
        options,
      });

      if (clack.isCancel(selected)) {
        clack.cancel("Cancelled.");
        finishCommand(0);
      }

      const result = await runAdd({
        name: selected as string,
        projectDir: dir,
        skipClipboard: false,
      });

      for (const warning of result.warnings) {
        console.warn(c.warn(`Warning: ${warning}`));
      }
      console.log("");
      console.log(`${c.success("✓")} Installed ${c.accent(result.name)} (${result.type})`);
      for (const file of result.written) {
        const rel = file.replace(dir + "/", "");
        console.log(`  ${c.dim(rel)}`);
      }
      if (result.snippet) {
        console.log("");
        console.log(c.dim("Include snippet:"));
        console.log(`  ${result.snippet}`);
      }
      return;
    }

    const NAME_COL = 28;
    const TYPE_COL = 12;
    console.log(
      `${c.bold("Name".padEnd(NAME_COL))}${c.bold("Type".padEnd(TYPE_COL))}${c.bold("Description")}`,
    );
    console.log("-".repeat(80));

    for (const item of matching) {
      const type = item.type.replace("hyperframes:", "");
      const tags = item.tags?.length ? c.dim(` [${item.tags.join(", ")}]`) : "";
      console.log(
        `${c.cyan(item.name.padEnd(NAME_COL))}${type.padEnd(TYPE_COL)}${item.description}${tags}`,
      );
    }

    console.log("");
    console.log(c.dim(`${matching.length} items. Run "hyperframes add <name>" to install.`));
  },
});

/**
 * Resolve ranked names against the items this registry actually has.
 *
 * `missing` counts the ranked names this registry has no item for at all,
 * measured against `registryNames` — the whole catalog, not the post-filter
 * `items`. It is reported rather than swallowed: the catalog artifact and the
 * registry are published separately, so they can be different generations, and
 * the moves lost that way are the top-ranked ones.
 *
 * A move the user's own --type or --tag removed is not one of them. It is in
 * the registry and installable; they excluded it. Counting it here made every
 * filtered search report a skew that was not there, and made a real skew
 * indistinguishable from a filter doing its job.
 */
export function pickByName<T extends { name: string }>(
  items: T[],
  names: string[],
  registryNames: ReadonlySet<string>,
): { ranked: T[]; missing: number } {
  const byName = new Map(items.map((item) => [item.name, item]));
  const ranked = names
    .map((name) => byName.get(name))
    .filter((item): item is T => item !== undefined);
  return { ranked, missing: names.filter((name) => !registryNames.has(name)).length };
}

async function applySearch<T extends { name: string; title: string; description: string }>(
  items: T[],
  query: string,
  registryNames: ReadonlySet<string>,
): Promise<{ items: T[]; localMode: LocalMode; missing: number }> {
  // On-device meaning search, when the user opted into the model. Free and
  // offline, and it answers phrasings word matching cannot reach.
  if (localModelStatus().status === "ready") {
    try {
      const ranking = await localSemanticRanking(query);
      if (ranking) {
        const { ranked, missing } = pickByName(items, ranking, registryNames);
        if (ranked.length > 0) {
          return { items: ranked.slice(0, 25), localMode: "local-model", missing };
        }
      }
    } catch (error) {
      // A broken model costs ranking quality, never the command. It does not
      // get to cost it silently: a tier the user switched on that quietly does
      // not run is indistinguishable from one that ran badly.
      console.error(
        `on-device search did not run: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  // Shared vocabulary, not substring presence. A user asking to "make the
  // pace feel faster" shares no literal substring with any description, so
  // the old test returned nothing at all for exactly the phrasing people use.
  const words = searchByWords(
    query,
    items,
    (item) => `${item.name} ${item.title} ${item.description}`,
  );
  // Word matching ranks the items in hand, so nothing can go missing.
  return { items: words, localMode: "words", missing: 0 };
}

/**
 * Which tier answered, as a stable token.
 *
 * Deliberately not the printed sentence: "on-device meaning search" is written
 * for a person and will be reworded. A machine consumer needs something that
 * will not move underneath it.
 */
function tierToken(searched: { localMode: LocalMode } | null): "on-device" | "words" {
  return searched?.localMode === "local-model" ? "on-device" : "words";
}

/** The same tier, as the sentence a person reads. */
function tierDetail(searched: { localMode: LocalMode } | null): string {
  return searched?.localMode === "local-model" ? "on-device meaning search" : "local word match";
}

type LocalMode = "local-model" | "words";

/**
 * Offer the on-device model when word matching came up thin, and only then.
 *
 * Asking on first run would interrupt people the free tier already serves.
 * Asking here puts the evidence in front of them: they can see what word
 * matching returned before deciding whether 33 MB is worth it.
 */
/**
 * Nobody to ask, so say what to ask for.
 *
 * Without this a scripted run sits on word matching with no indication that a
 * better offline tier exists and is one question away.
 */
function reportLocalModelOption(json: boolean): void {
  if (!json && process.stdout.isTTY) return;
  if (localModelStatus().status !== "not-asked") return;
  console.error(nonInteractiveConsentMessage());
}

async function offerLocalModel(
  matchCount: number,
  json: boolean,
  registryBaseUrl: string,
): Promise<void> {
  if (json || !process.stdout.isTTY) return;
  if (localModelStatus().status !== "not-asked") return;
  // Deliberately not gated on the number of results. That gate was set when the
  // catalog was small; against 411 moves a word match nearly always returns
  // more than a handful, so it had quietly become unreachable and nobody was
  // ever told the offline tier exists. Reaching the weakest tier is the signal.

  const answer = await clack.confirm({
    message: downloadOfferMessage(matchCount),
    initialValue: true,
  });
  if (clack.isCancel(answer)) return;
  recordLocalModelConsent(answer === true);
  if (answer !== true) return;

  // The vectors come from the registry rather than the package, so consent is
  // also the moment to fetch them. A failure here is reported: the alternative
  // is an offline tier the user turned on that silently never ranks anything.
  const vectors = hasLocalVectors() || (await fetchLocalVectors(registryBaseUrl));
  console.log(
    c.dim(
      vectors
        ? "  Run the search again to download the model and rank by meaning."
        : "  Could not fetch the catalog vectors; offline ranking stays off until they are available.",
    ),
  );
}
