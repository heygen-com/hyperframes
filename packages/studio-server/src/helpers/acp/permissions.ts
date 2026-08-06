import {
  permissionOptionSchema,
  type PermissionOption,
  type PermissionRequest,
} from "../agentSchemas.js";

/**
 * Reading an agent's `session/request_permission`.
 *
 * The native transport has no equivalent: a CLI decides on its own whether it
 * may write, and Studio finds out afterwards by looking at the file. Over ACP
 * the agent asks, which is the whole reason for this transport — but it means
 * the question and its answers arrive from the agent process, so they are
 * parsed rather than trusted.
 */

/**
 * What the agent is asking about, or null when the request is unreadable.
 *
 * An unreadable request is not a run to guess at. Answering a question we could
 * not parse would be Studio telling the agent the user said yes to something
 * nobody was shown.
 */
export function readPermissionRequest(
  params: unknown,
  /**
   * Titles the agent has already given its tool calls. Real agents ask about a
   * call by id and put the title only in the `tool_call` update that announced
   * it, so without this the user is asked to approve "exec-282be8b3-…".
   */
  titleFor: (toolCallId: string) => string | undefined = () => undefined,
): PermissionRequest | null {
  if (!isRecord(params)) return null;

  const options = readOptions(params.options);
  if (options.length === 0) return null;

  return { tool: readTool(params.toolCall, titleFor), options };
}

/** The agent's own words for the call, in order of how much they say. */
function readTool(toolCall: unknown, titleFor: (id: string) => string | undefined): string {
  if (!isRecord(toolCall)) return "a tool";
  const id = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : null;
  // The id itself is last: it identifies the call without describing it, and a
  // user cannot decide anything from a uuid.
  for (const field of [toolCall.title, id ? titleFor(id) : null, toolCall.kind, id]) {
    if (typeof field === "string" && field.trim()) return field.trim().slice(0, 200);
  }
  return "a tool";
}

function readOptions(value: unknown): PermissionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    const parsed = permissionOptionSchema.safeParse(option);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The option that means no, when the agent offered one.
 *
 * A wait that runs out has to answer somehow, and declining is the only answer
 * that cannot do something the user never agreed to. `reject_once` is preferred
 * over `reject_always`: refusing this one call is a smaller decision to make on
 * someone's behalf than refusing every call like it from now on.
 */
export function refusalOption(request: PermissionRequest): PermissionOption | null {
  return (
    request.options.find((option) => option.kind === "reject_once") ??
    request.options.find((option) => option.kind === "reject_always") ??
    null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
