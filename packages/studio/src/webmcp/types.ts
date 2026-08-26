/**
 * Local typings for the WebMCP browser API, which is not in lib.dom yet.
 *
 * Mirrors the WebIDL in the W3C spec (`webmachinelearning/webmcp`, `index.bs`)
 * as of 2026-08-26. Two things worth knowing before editing this file:
 *
 * - The API hangs off `document`, NOT `navigator`. `navigator.modelContext` is
 *   a polyfill compatibility shim, not a spec member, so feature-detecting it
 *   is wrong even where an article's sample "works".
 * - The spec is pre-stable (Origin Trial). This file and `registrar.ts` are the
 *   only places that touch the API, so a spec change is a two-file edit. Re-read
 *   `index.bs` rather than trusting this transcription.
 *
 * Only the surface Studio actually uses is declared. `getTools` and
 * `executeTool` are the consumer side; Studio registers, it does not call.
 */

export interface ModelContextToolAnnotations {
  /** The tool does not change state. Lets an agent decide when calling is free. */
  readOnlyHint?: boolean;
  /** The tool's output contains data the page's author does not vouch for. */
  untrustedContentHint?: boolean;
}

export interface ToolExecuteCallbackOptions {
  /**
   * Aborted when the caller cancels. Note that Studio's commit path is not
   * cancellable once dispatched, so tools check this BEFORE dispatching and
   * document that a late abort does not unwind a write.
   */
  signal: AbortSignal;
}

export interface ModelContextTool {
  /**
   * Max 128 characters, ASCII alphanumeric plus `_`, `-`, `.`. Registering a
   * name that already exists REJECTS with InvalidStateError; it does not
   * replace.
   */
  name: string;
  title?: string;
  /** Required and non-empty; an empty string rejects with InvalidStateError. */
  description: string;
  /** JSON Schema. Nothing in the platform validates input against it. */
  inputSchema?: object;
  /**
   * The user agent JSON-serializes whatever this resolves with, so it must
   * return an object. Returning `undefined` fails the serialization.
   *
   * A rejection is NOT a usable error channel: the spec discards the reason and
   * rejects the caller with a bare UnknownError. Resolve with a tagged failure
   * instead. See `toolResult.ts`.
   */
  execute: (input: object, options: ToolExecuteCallbackOptions) => Promise<unknown>;
  annotations?: ModelContextToolAnnotations;
}

export interface ModelContextRegisterToolOptions {
  exposedTo?: string[];
  /** Aborting unregisters the tool. It does not cancel a running `execute`. */
  signal?: AbortSignal;
}

export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
}

interface DocumentWithModelContext extends Document {
  modelContext?: ModelContext;
}

/** The live WebMCP entry point, or null when this browser has not shipped it. */
export function getModelContext(doc: Document = document): ModelContext | null {
  const candidate = (doc as DocumentWithModelContext).modelContext;
  return typeof candidate?.registerTool === "function" ? candidate : null;
}
