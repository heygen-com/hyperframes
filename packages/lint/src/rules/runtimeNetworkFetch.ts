import type { LintContext, HyperframeLintFinding } from "../context";
import type { LintRule } from "../types";
import { readAttr, truncateSnippet } from "../utils";

// Info, not error: remote CDN scripts are the documented quick start. `ledger --strict-offline`
// is the enforcing gate.
const REMOTE_SRC_RE = /^(https?:)?\/\//i;

const remoteScriptNotVendored: LintRule<LintContext> = (ctx) => {
  const findings: HyperframeLintFinding[] = [];
  const seen = new Set<string>();
  for (const script of ctx.scripts) {
    const tagSource = `<script ${script.attrs}>`;
    const src = readAttr(tagSource, "src");
    if (!src || !REMOTE_SRC_RE.test(src.trim()) || seen.has(src)) continue;
    seen.add(src);
    findings.push({
      code: "remote_script_not_vendored",
      severity: "info",
      message: `Remote <script> depends on the network at render time: ${src.slice(0, 120)}`,
      fixHint:
        "Run `hyperframes vendor` to download it into assets/vendor/ and rewrite the reference, then verify with `hyperframes ledger --strict-offline`.",
      snippet: truncateSnippet(tagSource),
    });
  }
  return findings;
};

export const runtimeNetworkFetchRules: ReadonlyArray<LintRule<LintContext>> = [
  remoteScriptNotVendored,
];
