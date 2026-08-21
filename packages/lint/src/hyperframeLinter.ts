import type {
  HyperframeLintFinding,
  HyperframeLintResult,
  HyperframeLinterOptions,
  LintRule,
  LintTimings,
} from "./types";
import type { LintContext } from "./context";
import { buildLintContext } from "./context";
import { parseHtmlStructure, readAttr, truncateSnippet } from "./utils";
import { coreRules } from "./rules/core";
import { mediaRules } from "./rules/media";
import { gsapRules } from "./rules/gsap";
import { captionRules } from "./rules/captions";
import { compositionRules } from "./rules/composition";
import { adapterRules } from "./rules/adapters";
import { textureRules } from "./rules/textures";
import { fontRules } from "./rules/fonts";
import { slideshowRules } from "./rules/slideshow";

// Rules are grouped by source module so a timing can be attributed to
// something a human can act on. Individual rules stay anonymous: an
// index within its group ("gsap#7") is enough to locate a pathological
// rule, and naming all 86 of them is a refactor this measurement does
// not need in order to point at the right file.
//
// The cost of that choice is that the index is POSITIONAL: adding or
// removing a rule renumbers every later slot in its group, so "gsap#8"
// can mean different rules in two builds. LINT_RULE_GROUP_COUNTS below
// is what makes that detectable — a consumer comparing two builds can
// see which groups changed size and therefore which numbering is no
// longer comparable, without anyone having to remember what shipped when.
const RULE_GROUPS: ReadonlyArray<{
  group: string;
  rules: ReadonlyArray<LintRule<LintContext>>;
}> = [
  { group: "core", rules: coreRules },
  { group: "media", rules: mediaRules },
  { group: "gsap", rules: gsapRules },
  { group: "captions", rules: captionRules },
  { group: "composition", rules: compositionRules },
  { group: "adapters", rules: adapterRules },
  { group: "textures", rules: textureRules },
  { group: "fonts", rules: fontRules },
  { group: "slideshow", rules: slideshowRules },
];

/**
 * How many rules this build runs. `cli_version` already identifies the release,
 * but a rule added or removed inside one version is invisible without this —
 * and comparing findings-per-run across a rule change is the whole point of
 * measuring them.
 */
export const LINT_RULE_COUNT = RULE_GROUPS.reduce((n, g) => n + g.rules.length, 0);

/**
 * How many rules each group runs. `slowest_rule` is reported as
 * `<group>#<index>`, and that index shifts whenever a rule is added to or
 * removed from its group. Comparing these counts between two builds tells a
 * consumer exactly which groups' indices still mean the same thing.
 */
export const LINT_RULE_GROUP_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(
  RULE_GROUPS.map(({ group, rules }) => [group, rules.length]),
);

/** Two rules reporting the same problem on the same element report it once. */
function dedupeKeyFor(finding: HyperframeLintFinding): string {
  return [
    finding.code,
    finding.severity,
    finding.selector || "",
    finding.elementId || "",
    finding.message,
  ].join("|");
}

/**
 * Run every rule against one parsed context, timing each and deduping as it
 * goes. Rules are timed individually but reported per group; the slowest
 * single rule is kept so a pathological one stays locatable.
 */
async function runRules(
  ctx: LintContext,
  filePath: string | undefined,
): Promise<{ findings: HyperframeLintFinding[]; timings: Omit<LintTimings, "totalMs"> }> {
  const findings: HyperframeLintFinding[] = [];
  const seen = new Set<string>();
  const groupMs: Record<string, number> = {};
  let slowestRule = "";
  let slowestRuleMs = 0;

  for (const { group, rules } of RULE_GROUPS) {
    for (let index = 0; index < rules.length; index++) {
      const ruleStartedAt = performance.now();
      const produced = await Promise.resolve(rules[index]!(ctx));
      const ruleMs = performance.now() - ruleStartedAt;

      groupMs[group] = (groupMs[group] ?? 0) + ruleMs;
      if (ruleMs > slowestRuleMs) {
        slowestRuleMs = ruleMs;
        slowestRule = `${group}#${index}`;
      }

      collectFindings(produced, seen, filePath, findings);
    }
  }

  return { findings, timings: { groupMs, slowestRule, slowestRuleMs } };
}

function collectFindings(
  produced: readonly HyperframeLintFinding[],
  seen: Set<string>,
  filePath: string | undefined,
  into: HyperframeLintFinding[],
): void {
  for (const finding of produced) {
    const dedupeKey = dedupeKeyFor(finding);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    into.push(filePath ? { ...finding, file: filePath } : finding);
  }
}

export async function lintHyperframeHtml(
  html: string,
  options: HyperframeLinterOptions = {},
): Promise<HyperframeLintResult> {
  const startedAt = performance.now();
  const ctx = buildLintContext(html, options);
  const { findings, timings } = await runRules(ctx, options.filePath);

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
    timings: { totalMs: performance.now() - startedAt, ...timings },
  };
}

// ── Async media URL accessibility checker ─────────────────────────────────

function extractMediaUrls(html: string): Array<{
  url: string;
  tagName: string;
  elementId?: string;
  snippet: string;
}> {
  const results: Array<{
    url: string;
    tagName: string;
    elementId?: string;
    snippet: string;
  }> = [];
  for (const { name: tagName, raw } of parseHtmlStructure(html).tags) {
    if (!/^(?:video|audio|img|source)$/.test(tagName)) continue;
    const src = readAttr(raw, "src");
    if (!src) continue;
    if (/^https?:\/\//i.test(src)) {
      results.push({
        url: src,
        tagName,
        elementId: readAttr(raw, "id") || undefined,
        snippet: truncateSnippet(raw) ?? "",
      });
    }
  }
  return results;
}

/**
 * Async lint pass: HEAD-checks every remote media URL in the HTML.
 * Returns findings for URLs that are unreachable (non-2xx status or network error).
 *
 * Call this after `lintHyperframeHtml()` and merge the findings.
 *
 * @param timeoutMs - per-request timeout (default 8000ms)
 */
export async function lintMediaUrls(
  html: string,
  options: { timeoutMs?: number } = {},
): Promise<HyperframeLintFinding[]> {
  const urls = extractMediaUrls(html);
  if (urls.length === 0) return [];

  const timeout = options.timeoutMs ?? 8000;
  const findings: HyperframeLintFinding[] = [];

  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    if (seen.has(u.url)) return false;
    seen.add(u.url);
    return true;
  });

  const checks = unique.map(async ({ url, tagName, elementId, snippet }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const resp = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!resp.ok) {
        findings.push({
          code: "inaccessible_media_url",
          severity: "error",
          message: `<${tagName}${elementId ? ` id="${elementId}"` : ""}> references a URL that returned HTTP ${resp.status}: ${url.slice(0, 100)}`,
          elementId,
          fixHint: "This URL is not accessible. Replace with a valid, reachable media URL.",
          snippet,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.name : "unknown";
      findings.push({
        code: "inaccessible_media_url",
        severity: "error",
        message: `<${tagName}${elementId ? ` id="${elementId}"` : ""}> references an unreachable URL (${reason}): ${url.slice(0, 100)}`,
        elementId,
        fixHint: "This URL is not accessible. Replace with a valid, reachable media URL.",
        snippet,
      });
    }
  });

  await Promise.all(checks);
  return findings;
}
