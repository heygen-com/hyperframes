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
import { loadAllItems } from "../registry/resolver.js";
import { fetchRegistryManifest } from "../registry/remote.js";
import { loadProjectConfig, DEFAULT_PROJECT_CONFIG } from "../utils/projectConfig.js";
import { resolve } from "node:path";
import { finishCommand } from "../utils/commandResult.js";
import { runAdd } from "./add.js";
import { searchByWords } from "../registry/localSearch.js";
import {
  downloadOfferMessage,
  ensureLocalModel,
  type LocalModelStatus,
  localModelStatus,
  nonInteractiveConsentMessage,
  recordLocalModelConsent,
} from "../registry/localModel.js";
import { localRuntimeAvailable } from "../registry/localEmbedder.js";
import {
  cachedLocalVectorRevision,
  fetchLocalVectors,
  hasLocalVectors,
  localSemanticRanking,
  localVectorNames,
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
  artifactRevision?: string;
  canPrompt: boolean;
  registry: string;
  registryNames: ReadonlySet<string>;
  status: LocalModelStatus;
}): Promise<string[]> {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    console.error(message);
  };

  const status = opts.status;
  if (!opts.assumedYes && status.status === "declined") {
    warn(
      "on-device search skipped: the model download was previously declined. Re-run with --yes to consent.",
    );
    return warnings;
  }

  if (!opts.assumedYes && status.status === "not-asked" && !opts.canPrompt) {
    warn(nonInteractiveConsentMessage());
    return warnings;
  }

  if (!opts.assumedYes && status.status === "not-asked") {
    const answer = await clack.confirm({
      message: downloadOfferMessage(),
      initialValue: true,
    });
    if (clack.isCancel(answer) || answer !== true) {
      recordLocalModelConsent(false);
      warn("on-device search skipped: the download was declined.");
      // Return, or the decline is the only thing that does not happen: the
      // runtime check below is skipped precisely because consent is now false,
      // control reaches recordLocalModelConsent(true), and the answer is
      // overwritten with yes before the download it refused.
      return warnings;
    }
  }

  if (!(await localRuntimeAvailable())) {
    // Checked before downloading. Fetching 32 MB and then discovering the
    // runtime is missing wastes the bandwidth the consent was granted for.
    warn(
      "on-device search needs the native ONNX runtime, which a single-file build cannot load. " +
        "Install the CLI normally (npm i -g hyperframes) to use this tier.",
    );
    return warnings;
  }

  if (status.status === "declined" || status.status === "not-asked") {
    recordLocalModelConsent(true);
  }
  const model = await ensureLocalModel();
  const revisionStale =
    opts.artifactRevision !== undefined && cachedLocalVectorRevision() !== opts.artifactRevision;
  if (
    !hasLocalVectors() ||
    revisionStale ||
    countUnindexed(opts.registryNames, localVectorNames()) > 0
  ) {
    await fetchLocalVectors(opts.registry, { expectedRevision: opts.artifactRevision });
  }
  // Deliberately not the fetch's own answer. A refresh that fails still leaves
  // the previous vectors on disk, and those still rank: reporting the tier
  // unavailable there would be false, and the search that follows says what is
  // actually wrong with them.
  const vectors = hasLocalVectors();
  if (!model || !vectors) {
    warn(
      `on-device search unavailable: ${!model ? "model" : "catalog vectors"} could not be fetched`,
    );
  } else if (
    opts.artifactRevision !== undefined &&
    cachedLocalVectorRevision() !== opts.artifactRevision
  ) {
    warn("on-device search is using the previous catalog vectors because the update failed");
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
        "Search by meaning when the on-device model is on, otherwise by name, title, description and tags",
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
      description:
        "Use on-device meaning search; pass --yes to approve a first non-interactive download",
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

    // Asked for the whole manifest on purpose: its item list defines coverage,
    // and its artifact revision is the one owner of vector freshness.
    const manifest = await fetchRegistryManifest(config.registry);
    const entries = manifest?.items ?? [];
    const artifactRevision = manifest?.catalogArtifact?.revision;
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
    const searchContext = query ? { status: localModelStatus() } : null;
    const routineUpdate =
      searchContext?.status.status === "unavailable" ||
      (searchContext?.status.status === "ready" &&
        artifactRevision !== undefined &&
        cachedLocalVectorRevision() !== artifactRevision);
    const shouldPrepare = args["on-device"] === true || routineUpdate;
    let warnings: string[] = [];
    let effectiveStatus = searchContext?.status;
    if (searchContext && shouldPrepare) {
      warnings = await prepareOnDeviceTier({
        assumedYes: args.yes === true,
        artifactRevision,
        canPrompt: process.stdout.isTTY === true && !json,
        registry: config.registry,
        registryNames,
        status: searchContext.status,
      });
      // A successful preparation can move not-asked/unavailable to ready. Read
      // the state owner again rather than carrying the pre-download snapshot.
      effectiveStatus = localModelStatus();
    }
    const searched = effectiveStatus
      ? await applySearch(tagged, query, registryNames, effectiveStatus)
      : null;
    if (searched) warnings.push(...searched.warnings);
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
              unindexed: searched?.unindexed ?? 0,
              ...(searched?.topScore != null ? { top_score: searched.topScore } : {}),
              shown: 0,
              total: tagged.length,
              ...(warnings.length ? { warnings } : {}),
              report_gap: searchMissCommand(query, tierToken(searched)),
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
        // Zero results is the unambiguous case: no tier judgement to make and
        // nothing to install, so name the gap channel outright.
        if (query) {
          console.log("");
          console.log(c.dim("  Nothing in the catalog does this? Report the gap:"));
          console.log(c.dim(`  ${searchMissCommand(query, tierToken(searched))}`));
        }
      }
      if (query) await offerLocalModel(0, json, config.registry, artifactRevision);
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
            unindexed: searched?.unindexed ?? 0,
            ...(searched?.topScore != null ? { top_score: searched.topScore } : {}),
            shown: output.length,
            total: tagged.length,
            ...(warnings.length ? { warnings } : {}),
            // Carried on hits too, not just on zero results. The gaps that
            // actually get reported are the ones where the search returned
            // plausible items and none of them did the thing — a judgement
            // only the reader can make, so the command has to already be in
            // the envelope by the time they make it.
            report_gap: searchMissCommand(query, tierToken(searched)),
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
      if (searched.unindexed > 0) {
        // The costly direction, so it gets a line of its own rather than a
        // suffix: these moves cannot come back from meaning search at any rank,
        // for any query, and a reader has to learn what to run about it.
        // Silent when the index covers the registry.
        const remedy =
          args["on-device"] === true
            ? "The published index is behind this registry."
            : "Re-run with --on-device to refresh it.";
        console.log(
          c.warn(
            `  ${searched.unindexed} of ${registryNames.size} moves are missing from the ` +
              `on-device index, so meaning search cannot return them. ${remedy}`,
          ),
        );
      }
      if (searched.localMode === "words") {
        // Suppressed when on-device was asked for and refused: telling someone
        // to pass a flag one line after explaining that flag cannot work here
        // reads as the tool arguing with itself.
        if (warnings.length === 0) {
          reportLocalModelOption(json);
          await offerLocalModel(matching.length, json, config.registry, artifactRevision);
        }
      }
      if (query) {
        // Both tiers, deliberately. Gating this on on-device sounded right --
        // a thin word-match result is explainable, a thin meaning-match result
        // is a real gap -- but it silences the line in the case that produces
        // essentially every search: the on-device tier needs a consented 33 MB
        // download, so an agent run is on `words` unless it explicitly opted
        // in. Every catalog gap reported to date came from the word tier. The
        // tier rides along in the command so a vocabulary miss stays
        // distinguishable from a meaning miss when the reports are read.
        console.log(
          c.dim(`  None of these do it? ${searchMissCommand(query, tierToken(searched))}`),
        );
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

/**
 * Registry moves the on-device index holds no vector for.
 *
 * The counterpart to `pickByName`'s `missing`, and the direction that costs
 * something. `missing` is over-coverage: names the artifact ranks that this
 * registry cannot install, which only wastes a rank. This is under-coverage:
 * moves the registry has that were never embedded, so meaning search cannot
 * return them at any rank, for any query, and until now nothing in the output
 * said so. The vectors are fetched once and never invalidated, so every move
 * published since that fetch lands here.
 *
 * Measured against the unfiltered registry, matching `missing`: a --type or
 * --tag filter removing a move is the user narrowing their own search, not an
 * index that cannot see it.
 */
export function countUnindexed(
  registryNames: ReadonlySet<string>,
  indexedNames: Iterable<string>,
): number {
  const indexed = new Set(indexedNames);
  let count = 0;
  for (const name of registryNames) {
    if (!indexed.has(name)) count += 1;
  }
  return count;
}

interface SearchOutcome<T> {
  items: T[];
  localMode: LocalMode;
  warnings: string[];
  /** Over-coverage: ranked names this registry has no item for. */
  missing: number;
  /**
   * Under-coverage: registry moves the tier that answered could not see.
   *
   * Always zero for word matching, which ranks the live registry listing and
   * so cannot be stale. Non-zero only on the on-device tier, whose vectors are
   * a separately published artifact that drifts from the registry.
   */
  unindexed: number;
  /**
   * Similarity of the best result actually shown, when the answering tier
   * produces one. Null for word matching, whose score is a different and
   * non-comparable scale. Deliberately not a threshold: it is the signal a
   * caller needs to judge a ranker that ships without one.
   */
  topScore: number | null;
}

async function applySearch<
  T extends { name: string; title: string; description: string; tags?: string[] },
>(
  items: T[],
  query: string,
  registryNames: ReadonlySet<string>,
  status: LocalModelStatus,
): Promise<SearchOutcome<T>> {
  const warnings: string[] = [];
  // On-device meaning search, when the user opted into the model. Free and
  // offline, and it answers phrasings word matching cannot reach.
  if (status.status === "ready") {
    try {
      const ranking = await localSemanticRanking(query);
      if (ranking) {
        const { ranked, missing } = pickByName(
          items,
          ranking.map((entry) => entry.name),
          registryNames,
        );
        const best = ranked[0];
        if (best) {
          const scoreByName = new Map(ranking.map((entry) => [entry.name, entry.score]));
          return {
            items: ranked.slice(0, 25),
            localMode: "local-model",
            warnings,
            missing,
            unindexed: countUnindexed(registryNames, localVectorNames()),
            topScore: scoreByName.get(best.name) ?? null,
          };
        }
      }
    } catch (error) {
      // A broken model costs ranking quality, never the command. It does not
      // get to cost it silently: a tier the user switched on that quietly does
      // not run is indistinguishable from one that ran badly.
      const warning = `on-device search did not run: ${error instanceof Error ? error.message : "unknown error"}`;
      warnings.push(warning);
      console.error(warning);
    }
  }

  // Shared vocabulary, not substring presence. A user asking to "make the
  // pace feel faster" shares no literal substring with any description, so
  // the old test returned nothing at all for exactly the phrasing people use.
  const words = searchByWords(
    query,
    items,
    (item) => `${item.name} ${item.title} ${item.description} ${(item.tags ?? []).join(" ")}`,
  );
  // Word matching ranks the items in hand, so nothing can go missing.
  return { items: words, localMode: "words", warnings, missing: 0, unindexed: 0, topScore: null };
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

/**
 * The command that turns a fruitless search into a catalog gap report.
 *
 * A search that returns nothing usable is the only moment anyone knows what
 * the catalog is missing, and it was also the one moment we said nothing:
 * `feedback --search-miss` was documented in the skill and printed by
 * `feedback --help`, neither of which is open when a query comes back wrong.
 * Handing back the exact line, with the query already in it, is the whole
 * difference between a gap someone reports and a gap someone works around.
 *
 * Only the command is built here. Sending it stays a separate deliberate act,
 * so plain `catalog --query` keeps its promise that the query text never
 * leaves the machine.
 */
export function searchMissCommand(query: string, tier: "on-device" | "words"): string {
  // Double quotes with the shell metacharacters escaped: the queries that
  // matter are plain-language phrases, and half the real ones so far were
  // CJK, which single-quoting renders no more safely and reads worse.
  const quoted = query.replace(/(["\\$`])/g, "\\$1");
  return (
    `npx hyperframes feedback --search-miss "${quoted}" ` +
    `--wanted "<the move you needed>" --tier ${tier}`
  );
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
  artifactRevision?: string,
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
  const vectors =
    hasLocalVectors() ||
    (await fetchLocalVectors(registryBaseUrl, { expectedRevision: artifactRevision }));
  console.log(
    c.dim(
      vectors
        ? "  Run the search again to download the model and rank by meaning."
        : "  Could not fetch the catalog vectors; offline ranking stays off until they are available.",
    ),
  );
}
