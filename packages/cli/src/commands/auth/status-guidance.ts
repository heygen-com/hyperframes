/**
 * Onboarding guidance shown by `auth status` when nothing is configured.
 *
 * Kept separate from `status.ts` so the wording is pure (it depends only
 * on colors, not on the credential resolver / API client / system probe)
 * and can be unit-tested without booting the whole CLI dependency graph.
 * Environment detection lives in `status.ts`; this module only renders.
 */

import { c } from "../../ui/colors.js";

export interface UnconfiguredContext {
  /** A human can act on guidance now — a TTY, or a coding agent driving the CLI. */
  interactive: boolean;
}

/** The local engine a workflow will fall back to, and whether it's ready. */
export interface OfflineEngineLine {
  capability: "voice" | "music";
  /** Engine label, e.g. "Kokoro" / "MusicGen". */
  label: string;
  /** Deps installed (local) or key present (cloud) — usable right now. */
  ready: boolean;
  /** How to make it ready, shown when `ready` is false. */
  setupHint?: string;
}

/** The recommended first step; sign-in and sign-up are the same OAuth flow. */
const RECOMMENDED_ACTION = "npx hyperframes auth login";

/**
 * Render the "what offline will use" block from probed engine readiness.
 * Falls back to a generic one-liner when readiness wasn't probed (e.g. a
 * caller that didn't want to spawn Python).
 */
function offlineEngineLines(engines?: OfflineEngineLine[]): string[] {
  if (!engines || engines.length === 0) {
    return [
      c.dim("Prefer offline? Just continue — local engines (Kokoro · MusicGen) need no account."),
    ];
  }
  const lines = ["Prefer offline? Workflows will use these local engines:"];
  for (const e of engines) {
    const cap = e.capability.padEnd(5);
    if (e.ready) {
      lines.push(`  ${cap} → ${e.label}  ${c.success("✓ ready")}`);
    } else {
      lines.push(`  ${cap} → ${e.label}  ${c.warn("⚠ deps missing")}`);
      if (e.setupHint) lines.push(`          ${c.dim(e.setupHint)}`);
    }
  }
  if (engines.some((e) => !e.ready)) {
    lines.push(c.dim("  (or run `hyperframes doctor` to check the local toolchain)"));
  }
  return lines;
}

/**
 * Human guidance for an unconfigured machine — registration-first.
 * Both paths use `npx hyperframes` (zero-install via npm): browser OAuth
 * (sign-in / sign-up) and `--api-key` both write `~/.heygen`. The separate
 * `heygen` CLI shares that file but needs its own install (no `npx heygen`),
 * so it's left to the docs — not dangled here as a command a fresh machine
 * can't run. Names the local fallback so "no key" never reads as a failure,
 * and never steers users toward a per-repo `.env`. Mirrors the
 * media-use skill's Preflight section.
 */
export function buildUnconfiguredLines(
  ctx: UnconfiguredContext,
  engines?: OfflineEngineLine[],
): string[] {
  if (!ctx.interactive) {
    return [
      c.warn("Not signed in to HeyGen (non-interactive)."),
      c.dim(
        "Set HEYGEN_API_KEY to use HeyGen, or workflows fall back to local engines (Kokoro voice · MusicGen music).",
      ),
    ];
  }
  return [
    c.warn("Not signed in to HeyGen — voice & music will use local engines (free, offline)."),
    "",
    "Sign in or sign up (browser OAuth, writes ~/.heygen — no per-repo .env):",
    `  ${c.accent("npx hyperframes auth login")}            ${c.dim("# browser sign-in / sign-up")}`,
    "",
    "Or paste an existing HeyGen API key (get one at app.heygen.com/settings/api):",
    `  ${c.accent("npx hyperframes auth login --api-key")}  ${c.dim("# paste at the prompt")}`,
    "",
    ...offlineEngineLines(engines),
  ];
}

/** Machine-readable form of the unconfigured guidance for `--json`. */
export function buildUnconfiguredJson(
  ctx: UnconfiguredContext,
  engines?: OfflineEngineLine[],
): Record<string, unknown> {
  return {
    configured: false,
    interactive: ctx.interactive,
    recommended_action: RECOMMENDED_ACTION,
    fallback: "local",
    ...(engines ? { offline_engines: engines } : {}),
  };
}
