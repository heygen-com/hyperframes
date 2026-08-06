import { basename } from "node:path";

/**
 * Reading a `session/update` notification.
 *
 * The native transport has one of these per harness, each guessing at a private
 * event shape. ACP publishes the shape, so there is one reader, and it stays
 * deliberately dumb: it turns a notification into the two things a run has to
 * show — a line saying what is happening, and the agent's own words — and knows
 * nothing about jobs, overlays or the queue.
 */

export interface AcpUpdate {
  /** One line for the run's "what is it doing right now". */
  activity?: string;
  /** Text the agent said, to be added to the run's answer. */
  message?: string;
}

/**
 * The text out of ACP content. Chunks carry a single block and prompts carry a
 * list, so both shapes read the same way here.
 */
function readText(value: unknown): string {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("");
}

/**
 * What a tool call is doing, in the agent's own title.
 *
 * The file is appended only when the title does not already name it: agents
 * write titles like "Read composition.html" as often as they write "Read".
 */
function toolActivity(update: Record<string, unknown>): string | null {
  const title = typeof update.title === "string" ? update.title.trim() : "";
  const locations = Array.isArray(update.locations) ? update.locations : [];
  const first = locations.find(isRecord);
  const file = typeof first?.path === "string" ? basename(first.path) : null;

  if (!title) return file ?? null;
  if (!file || title.includes(file)) return title.slice(0, 90);
  return `${title} · ${file}`.slice(0, 90);
}

export function readAcpUpdate(params: unknown): AcpUpdate | null {
  if (!isRecord(params) || !isRecord(params.update)) return null;
  const update = params.update;

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const message = readText(update.content);
      return message ? { message, activity: message } : null;
    }
    // Thinking is worth showing while it happens, but it is not the answer:
    // an agent's reasoning left in the result reads as if it never concluded.
    case "agent_thought_chunk": {
      const thought = readText(update.content);
      return thought ? { activity: thought } : null;
    }
    case "tool_call":
    case "tool_call_update": {
      const activity = toolActivity(update);
      return activity ? { activity } : null;
    }
    // Plans, mode switches and command lists describe the session rather than
    // the work, and saying so would push the real activity off the row.
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
