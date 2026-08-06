import type { ChildProcess } from "node:child_process";
import { withAcpAgent } from "./connection.js";
import { readAcpUpdate, type AcpUpdate } from "./updates.js";

/**
 * One edit, run as an ACP session.
 *
 * The native transport learns what happened by reading whatever the CLI prints.
 * Here the agent says it: a session is opened, the prompt is sent, and the turn
 * ends with a stop reason rather than an exit code that has to be interpreted.
 *
 * This module stays out of the job's business. It reports what the agent said
 * and why the turn ended; deciding what that means for a run — its status, its
 * overlay, its log line — belongs to the queue, which already owns those rules
 * for every other harness.
 */

export interface AcpRunHooks {
  /** The process, so a run in flight can still be stopped the usual way. */
  onSpawn?: (child: ChildProcess) => void;
  /** The session's own id, no scraping required. */
  onSessionId?: (sessionId: string) => void;
  onUpdate?: (update: AcpUpdate) => void;
}

export interface AcpRunOutcome {
  /** Why the turn ended: `end_turn`, `cancelled`, `refusal`, and so on. */
  stopReason: string;
  /** Everything the agent said this turn, as it said it. */
  said: string;
}

export async function runAcpSession(opts: {
  command: string;
  args: readonly string[];
  cwd: string;
  prompt: string;
  hooks?: AcpRunHooks;
}): Promise<AcpRunOutcome> {
  const hooks = opts.hooks ?? {};
  let said = "";

  return withAcpAgent(
    { command: opts.command, args: opts.args, cwd: opts.cwd, onSpawn: hooks.onSpawn },
    {
      onUpdate: (params) => {
        const update = readAcpUpdate(params);
        if (!update) return;
        if (update.message) said += update.message;
        hooks.onUpdate?.(update);
      },
    },
    async ({ context }) => {
      const session = await context.request("session/new", {
        cwd: opts.cwd,
        // Studio brings no MCP servers of its own; the agent keeps whatever its
        // own configuration gives it.
        mcpServers: [],
      });
      const sessionId = readSessionId(session);
      if (!sessionId) throw new Error(`${opts.command} opened a session without an id`);
      hooks.onSessionId?.(sessionId);

      const turn = await context.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: opts.prompt }],
      });

      return { stopReason: readStopReason(turn), said };
    },
  );
}

function readSessionId(result: unknown): string | null {
  const value = (result ?? {}) as { sessionId?: unknown };
  return typeof value.sessionId === "string" ? value.sessionId : null;
}

/**
 * An agent that ends its turn without saying why has ended it normally: the
 * alternative is failing a run that in fact finished.
 */
function readStopReason(result: unknown): string {
  const value = (result ?? {}) as { stopReason?: unknown };
  return typeof value.stopReason === "string" ? value.stopReason : "end_turn";
}
