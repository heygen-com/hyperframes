/**
 * CLI binding for the canary registry.
 *
 * `@hyperframes/core` owns the decision (pure, browser-safe, caller supplies
 * everything). This file supplies the three things only the CLI knows: the
 * install's stable id, the env override, and whether we're on CI.
 *
 * Using one, from anywhere in the CLI / producer call path:
 *
 * ```ts
 * import { isCanaryEnabled } from "../telemetry/canary.js";
 * if (isCanaryEnabled("de-parallel-router")) { ...ramped path... }
 * ```
 *
 * That is the whole API. Percentage lives in the registry, not at the call
 * site, so ramping is a one-line edit in a patch release and never touches
 * the feature's own code.
 */

// Leaf subpath imports, not the "@hyperframes/core" barrel: this resolves on
// the CLI startup path, and the barrel pulls the whole core surface. Same
// reason the producer is lazily loaded.
import {
  canaryFeatureProperties,
  evaluateCanary,
  parseCanaryOverride,
  type CanaryDecision,
} from "@hyperframes/core/canary";
import { CANARIES, canaryEnvVar, findCanary } from "@hyperframes/core/canary-registry";
import { readConfig } from "./config.js";
import { getSystemMeta } from "./system.js";

/**
 * Decisions are memoized per process: a `--batch` run asks the same question
 * once per row, and a canary must not change its mind mid-process — a render
 * that starts enrolled has to finish enrolled, and its telemetry has to agree
 * with what actually ran.
 */
const decisions = new Map<string, CanaryDecision>();

/** Test-only: drop memoized decisions so cases don't leak into each other. */
export function __resetCanaryCacheForTests(): void {
  decisions.clear();
}

/**
 * Full decision for a registered canary, including the reason — use this when
 * you want to record WHY, not just whether.
 *
 * An unregistered name resolves to off rather than throwing: a canary is a
 * rollout control, and a typo in one must never take down a render.
 */
export function resolveCanary(name: string): CanaryDecision {
  const cached = decisions.get(name);
  if (cached) return cached;

  const definition = findCanary(name);
  const decision: CanaryDecision = definition
    ? evaluateCanary({
        feature: definition.name,
        unitId: readConfig().anonymousId,
        percentage: definition.percentage,
        override: parseCanaryOverride(process.env[canaryEnvVar(definition.name)]),
        // CI installs regenerate their config per run, so their ids are
        // ephemeral — they would hop cohorts between runs, adding noise to the
        // rollout signal while saying nothing about real users. An explicit
        // override still gets through, which is how you test a canary in CI.
        exclude: getSystemMeta().is_ci,
      })
    : { enabled: false, reason: "out_of_cohort" };

  decisions.set(name, decision);
  return decision;
}

/** Is this canary on for this install? The everyday call. */
export function isCanaryEnabled(name: string): boolean {
  return resolveCanary(name).enabled;
}

/**
 * Canary assignments as PostHog flag properties — `$feature/canary-<name>`
 * set to `"true"` / `"false"` for every registered canary. Spread onto every
 * event so any metric can be broken down by cohort using PostHog's native
 * flag tooling, with nothing configured server-side. See
 * `canaryFeatureProperties` for why non-enrolled canaries are emitted too.
 */
export function canaryEventProperties(): Record<string, string> {
  return canaryFeatureProperties(
    CANARIES.map((c) => ({ name: c.name, enabled: resolveCanary(c.name).enabled })),
  );
}
