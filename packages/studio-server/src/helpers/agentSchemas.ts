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

export const agentStatusSchema = z.enum([
  "queued",
  "running",
  /** Stopped on a question the agent asked, and going nowhere until answered. */
  "awaiting-permission",
  "done",
  "failed",
  "cancelled",
]);
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
 * What the selection chrome shows while an agent works on that element.
 *
 * Studio only ever derives the four states it owns as fact: queued, working,
 * done and failed. Everything finer, the agent declares — it emits one
 * `hf:overlay {…}` line at any point during a run and this is what that line
 * has to parse into. An unrecognised state is not an error downstream: the
 * renderer falls back to the neutral working treatment.
 */
export const overlayStateSchema = z.object({
  kind: z.enum(["queued", "working", "reading", "thinking", "editing", "done", "failed"]),
  /** What the work is about, when the agent knows. Drives the finer treatments. */
  scope: z.enum(["text", "box", "motion", "content"]).optional(),
  /** One short line for the pill. Studio writes one from the tool call if absent. */
  label: z.string().trim().min(1).max(60).optional(),
  /**
   * Any CSS colour, for a harness or a team that wants its own. This lands in a
   * custom property the overlay paints from, so it is held to colour syntax: a
   * `url()` reaching out of the canvas is not a colour.
   */
  accent: z
    .string()
    .trim()
    .max(40)
    .regex(
      /^(#[0-9a-f]{3,8}|[a-z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([0-9a-z%.,/\s+-]*\))$/i,
    )
    .optional(),
  /** Which element, when it is not the run's own target. */
  target: z.object({ selector: z.string().optional(), id: z.string().optional() }).optional(),
});
export type OverlayState = z.infer<typeof overlayStateSchema>;

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
  /**
   * How Studio should talk to it. `acp` means it speaks the Agent Client
   * Protocol, which is what lets anything from the ACP registry be added here
   * and work — no parser, no preset, no release.
   */
  transport: z.enum(["native", "acp"]).optional(),
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
  /** The rest of a multi-selection: the instruction applies to these too. */
  targetRefs: z.array(agentTargetRefSchema).max(64).optional(),
  /** What the target is: one element, or a stretch of the timeline. */
  targetKind: z.enum(["element", "range"]).optional(),
  /** Harness id: a built-in kind, or a custom agent's id. */
  agent: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Reasoning effort, when the model and harness both take one. */
  effort: z.string().min(1).optional(),
});
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

/**
 * The two ways a run can be changed after it was asked for: moved in the queue,
 * or steered — a correction to what it is doing.
 */
export const agentJobPatchSchema = z
  .object({
    /** Index within the queue; 0 is next up. */
    position: z.number().finite().optional(),
    /** A correction. Applied in place while queued, by resuming while running. */
    steer: z.string().trim().min(1).max(2000).optional(),
    /** Take over now: stop whatever holds this run's element and start it. */
    promote: z.literal(true).optional(),
    /** The id of the option the user picked for a run waiting on permission. */
    answer: z.string().min(1).max(200).optional(),
  })
  .refine(
    (patch) =>
      patch.position !== undefined ||
      patch.steer !== undefined ||
      patch.promote !== undefined ||
      patch.answer !== undefined,
    { message: "position, steer, promote or answer required" },
  );

/**
 * One clip an agent says it is about to add, and where it will land.
 *
 * `track` is a `data-track-index`, the number the agent itself writes into the
 * file. It is deliberately not a timeline lane: Studio packs lanes contiguously
 * for display, so the two disagree the moment a composition has gaps, and the
 * agent has never seen a lane.
 */
export const timelineSkeletonSchema = z
  .object({
    track: z.number().int().min(0).max(999),
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
    /** One short name for the clip, shown on the skeleton. */
    label: z.string().trim().min(1).max(60).optional(),
    /** Which composition this is about, when the agent is editing more than one. */
    file: z.string().trim().min(1).max(400).optional(),
  })
  // A skeleton with no width is nothing to draw, and an inverted one is a
  // typo rather than an intention.
  .refine((clip) => clip.end > clip.start, { message: "end must be after start" });
export type TimelineSkeleton = z.infer<typeof timelineSkeletonSchema>;

/**
 * What an agent declares about the timeline: everything it is about to add.
 *
 * Entries are read one at a time so a single bad one costs its own skeleton
 * rather than the whole declaration, and an empty list is how an agent says it
 * is no longer adding anything.
 */
export const timelineDeclarationSchema = z.object({
  adding: z.array(z.unknown()).default([]),
});

/** Enough for any real composition; a runaway declaration cannot fill the timeline. */
export const MAX_TIMELINE_SKELETONS = 64;

/**
 * One thing the agent will do if allowed, in its own words.
 *
 * The label and the id are the agent's, not Studio's: inventing our own
 * wording for "allow once" versus "allow for this session" would describe a
 * choice the agent is not offering. `kind` is the protocol's, and is the only
 * part Studio reads — it is how a timeout knows which option means no.
 */
export const permissionOptionSchema = z.object({
  optionId: z.string().min(1),
  name: z.string().min(1).max(120),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]).optional(),
});
export type PermissionOption = z.infer<typeof permissionOptionSchema>;

/** What a run is waiting on the user for. */
export const permissionRequestSchema = z.object({
  /** The tool call being asked about, titled the way the agent titled it. */
  tool: z.string().min(1).max(200),
  options: z.array(permissionOptionSchema).min(1),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

/** One line of `<project>/.hyperframes/agent-runs.jsonl`. */
export const loggedRunSchema = z.object({
  at: z.string(),
  kind: agentKindSchema.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  target: z.string().default("composition"),
  targetRef: agentTargetRefSchema.optional(),
  targetRefs: z.array(agentTargetRefSchema).optional(),
  targetKind: z.enum(["element", "range"]).optional(),
  steers: z.array(z.string()).optional(),
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
  /** Generation group, e.g. every `gpt-nano` release. */
  family: z.string().optional(),
  /** ISO date; what makes one member of a family supersede another. */
  release_date: z.string().optional(),
  cost: z
    .object({ input: z.number().finite().optional(), output: z.number().finite().optional() })
    .optional(),
  limit: z.object({ context: z.number().finite().optional() }).optional(),
  reasoning_options: z
    .array(z.object({ type: z.string(), values: z.array(z.string()).optional() }))
    .optional(),
});

/**
 * What a harness answers when asked which models it can run. Only the fields
 * Studio shows are declared; the rest of the harness' payload is ignored, since
 * it belongs to the harness and changes on its schedule.
 */
export const harnessModelListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        model: z.string().optional(),
        displayName: z.string().optional(),
        hidden: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        defaultReasoningEffort: z.string().optional(),
        supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).optional(),
      }),
    )
    .default([]),
});

export type CatalogModel = z.infer<typeof catalogModelSchema>;

export const catalogProviderSchema = z.object({
  models: z.record(z.string(), catalogModelSchema).default({}),
});
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
