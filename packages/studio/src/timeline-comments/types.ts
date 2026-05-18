import type { TimelineElement } from "../player/store/playerStore";

export interface TimelineComment {
  id: string;
  status: "open";
  filePath: string;
  rangeStart: number;
  rangeEnd: number;
  target?: string;
  prompt: string;
  elements: TimelineElement[];
}

export interface SendPromptToAgentInput {
  rangeStart: number;
  rangeEnd: number;
  elements: TimelineElement[];
  prompt: string;
}

export interface AgentAdapterInfo {
  kind: string;
  detected: boolean;
}

export interface AgentRunPreview {
  ready: boolean;
  agent: string | null;
  path: string | null;
  reason?: string;
  adapters?: AgentAdapterInfo[];
}

export type AgentCommentStatusMap = Record<
  string,
  {
    status: "running" | "stopped" | "error";
    message?: string;
    agent?: string | null;
    path?: string | null;
    lastMessage?: string;
  }
>;
