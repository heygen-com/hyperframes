import { z } from "zod";

/**
 * Every agent payload that crosses a boundary — the browser's request bodies,
 * the on-disk run log, the models.dev catalog — is declared here as a schema
 * and inferred into a type. Nothing downstream casts: a parse either yields the
 * declared shape or the caller handles the failure.
 */

export const AGENT_KINDS = ["claude", "codex", "hermes", "openclaw", "custom"] as const;
export const agentKindSchema = z.enum(AGENT_KINDS);
export type AgentKind = z.infer<typeof agentKindSchema>;

export const agentStatusSchema = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/** Where the edited element lives, so the run list can jump back to it. */
export const agentTargetRefSchema = z.object({
  sourceFile: z.string().optional(),
  id: z.string().optional(),
  selector: z.string().optional(),
  selectorIndex: z.number().finite().optional(),
  /** Playhead position when the instruction was written. */
  time: z.number().finite().optional(),
});
export type AgentTargetRef = z.infer<typeof agentTargetRefSchema>;

/**
 * A harness the user registered themselves: the same fields Studio's built-in
 * presets carry, so a custom CLI is a first-class option rather than an
 * environment variable that only one machine knows about.
 */
export const customAgentSchema = z.object({
  /** Stable id within a project, derived from the label when it is created. */
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Absolute path or URL to the harness' own mark. */
  icon: z.string().optional(),
  /** Flag this CLI takes its model on, when it accepts one (e.g. `--model`). */
  modelFlag: z.string().optional(),
});
export type CustomAgent = z.infer<typeof customAgentSchema>;

/** POST body when registering one: the id is derived, not supplied. */
export const customAgentRequestSchema = customAgentSchema.omit({ id: true });
export type CustomAgentRequest = z.infer<typeof customAgentRequestSchema>;

export const customAgentFileSchema = z.object({
  agents: z.array(customAgentSchema).default([]),
});

export const agentRunRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  instruction: z.string().optional(),
  target: z.string().optional(),
  targetRef: agentTargetRefSchema.optional(),
  /** Harness id: a built-in kind, or a custom agent's id. */
  agent: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

export const agentQueueMoveSchema = z.object({
  /** Index within the queue; 0 is next up. */
  position: z.number().finite(),
});

/** One line of `<project>/.hyperframes/agent-runs.jsonl`. */
export const loggedRunSchema = z.object({
  at: z.string(),
  kind: agentKindSchema.optional(),
  model: z.string().optional(),
  target: z.string().default("composition"),
  targetRef: agentTargetRefSchema.optional(),
  sessionId: z.string().optional(),
  instruction: z.string().min(1),
  status: agentStatusSchema.default("done"),
  seconds: z.number().finite().default(0),
  agent: z.string().default("agent"),
  /** What the harness said when it finished. */
  result: z.string().default(""),
});
export type LoggedRun = z.infer<typeof loggedRunSchema>;

/**
 * The slice of a models.dev provider entry Studio reads. Unknown keys are
 * ignored rather than rejected — the catalog grows fields on its own schedule.
 */
export const catalogModelSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  tool_call: z.boolean().optional(),
  cost: z
    .object({ input: z.number().finite().optional(), output: z.number().finite().optional() })
    .optional(),
  limit: z.object({ context: z.number().finite().optional() }).optional(),
});

export const catalogProviderSchema = z.object({
  models: z.record(z.string(), catalogModelSchema).default({}),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
