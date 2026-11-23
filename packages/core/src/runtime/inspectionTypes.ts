export type Target =
  | { selector: string; within?: string }
  | { hfId: string; within?: string }
  | { ref: string };
export interface InspectRequest {
  targets: Target[];
  descendants?: boolean;
  maxBytes?: number;
  time?: number;
  snippets?: string[];
  offset?: number;
  generation?: string;
  debug?: boolean;
}
export interface ElementRef {
  ref: string;
  tag: string;
  id: string;
  hfId: string | null;
  classes: string[];
  composition: string | null;
  withinId?: string;
}
export interface RuntimeAnimation {
  stack: string | null;
  properties: string[];
  targets: ElementRef[];
  localStart: number;
  duration: number;
  attachmentStacks: string[];
}
export interface RuntimeResult {
  target: Target;
  status: "found" | "missing" | "ambiguous" | "stale-ref" | "invalid-selector";
  candidates: ElementRef[];
  animations: RuntimeAnimation[];
  elements: ElementRef[];
  css: string[];
  truncated: boolean;
}
export interface RuntimeQuery {
  targets: Target[];
  descendants: boolean;
  cssRules: { id: string; selector: string }[];
}
export interface RuntimeResponse {
  results: RuntimeResult[];
  recorded: number;
  recordLimitReached: boolean;
  hooked: boolean;
}
export interface Snippet {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  kind: string[];
  targets: number[];
  code: string;
  uniqueInFile: boolean;
}
