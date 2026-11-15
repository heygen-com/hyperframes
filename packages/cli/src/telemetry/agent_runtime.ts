import { existsSync, readFileSync, statSync } from "node:fs";
import { platform, release } from "node:os";
import { detectWSL } from "./platform.js";

// ---------------------------------------------------------------------------
// Sandbox runtime + agent vendor fingerprinting.
//
// Goal: distinguish "real developer laptop" from "ephemeral managed sandbox
// driving the CLI on someone's behalf" (Codex Cloud, Claude Code Web, Cursor
// Background Agents, etc.) without collecting any PII.
//
// We only read:
//   - well-known kernel strings (release(), /proc/version)
//   - sandbox marker files (/.dockerenv etc.)
//   - the *existence* of vendor environment variables — never the value
//     (some are API keys). The exceptions are self-identifying name or flag
//     variables (TERM_PROGRAM, AI_AGENT, `=1` flags), which are only compared
//     against fixed values and never emitted raw by detectAgentRuntime().
//
// Output is two opaque strings: sandbox_runtime ('gvisor' | 'docker' | ...)
// and agent_runtime ('claude_code' | 'codex' | ...). Both null when unknown.
// ---------------------------------------------------------------------------

export type SandboxRuntime = "gvisor" | "firecracker" | "docker" | "kvm" | "wsl" | null;

export type AgentRuntime =
  | "bob"
  | "claude_code"
  | "codex"
  | "cursor"
  | "copilot_agent"
  | "copilot_cli"
  | "replit"
  | "hermes"
  | "openclaw"
  | "pi"
  | "gemini_managed_agent"
  | "windsurf"
  | "cline"
  | "gemini_cli"
  | "crush"
  | "kilo"
  | "opencode"
  | "qwen_code"
  | "junie"
  | "antigravity"
  | "qoder"
  | "kiro"
  | "openhands"
  | "workbuddy"
  | "codebuddy"
  | "trae"
  | "pippit"
  | "doubao"
  | "aily"
  | "grok"
  | "kimi"
  | "zcode"
  | "swe_agent"
  | "dsh"
  | "claude_agent_sdk"
  | "devin"
  | "amp"
  | "v0"
  | "rovodev"
  | "base44"
  | "auggie"
  | "muse"
  | "warp_oz"
  | "other_ai_agent"
  | null;

interface VendorRule {
  name: Exclude<AgentRuntime, null>;
  /** Check returns true when the named agent (or, in WORKSPACE_RULES, that editor or host) runs the CLI. */
  check: (env: NodeJS.ProcessEnv) => boolean;
}

// Ordering matters: the FIRST rule that matches wins. Put more specific rules
// before more generic ones (e.g. kilo before opencode, whose OPENCODE=1 Kilo's
// bash tool also sets), and the generic AI_AGENT fallback after all of them.
const VENDOR_RULES: VendorRule[] = [
  // IBM Bob Shell — both shell execution paths stamp BOBSHELL_CLI=1 onto the
  // child environment: childProcessFallback's spawn env and executeWithPty's
  // PTY env. Keep this ahead of other agents because Bob inherits the parent
  // environment, so a Bob session launched from Codex or Claude can carry both
  // vendors' markers; BOBSHELL_CLI identifies the immediate executor.
  // BOBSHELL_API_KEY is deliberately ignored: it is an authentication setting,
  // not proof that Bob launched the current process.
  // Source: IBM Bob Shell 1.0.6 bundle (lb.childProcessFallback / executeWithPty).
  {
    name: "bob",
    check: (env) => typeof env["BOBSHELL_CLI"] === "string",
  },
  // Claude Code sets CLAUDE_CODE_CHILD_SESSION on what its tools spawn, and
  // CLAUDE_CODE_ENTRYPOINT on itself, which MCP servers inherit too. Not
  // CLAUDECODE: its IDE extensions also set that in a terminal a person uses.
  // Source: https://code.claude.com/docs/en/env-vars
  {
    name: "claude_code",
    check: (env) =>
      typeof env["CLAUDE_CODE_CHILD_SESSION"] === "string" ||
      typeof env["CLAUDE_CODE_ENTRYPOINT"] === "string",
  },
  // OpenAI Codex (https://github.com/openai/codex).
  // - CODEX_THREAD_ID — set unconditionally on every spawned shell command
  //   (codex-rs/protocol/src/shell_environment.rs:6 constant, set by
  //   codex-rs/core/src/unified_exec/process_manager.rs:1010 and
  //   codex-rs/core/src/tools/runtimes/mod.rs:164).
  // - CODEX_CI — hardcoded in the UNIFIED_EXEC_ENV array, always set on
  //   every unified-exec child (process_manager.rs:70).
  // - CODEX_SANDBOX_NETWORK_DISABLED — set when network sandbox is active
  //   (codex-rs/core/src/sandboxing/mod.rs:135-138, default-on).
  // CODEX_HOME is deliberately NOT used — it's a config override read at
  // Codex startup, not propagated to spawned subprocesses.
  {
    name: "codex",
    check: (env) =>
      typeof env["CODEX_THREAD_ID"] === "string" ||
      typeof env["CODEX_CI"] === "string" ||
      typeof env["CODEX_SANDBOX_NETWORK_DISABLED"] === "string",
  },
  // Cursor Agent sets CURSOR_AGENT, CURSOR_CONVERSATION_ID per command and
  // CURSOR_SANDBOX on sandboxed ones. After Claude/Codex for nested agents.
  // Source: https://docs.cursor.com/en/agent/terminal,
  // https://cursor.com/docs/agent/security/run-modes
  {
    name: "cursor",
    check: (env) =>
      Boolean(env["CURSOR_AGENT"]) ||
      typeof env["CURSOR_CONVERSATION_ID"] === "string" ||
      typeof env["CURSOR_SANDBOX"] === "string",
  },
  // Nous Research Hermes Agent — its cli.py unconditionally executes
  //   os.environ["HERMES_QUIET"] = "1"
  // at module load, so the marker propagates via os.environ to every
  // subprocess spawned by Hermes. Keying on existence (not the literal
  // "1") so we still match if Hermes ever changes the value.
  // Source: https://github.com/NousResearch/hermes-agent/blob/main/cli.py#L50
  {
    name: "hermes",
    check: (env) => typeof env["HERMES_QUIET"] === "string",
  },
  // openclaw — multi-channel AI gateway. It sets OPENCLAW_CONFIG_PATH on the
  // CLI subprocesses it spawns. Never name its state-dir var here: endpoint
  // scanners flag that string as an IoC and quarantine the bundle (#5245).
  // Source: https://github.com/openclaw/openclaw
  {
    name: "openclaw",
    check: (env) => typeof env["OPENCLAW_CONFIG_PATH"] === "string",
  },
  // Pi coding agent (https://pi.dev, https://github.com/earendil-works/pi).
  // packages/coding-agent/src/cli.ts:13 unconditionally executes
  //   process.env.PI_CODING_AGENT = "true";
  // at module entry, so every subprocess Pi spawns sees this marker.
  {
    name: "pi",
    check: (env) => typeof env["PI_CODING_AGENT"] === "string",
  },
  // Cline (cline/cline) VS Code extension — injects CLINE_ACTIVE=true into the
  // integrated terminal via vscode.TerminalOptions.env, which the terminal
  // exports to every shell command run in it.
  // Caveat: present only on the default "vscodeTerminal" exec path — the opt-in
  // backgroundExec/YOLO path spawns via child_process without the marker. Same
  // integrated-terminal-only scope as the Cursor/Windsurf rules in WORKSPACE_RULES.
  // The npm Cline CLI instead adds CLINE_WRAPPER_PATH to its child env, which
  // its bash tool passes on (apps/cli/bin/cline).
  // Source: https://github.com/cline/cline/blob/main/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts
  {
    name: "cline",
    check: (env) =>
      typeof env["CLINE_ACTIVE"] === "string" || typeof env["CLINE_WRAPPER_PATH"] === "string",
  },
  // Google Gemini CLI (open-source @google/gemini-cli) — DISTINCT from the
  // Gemini managed-agent sandbox. (If a /.agents/ filesystem detector is
  // present in detectAgentRuntime() it runs ahead of this loop and wins for a
  // managed-agent sandbox, leaving this rule to match only the local CLI.)
  // The shell-execution service
  // sets GEMINI_CLI=1 on the child env of every shell command it spawns, so
  // downstream executables can tell they were launched by Gemini CLI
  // (packages/core/src/services/shellExecutionService.ts:56,486-487 — spread
  // onto baseEnv after sanitizeEnvironment, passed as env: to both the
  // child_process and node-pty spawn paths).
  // Caveat: under STRICT sanitization (when GITHUB_SHA is set / the GitHub
  // Action surface) GEMINI_CLI is not allow-listed and gets stripped — reliable
  // for the local CLI, not inside Gemini's GitHub Action runner.
  // Source: https://github.com/google-gemini/gemini-cli (shellExecutionService.ts:56,486-487)
  {
    name: "gemini_cli",
    check: (env) => typeof env["GEMINI_CLI"] === "string",
  },
  // Crush (charmbracelet/crush) — internal/shell/shell.go:43-48,98
  // unconditionally appends CRUSH=1 (plus generic AGENT=crush / AI_AGENT=crush)
  // to the env of every shell it spawns: both the interactive bash tool and the
  // hook runner. We key on CRUSH since AGENT/AI_AGENT are generic and collide.
  // Source: https://github.com/charmbracelet/crush (internal/shell/shell.go:43-48,98)
  {
    name: "crush",
    check: (env) => typeof env["CRUSH"] === "string",
  },
  // Kilo Code CLI: bootstrap sets KILO=1 and KILOCODE_VERSION on its own
  // process.env, so every shell it spawns inherits both. Must stay ahead of
  // opencode: Kilo is an opencode fork and its bash tool also sets OPENCODE=1.
  // Source: https://github.com/Kilo-Org/kilocode (packages/opencode/src/kilocode/cli/setup.ts)
  {
    name: "kilo",
    check: (env) => env["KILO"] === "1" || typeof env["KILOCODE_VERSION"] === "string",
  },
  // opencode: the bash tool sets OPENCODE=1 and OPENCODE_SESSION_ID (plus the
  // generic AGENT=1 and AI_AGENT=opencode) on every command it runs.
  // Source: https://github.com/anomalyco/opencode (packages/core/src/tool/plugin/shell.ts)
  {
    name: "opencode",
    check: (env) => env["OPENCODE"] === "1" || typeof env["OPENCODE_SESSION_ID"] === "string",
  },
  // Qwen Code: the shell execution service sets QWEN_CODE=1 on the child env
  // of both the child_process and PTY spawn paths.
  // Source: https://github.com/QwenLM/qwen-code (packages/core/src/services/shellExecutionService.ts)
  {
    name: "qwen_code",
    check: (env) => env["QWEN_CODE"] === "1",
  },
  // JetBrains Junie CLI: the launcher shim exports JUNIE_SHIM_PATH before it
  // execs the agent, so every process the agent spawns inherits it.
  // Source: https://github.com/JetBrains/junie (templates/junie.shim.sh)
  {
    name: "junie",
    check: (env) => typeof env["JUNIE_SHIM_PATH"] === "string",
  },
  // Google Antigravity: sets ANTIGRAVITY_AGENT on the commands its agent runs;
  // Google's own firebase-tools keys its agent detection on this marker.
  // Source: https://github.com/firebase/firebase-tools/pull/10457 (src/env.ts)
  {
    name: "antigravity",
    check: (env) => Boolean(env["ANTIGRAVITY_AGENT"]),
  },
  // Qoder: sets a non-empty QODER_AGENT on the terminals its agent runs.
  // Source: https://docs.qoder.com/troubleshooting/terminal-execution-exceptions
  {
    name: "qoder",
    check: (env) => Boolean(env["QODER_AGENT"]),
  },
  // Kiro: AGENT_DISPLAY_OUT / AGENT_CONTEXT_OUT are "only set when the agent is
  // driving". TERM_PROGRAM=kiro is deliberately NOT used: Kiro sets it for a
  // person's terminal too.
  // Source: https://kiro.dev/docs/reference/built-in-tools
  {
    name: "kiro",
    check: (env) => Boolean(env["AGENT_DISPLAY_OUT"]) || Boolean(env["AGENT_CONTEXT_OUT"]),
  },
  // Auggie (Augment CLI): its shell tool runs commands with AUGMENT_AGENT=1
  // (@augmentcode/auggie bundle, augment.mjs).
  { name: "auggie", check: (env) => typeof env["AUGMENT_AGENT"] === "string" },
  // Amp: the Bash tool and toolbox subprocesses get AMP_CURRENT_THREAD_ID
  // (@sourcegraph/amp bundle, dist/main.js).
  { name: "amp", check: (env) => typeof env["AMP_CURRENT_THREAD_ID"] === "string" },
  // Muse Code: Meta's launcher exports MUSE_RELEASE_INFO, then execs the agent.
  // Source: https://api.meta.ai/muse-launcher.sh
  { name: "muse", check: (env) => typeof env["MUSE_RELEASE_INFO"] === "string" },
  // Closed-source agents with no public marker. Each key below shows up in this
  // CLI's own agent_env_hints on non-interactive runs, which is direct evidence
  // that it is in the env of the shell the agent spawned. Only key presence is
  // checked; several values are tokens and are never read. WorkBuddy is built
  // on CodeBuddy and carries its keys too, so it goes first.
  // Source: agent_env_hints discovery telemetry (detectAgentHints below).
  { name: "workbuddy", check: (env) => typeof env["WORKBUDDY_CLIENT_USER_AGENT"] === "string" },
  {
    name: "codebuddy",
    check: (env) =>
      typeof env["CODEBUDDY_SESSION_ID"] === "string" ||
      typeof env["CODEBUDDY_AGENTOS_SESSION_ID"] === "string",
  },
  {
    name: "trae",
    check: (env) =>
      typeof env["ICUBE_AI_AGENT_SHUTDOWN_TOKEN"] === "string" ||
      typeof env["TRAE_REMOTE_AGENT_TOKEN"] === "string",
  },
  {
    name: "pippit",
    check: (env) =>
      typeof env["AUTO_PIPPIT_THREAD_ID"] === "string" ||
      typeof env["PIPPIT_OBS_AGENT_NAME"] === "string",
  },
  { name: "doubao", check: (env) => typeof env["DOUBAO_OFFICE_AGENT_NAME"] === "string" },
  { name: "aily", check: (env) => typeof env["AILY_CLI_AGENT_DELIVER_BLOCKED"] === "string" },
  { name: "grok", check: (env) => typeof env["GROK_SESSION_ID"] === "string" },
  { name: "kimi", check: (env) => typeof env["KIMI_AGENT_CLIENT_ID"] === "string" },
  { name: "zcode", check: (env) => typeof env["ZCODE_SESSION_ID"] === "string" },
  { name: "swe_agent", check: (env) => typeof env["SWE_AGENT_ENV_FILE"] === "string" },
  // DeepSeek harness (dsh): every model shell call, bash or pwsh, runs with
  // DSH_SHELL=1. DSH_SESSION_ID is NOT used: dsh also sets it on the interactive
  // terminal a person types into. HyperFrames Desktop runs dsh too; those runs
  // also carry HYPERFRAMES_CLIENT, which tells the two apart.
  // Source: https://github.com/deepseek-ai/deepseek-harness (packages/terminal/terminal-bash/src/index.ts,
  // packages/api/terminal-controller/src/index.ts)
  { name: "dsh", check: (env) => env["DSH_SHELL"] === "1" },
  // GitHub Copilot CLI: shell commands and MCP servers receive
  // COPILOT_AGENT_SESSION_ID, and its subprocesses carry COPILOT_CLI=1.
  // Both Copilot rules sit after the other agents: their markers are inherited,
  // so an agent Copilot starts must win. copilot_cli goes first because the CLI
  // run from a VS Code agent terminal inherits that terminal's COPILOT_AGENT=1.
  // Source: https://github.com/github/copilot-cli (changelog.md)
  {
    name: "copilot_cli",
    check: (env) =>
      env["COPILOT_CLI"] === "1" || typeof env["COPILOT_AGENT_SESSION_ID"] === "string",
  },
  // GitHub Copilot agent mode in VS Code: the agent's terminal tool sets
  // AI_AGENT=github_copilot_<surface> and COPILOT_AGENT=1 on agent terminals
  // only, never on a person's terminal.
  // Source: https://github.com/microsoft/vscode (src/vs/platform/chat/common/aiAgentEnv.ts,
  // src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/toolTerminalCreator.ts)
  {
    name: "copilot_agent",
    check: (env) =>
      env["COPILOT_AGENT"] === "1" || env["AI_AGENT"]?.startsWith("github_copilot_") === true,
  },
  // OpenHands: sanitized_env() defaults AI_AGENT=openhands on every command
  // the agent runs (it keeps an inherited value, so an outer agent's name wins).
  // Last of the vendor rules because AI_AGENT is the generic convention.
  // Source: https://github.com/OpenHands/software-agent-sdk (openhands-sdk/openhands/sdk/utils/command.py)
  {
    name: "openhands",
    check: (env) => env["AI_AGENT"]?.trim().toLowerCase() === "openhands",
  },
  // Warp Oz: OZ_RUN_ID wraps a Claude/Codex/Gemini run, so it follows them.
  // Source: https://github.com/warpdotdev/warp (crates/warp_cli/src/lib.rs)
  { name: "warp_oz", check: (env) => typeof env["OZ_RUN_ID"] === "string" },
  // An app built on the Claude Agent SDK, outside Claude Code's own shell tool
  // (that path sets CLAUDE_CODE_CHILD_SESSION, caught above). The SDK always
  // sets CLAUDE_AGENT_SDK_VERSION on what it spawns. After the agent rules, so
  // a vendor that builds on the SDK and sets its own marker wins.
  // Source: https://github.com/anthropics/claude-agent-sdk-python (src/claude_agent_sdk/_internal/transport/subprocess_cli.py)
  {
    name: "claude_agent_sdk",
    check: (env) => typeof env["CLAUDE_AGENT_SDK_VERSION"] === "string",
  },
];

// Editor terminals and hosted workspaces mark where a shell runs, not that an
// agent drives it. Checked after every agent marker, the AI_AGENT name check
// included, and never counted by isAgentDriven().
const WORKSPACE_RULES: VendorRule[] = [
  // Cursor's TERM_PROGRAM identifies the IDE terminal only.
  // Source: https://docs.cursor.com/en/agent/terminal
  { name: "cursor", check: (env) => env["TERM_PROGRAM"] === "cursor" },
  // Windsurf (Codeium) integrated terminal — exports TERM_PROGRAM=windsurf.
  // Attested across many independent detectors (nx
  // packages/nx/src/native/ide/detection.rs, adonisjs/application, ag-grid
  // git-hooks). Compared case-INsensitively (unlike the exact Cursor rule
  // above) because Windsurf sources disagree on casing ("windsurf" vs
  // "Windsurf"); Cursor's do not, so it stays exact. Like Cursor this marks the
  // editor's integrated terminal, not specifically that the Cascade agent is
  // driving; under WSL/remote it can also fall back to TERM_PROGRAM=vscode.
  {
    name: "windsurf",
    check: (env) => env["TERM_PROGRAM"]?.toLowerCase() === "windsurf",
  },
  // Replit — REPL_ID and REPLIT_USER are long-documented environment
  // variables exposed inside every Replit workspace.
  // Source: https://docs.replit.com/replit-workspace/configuring-the-environment
  {
    name: "replit",
    check: (env) => typeof env["REPL_ID"] === "string" || typeof env["REPLIT_USER"] === "string",
  },
];

// AI_AGENT convention: an agent sets AI_AGENT=<name> and keeps an inherited
// value, so the outermost agent's name wins. Checked AFTER every VENDOR_RULE so
// the immediate executor's own marker takes precedence. Unknown slug-safe names
// become "other_ai_agent" (the raw name goes out as agent_hint). Bare AGENT only
// counts when it holds a known name: it has no agreed values and AGENT=1 is
// common. A known name matches exactly or as a `<name>_` / `<name>-` prefix
// (Claude Code sends claude-code_2-1-307_agent, Devin devin_<build>_agent); the
// boundary keeps "pi" from swallowing "pilot". Names past hermes come from the
// values this CLI's agent_hint reports.
// Sources: https://github.com/vercel/vercel (packages/detect-agent),
// https://github.com/agentsmd/agents.md/pull/136
const AI_AGENT_RUNTIMES: ReadonlyArray<readonly [string, Exclude<AgentRuntime, null>]> = [
  ["claude-code", "claude_code"],
  ["opencode", "opencode"],
  ["crush", "crush"],
  ["pi", "pi"],
  ["hermes", "hermes"],
  ["github_copilot", "copilot_agent"],
  ["openhands", "openhands"],
  ["antigravity", "antigravity"],
  ["trae", "trae"],
  ["devin", "devin"],
  ["amp", "amp"],
  ["v0", "v0"],
  ["rovodev", "rovodev"],
  ["base44", "base44"],
];

function knownAgentName(value: string | null): AgentRuntime {
  if (value === null) return null;
  const known = AI_AGENT_RUNTIMES.find(
    ([name]) => value === name || value.startsWith(`${name}_`) || value.startsWith(`${name}-`),
  );
  return known?.[1] ?? null;
}

function aiAgentFallback(env: NodeJS.ProcessEnv): AgentRuntime {
  const aiAgent = sanitizeHint(env["AI_AGENT"]);
  return (
    knownAgentName(aiAgent) ??
    knownAgentName(sanitizeHint(env["AGENT"])) ??
    (aiAgent === null ? null : "other_ai_agent")
  );
}

// Agents evaluated and deliberately NOT added. Each fails the bar the rules
// above meet — a marker reliably present in the environment of the
// shell/subprocess the agent spawns. Recorded here (not only in the PR) so the
// next person doesn't re-derive it:
//   - OpenHands OPENHANDS_BUILD_GIT_SHA/_REF: declared in the agent-server
//     Dockerfile but absent from every published agent-server image inspected.
//     OpenHands is detected through AI_AGENT=openhands instead (rule above).
//   - Aider — sets no self-identifying env var; both shell-spawn sites
//     (run_cmd.py Popen / pexpect.spawn) pass no env=, so children inherit
//     os.environ verbatim.
//   - Goose — AGENT=goose/GOOSE_TERMINAL=1 are set on the recipe-retry path
//     and the computercontroller MCP extension, but NOT on the default
//     developer `shell` tool (sets only PATH+cwd), so the primary path is
//     undetected.
//   - opencode OPENCODE_TERMINAL: PTY panel only, not the bash tool (opencode
//     is detected through the bash tool's own markers, rule above).
//   - Roo Code — ROO_ACTIVE is set only on the `vscode` terminal provider; the
//     shipped default is the execa provider (terminalShellIntegrationDisabled
//     defaults true), which sets no marker.
//   - Jules / Factory Droid — no verifiable unconditional runtime marker
//     (Jules is a closed sandbox; Factory's FACTORY_PROJECT_DIR /
//     DROID_PLUGIN_ROOT are hook-scoped only). Devin is detected by the agent
//     name it reports instead (AI_AGENT_RUNTIMES).
//   - Seen only in a shipped bundle: Grok GROK_AGENT (also conflicts with an
//     older probe; GROK_SESSION_ID is used), Factory FACTORY_SESSION_ID.
//   - Third-party detector packages only: Trae TRAE_AI_SHELL_ID, Windsurf
//     WINDSURF_CASCADE_TERMINAL (plus a forum post).
//   - Kimi Code: its bash tool sets no marker (MoonshotAI/kimi-code bashTool.ts);
//     the kimi rule keys on the hosted agent's KIMI_AGENT_CLIENT_ID.

/**
 * Identify the managed sandbox runtime hosting this CLI invocation.
 * Returns null on a normal developer machine. Dispatches to runtime-specific
 * detectors that each return a boolean; the priority order encoded here is
 * deliberate (WSL > gVisor > Docker > Firecracker > KVM).
 */
export function detectSandboxRuntime(): SandboxRuntime {
  if (platform() === "win32") return null;
  if (detectWSL()) return "wsl";
  if (isGVisor()) return "gvisor";
  if (isDocker()) return "docker";
  if (isFirecracker()) return "firecracker";
  if (isKVM()) return "kvm";
  return null;
}

/**
 * Identify the coding-agent vendor that spawned this process, if any.
 * Returns null on a regular interactive shell. Most rules only check the
 * EXISTENCE of well-known env vars (never their values), but a few agents
 * are best identified by filesystem markers — those run via dedicated
 * detector functions ahead of the env-var rule loop.
 */
export function detectAgentRuntime(): AgentRuntime {
  // Gemini managed agent — keyed on the `/.agents/` platform mount with a
  // gVisor guard against false positives. See `isGeminiManagedAgent` for the
  // uniqueness-anchor-vs-guard split. Env vars alone are insufficient
  // (`GEMINI_API_KEY` is user-settable), so this runs ahead of VENDOR_RULES.
  if (isGeminiManagedAgent()) return "gemini_managed_agent";
  for (const rule of VENDOR_RULES) {
    if (rule.check(process.env)) return rule.name;
  }
  return (
    aiAgentFallback(process.env) ??
    WORKSPACE_RULES.find((rule) => rule.check(process.env))?.name ??
    null
  );
}

/** An agent is running this shell, not a person typing in an editor's terminal or a hosted workspace. */
export function isAgentDriven(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isGeminiManagedAgent()) return true;
  return VENDOR_RULES.some((rule) => rule.check(env)) || aiAgentFallback(env) !== null;
}

/** Observed harness marker, not proof of a vendor, benchmark, or human user. */
export function detectExecutionHarnessHint(): "harbor" | null {
  // Read presence only. Preserve this context even when the child agent is known.
  return typeof process.env["HARBOR_AGENT"] === "string" ? "harbor" : null;
}

// ---------------------------------------------------------------------------
// New-agent discovery signals.
//
// VENDOR_RULES is a CLOSED allowlist: an agent we haven't written a rule for
// collapses to agent_runtime=null, leaving no trace of what it was. That makes
// the null bucket un-attributable — new agents stay invisible until someone
// reverse-engineers their marker by hand (which is how every rule above was
// derived).
//
// detectAgentHints() adds a self-populating residual signal for exactly that
// null bucket, so an unrecognized agent surfaces on its own in analytics and
// can be promoted to a real VENDOR_RULE later. Callers should only emit these
// when detectAgentRuntime() returns null or "other_ai_agent" (the AI_AGENT
// value no rule names); any other classified event needs no hint.
//
// Privacy — consistent with the "never read secret-shaped values" stance above:
//   - agent_env_hints emits KEY NAMES only, never values.
//   - agent_hint / term_program read the VALUE of three vars whose sole purpose
//     is non-secret self-identification: the emerging AGENT / AI_AGENT
//     agent-name convention (e.g. Crush and Goose set AGENT=<name>) and
//     TERM_PROGRAM's editor name (how the cursor/windsurf rules already work).
//     Each value is passed through a strict short-slug allowlist, so anything
//     long, spaced, or secret-shaped is dropped to null.
// ---------------------------------------------------------------------------

export interface AgentHints {
  /**
   * Best-effort agent name: AI_AGENT (what "other_ai_agent" was classified
   * from), else AGENT, which is often just a flag like AGENT=1. null when neither
   * is set or the value isn't a short safe slug.
   */
  agent_hint: string | null;
  /**
   * Raw TERM_PROGRAM value (editor/terminal name) — surfaces IDE-terminal
   * agents not yet covered by the cursor/windsurf rules. Noisy (also set by
   * plain human terminals); read alongside is_tty=false. null when unset/unsafe.
   */
  term_program: string | null;
  /**
   * Sorted, comma-joined list of "agent-ish" env-var KEY names present but
   * matched by no vendor rule — a compact fingerprint that clusters by agent.
   * KEYS only, never values. null when none are present.
   */
  agent_env_hints: string | null;
}

// Self-identifying values are agent/editor NAMES by convention — short slugs.
// Anything longer, spaced, or secret-shaped falls outside this and is dropped.
const SAFE_HINT = /^[a-z0-9_.-]{1,32}$/;

// The slug allowlist alone still accepts SHORT credential-shaped values
// (AGENT=sk-ant-api03, AGENT=AKIAIOSFODNN7EXAMPLE, AGENT=github_pat_abc), so
// two extra guards enforce the "never emit a secret" boundary this PR relies on:
//   1. known credential/token prefixes (compared lowercased), and
//   2. any unbroken alphanumeric run >= 16 chars — the shape of key bodies,
//      hex digests, and base64-ish tokens (agent names segment on _/-/. and
//      keep each run short).
const CREDENTIAL_PREFIXES = [
  "sk-",
  "sk_",
  "pk-",
  "pplx-",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "glpat-",
  "gsk_",
  "xox",
  "akia",
  "asia",
  "aiza",
  "ya29",
  "hf_",
  "r8_",
];
const LONG_ALNUM_RUN = /[a-z0-9]{16,}/;

function looksLikeCredential(v: string): boolean {
  if (CREDENTIAL_PREFIXES.some((p) => v.startsWith(p))) return true;
  return LONG_ALNUM_RUN.test(v);
}

function sanitizeHint(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!SAFE_HINT.test(v)) return null;
  if (looksLikeCredential(v)) return null;
  return v;
}

// A key (uppercased) looks like a coding-agent marker. Excludes the two
// value-captured generics (read via agent_hint), the SSH/GPG "agent" false
// friends, which are credential agents, not coding agents, and a few ambient
// keys that only match by accident (a CI runner's toolcache path, a browser's
// metrics session, a desktop session's ssh-agent switch). No bare `CODING`
// token — it substring-matches `ENCODING` (e.g. PYTHONIOENCODING) and real
// coding-agent keys already match via `AGENT` (e.g. PI_CODING_AGENT).
export const HINT_KEY_PATTERN = /AGENT|ASSISTANT|COPILOT|CODEX|CLAUDE|LLM|_THREAD_ID$|_SESSION_ID$/;

function isDiscoveryHintKey(upperKey: string): boolean {
  if (upperKey === "AGENT" || upperKey === "AI_AGENT") return false;
  if (upperKey.startsWith("SSH_") || upperKey.startsWith("GPG_")) return false;
  if (
    [
      "NPM_CONFIG_USER_AGENT",
      "TERM_SESSION_ID",
      "XDG_SESSION_ID",
      "AGENT_TOOLSDIRECTORY",
      "GSM_SKIP_SSH_AGENT_WORKAROUND",
      "EDGE_METRICS_SESSION_ID",
    ].includes(upperKey)
  )
    return false;
  return HINT_KEY_PATTERN.test(upperKey);
}

function discoveryHintPriority(key: string): number {
  // Kubernetes service expansion can otherwise consume the entire hint cap.
  if (/_SERVICE_(HOST|PORT)(_|$)|_PORT(_\d+_(TCP|UDP)(_(ADDR|PORT|PROTO))?)?$/.test(key)) return 2;
  if (/^(HARBOR_AGENT|CURSOR_AGENT|ANTIGRAVITY_AGENT)$|_(SESSION_ID|THREAD_ID)$/.test(key))
    return 0;
  return 1;
}

/**
 * Residual discovery signals for the agent_runtime=null bucket. See the section
 * comment above for intent and the privacy contract. Pure over process.env.
 */
export function detectAgentHints(): AgentHints {
  const env = process.env;
  const agent_hint = sanitizeHint(env["AI_AGENT"]) ?? sanitizeHint(env["AGENT"]);
  const term_program = sanitizeHint(env["TERM_PROGRAM"]);

  const keys = new Set<string>();
  for (const key of Object.keys(env)) {
    if (key.length > 64) continue;
    const upper = key.toUpperCase();
    if (isDiscoveryHintKey(upper)) keys.add(upper);
  }
  const selected = [...keys]
    .sort((a, b) => discoveryHintPriority(a) - discoveryHintPriority(b) || a.localeCompare(b))
    .slice(0, 16)
    .sort();
  const agent_env_hints = selected.length ? selected.join(",") : null;

  return { agent_hint, term_program, agent_env_hints };
}

// ---------------------------------------------------------------------------
// Sandbox runtime detectors — one per runtime, kept small and side-effect-free.
// ---------------------------------------------------------------------------

/**
 * gVisor reports kernel string `4.19.0-gvisor` (current) or `4.4.0` (legacy
 * Sentry kernel).
 *
 * `4.19.0-gvisor` is unambiguous — no real Linux box reports that string.
 * `4.4.0` collides with Ubuntu 16.04 LTS / older real kernels, so we only
 * accept it as a gVisor signal when /proc/version ALSO contains "gVisor".
 */
function isGVisor(): boolean {
  const kernel = release();
  if (kernel.includes("gvisor")) return true;
  if (platform() !== "linux") return false;
  try {
    const procVersion = readFileSync("/proc/version", "utf-8");
    return procVersion.includes("gVisor");
  } catch {
    return false;
  }
}

function isDocker(): boolean {
  if (existsSync("/.dockerenv")) return true;
  if (platform() !== "linux") return false;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

/**
 * AWS Firecracker microVMs expose /dev/vsock and report sys_vendor='Amazon EC2'
 * with product_name containing 'Firecracker'. Full EC2 reports a real instance
 * type like 't3.large', so the product_name check distinguishes them.
 */
function isFirecracker(): boolean {
  if (platform() !== "linux") return false;
  if (!existsSync("/dev/vsock")) return false;
  try {
    const sysVendor = readFileSync("/sys/class/dmi/id/sys_vendor", "utf-8").trim();
    if (sysVendor !== "Amazon EC2") return false;
    const productName = readFileSync("/sys/class/dmi/id/product_name", "utf-8").trim();
    return productName.toLowerCase().includes("firecracker");
  } catch {
    return false;
  }
}

function isKVM(): boolean {
  if (platform() !== "linux") return false;
  try {
    const sysVendor = readFileSync("/sys/class/dmi/id/sys_vendor", "utf-8").trim();
    return sysVendor === "QEMU" || sysVendor.includes("KVM");
  } catch {
    return false;
  }
}

/**
 * Gemini managed-agent sandbox — Google's Managed Agents runtime (the
 * Antigravity base agent). The platform auto-discovers the agent definition
 * under `/.agents/` and runs it inside a gVisor kernel.
 *
 * Signal hierarchy (the two checks are NOT co-equal):
 *   - `/.agents/` is the *uniqueness anchor*: the platform's agent-definition
 *     mount root. Per Google's Managed Agents docs the runtime scans `/.agents/`
 *     for the agent's instructions (`/.agents/AGENTS.md`) and skills
 *     (`/.agents/skills/<name>/SKILL.md`). Nothing in the generic
 *     Google-Cloud-on-gVisor universe (Cloud Run gen2, GKE Sandbox, Fly.io)
 *     mounts `/.agents/` at the filesystem root.
 *
 *     We key on the `/.agents/` DIRECTORY, not `/.agents/AGENTS.md`: AGENTS.md
 *     is OPTIONAL. Google's docs state "AGENTS.md is optional ... the
 *     system_instruction and AGENTS.md are additive; both apply when present",
 *     so an agent may declare its instructions inline via `system_instruction`
 *     in agent.yaml and ship no AGENTS.md file. Keying on the file would
 *     silently miss every managed agent that uses inline instructions or a
 *     skills-only definition; the directory mount generalizes across all
 *     managed agents that ship any definition.
 *   - `isGVisor()` is a *guard*, not a co-uniqueness signal. gVisor itself
 *     is shared with GKE Sandbox + Cloud Run gen2 — it does not discriminate
 *     the managed-agent surface from those. Its job here is to rule out the
 *     unlikely case of a human creating `/.agents/` on a non-sandbox host.
 *
 * Known coverage gap: an agent defined with ONLY inline `system_instruction`
 * (no skills, no AGENTS.md) may not materialize a `/.agents/` mount — that
 * tail can't be closed from the docs and needs an empirical spin to confirm.
 * The common case (skills and/or AGENTS.md present) is covered.
 *
 * Things deliberately NOT keyed on (each fails the uniqueness test —
 * shared across the broader Google-Cloud-on-gVisor universe or trivially
 * user-settable on any host):
 *   - gVisor alone
 *   - `Google Compute Engine` DMI (entire GCP reports this)
 *   - `job` cgroup (Google-internal but broadly present)
 *   - egress-proxy env / CA-cert env cluster (any MITM container sets these)
 *   - `/workspace/` (the agent's data mount — generic, not unique)
 *   - `GEMINI_API_KEY` (user-settable on any host)
 *
 * Source: Google Managed Agents docs (ai.google.dev/gemini-api/docs/custom-agents
 * + managed-agents-quickstart) for the `/.agents/` mount contract and AGENTS.md
 * optionality; empirical introspection of live managed-agent sandboxes by
 * gemini-agent (2026-06-09) for the gVisor pairing — present across 3
 * independent fresh sandbox spins (spike + `b9db4e56` + `d59d6361`).
 */
function isGeminiManagedAgent(): boolean {
  if (platform() !== "linux") return false;
  // The uniqueness anchor: the managed-agent definition mount root. We key on
  // the `/.agents/` directory (not the optional AGENTS.md file) so skills-only
  // and inline-instruction agents are still detected. Nothing else on gVisor
  // (Cloud Run, GKE Sandbox, Fly.io) creates this path. Require an actual
  // directory — a stray file or symlink named `/.agents` must not match.
  try {
    if (!statSync("/.agents").isDirectory()) return false;
  } catch {
    return false; // ENOENT / EACCES — no mount, not a managed agent.
  }
  // The guard: rule out a stray user-created `/.agents/` on a non-sandbox
  // host. Not a second uniqueness signal — gVisor isn't unique on its own.
  return isGVisor();
}
