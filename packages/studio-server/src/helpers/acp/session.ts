import type { ChildProcess } from "node:child_process";
import { withAcpAgent } from "./connection.js";
import { acpModelId } from "./models.js";
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
  /**
   * Handed the two things that can be done to a turn already in flight. ACP has
   * no way to speak into an open turn, so a correction ends this one and starts
   * another on the same session — which keeps everything the agent has read.
   */
  onControls?: (controls: { steer: (text: string) => void; cancel: () => void }) => void;
  /** The turn has restarted on the correction, so the run is moving again. */
  onSteered?: () => void;
  /**
   * The agent asking before it acts. Left out, the agent's own default applies
   * and Studio never hears the question.
   */
  onPermission?: (params: Record<string, unknown>) => Promise<{ optionId: string }>;
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
  /** The model this run was asked for, when Studio picked one. */
  model?: string;
  /** Reasoning level, which this protocol carries inside the model id. */
  effort?: string;
  hooks?: AcpRunHooks;
}): Promise<AcpRunOutcome> {
  const hooks = opts.hooks ?? {};
  let said = "";

  return withAcpAgent(
    { command: opts.command, args: opts.args, cwd: opts.cwd, onSpawn: hooks.onSpawn },
    {
      onPermission: hooks.onPermission,
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
      // Registered before anything else can be awaited: from the moment there
      // is a session, stopping it has to be possible.
      // A correction arrives as "cancel this turn, then ask again": the loop is
      // what turns those two protocol calls into one continuous run.
      let correction: string | null = null;
      const stop = () => {
        void context.request("session/cancel", { sessionId }).catch(() => undefined);
      };
      hooks.onControls?.({
        steer: (text) => {
          correction = text;
          stop();
        },
        cancel: stop,
      });

      const modelId = acpModelId(opts.model, opts.effort);
      // Best effort: an agent that does not take this model is better off
      // running on its own default than not running at all, and the model it
      // actually used is the agent's to report.
      if (modelId) {
        await context.request("session/set_model", { sessionId, modelId }).catch(() => undefined);
      }

      let text = opts.prompt;
      for (;;) {
        const turn = await context.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text }],
        });
        const stopReason = readStopReason(turn);
        // Only a correction restarts. A plain cancel, or a turn that ended on
        // its own terms, is the end of the run.
        if (!correction) return { stopReason, said };

        text = correction;
        correction = null;
        hooks.onSteered?.();
      }
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
