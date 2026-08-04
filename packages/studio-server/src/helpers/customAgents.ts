import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  customAgentFileSchema,
  type CustomAgent,
  type CustomAgentRequest,
} from "./agentSchemas.js";

/**
 * Harnesses the user registered from Studio. They live with the project rather
 * than in an env var so the choice travels with the work, and so the picker can
 * offer more than the four CLIs Studio ships presets for.
 */

const CUSTOM_AGENTS_PATH = join(".hyperframes", "agents.json");

function filePath(projectDir: string): string {
  return join(projectDir, CUSTOM_AGENTS_PATH);
}

export function listCustomAgents(projectDir: string): CustomAgent[] {
  const file = filePath(projectDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = customAgentFileSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
    return parsed.success ? parsed.data.agents : [];
  } catch {
    // A hand-edited file that no longer parses must not take the picker down.
    return [];
  }
}

/** `my agent 2` → `custom:my-agent-2`, deduped against what is already there. */
export function toCustomAgentId(label: string, taken: readonly string[]): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  let id = `custom:${slug}`;
  for (let suffix = 2; taken.includes(id); suffix++) id = `custom:${slug}-${suffix}`;
  return id;
}

export function saveCustomAgent(projectDir: string, agent: CustomAgentRequest): CustomAgent {
  const existing = listCustomAgents(projectDir);
  const saved: CustomAgent = {
    ...agent,
    id: toCustomAgentId(
      agent.label,
      existing.map((entry) => entry.id),
    ),
  };
  writeCustomAgents(projectDir, [...existing, saved]);
  return saved;
}

export function deleteCustomAgent(projectDir: string, id: string): CustomAgent[] {
  const remaining = listCustomAgents(projectDir).filter((agent) => agent.id !== id);
  writeCustomAgents(projectDir, remaining);
  return remaining;
}

function writeCustomAgents(projectDir: string, agents: CustomAgent[]): void {
  const file = filePath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ agents }, null, 2)}\n`, "utf-8");
}
