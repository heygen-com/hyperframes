import { useEffect, useRef } from "react";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { makeStudioDebugLogger } from "../utils/studioDebug";
import { registerStudioTools } from "./registrar";
import { runToolBody, type ToolResult } from "./toolResult";
import { getModelContext, type ModelContext, type ModelContextTool } from "./types";
import {
  buildStudioLook,
  STUDIO_LOOK_DESCRIPTION,
  STUDIO_LOOK_INPUT_SCHEMA,
  type StudioLook,
  type StudioLookInput,
  type StudioLookSnapshot,
} from "./tools/lookTools";

const log = makeStudioDebugLogger("webmcp");

export interface StudioAgentToolsDeps {
  /** Read Studio's current state. Called per tool invocation, never cached. */
  getSnapshot: () => StudioLookSnapshot;
}

/**
 * Build the tool list once.
 *
 * Every `execute` reads `depsRef.current` at CALL time rather than closing over
 * a snapshot, which is what lets the list be built once and still see live
 * state. That is the whole point of the ref: see the registration note below.
 */
function buildStudioTools(depsRef: { readonly current: StudioAgentToolsDeps }): ModelContextTool[] {
  return [
    {
      name: "studio_look",
      title: "Look at the composition",
      description: STUDIO_LOOK_DESCRIPTION,
      inputSchema: STUDIO_LOOK_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        // The labels, text and ids come from the user's composition, which can
        // contain anything. This is a hint to the agent, not a sanitiser.
        untrustedContentHint: true,
      },
      execute: (input): Promise<ToolResult<StudioLook>> =>
        runToolBody("studio_look", async () =>
          buildStudioLook(depsRef.current.getSnapshot(), input as StudioLookInput),
        ),
    },
  ];
}

/**
 * Register Studio's tools with the browser, exactly once per mount.
 *
 * The effect has an EMPTY dependency array on purpose, and the deps live in a
 * ref that every render refreshes. The obvious alternative — depend on the
 * handlers — re-runs on nearly every interaction, because the DomEdit actions
 * object changes identity whenever the selection or the element list does.
 * Re-running means the registration signal aborts and unregisters everything,
 * `toolchange` fires constantly so a connected agent watches the tool list
 * churn, and the spec warns that a quick unregister-then-reregister can apply
 * an old call's arguments against the new schema.
 *
 * `useStudioTestHooks` carries a comment about the same class of bug already hit
 * in this codebase, where effect teardown revoked a lease moments after it was
 * taken because writing state changed the effect's dependency identities.
 */
export function useStudioAgentTools(deps: StudioAgentToolsDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (readStudioUiPreferences().agentToolsEnabled === false) {
      log("skipped", { why: "disabled by preference" });
      return;
    }

    const modelContext: ModelContext | null = getModelContext();
    if (!modelContext) {
      // Expected on any browser that has not shipped WebMCP. Not an error.
      log("skipped", { why: "document.modelContext absent" });
      return;
    }

    const controller = new AbortController();
    void registerStudioTools(modelContext, buildStudioTools(depsRef), controller.signal).then(
      (report) => log("registered", { ...report }),
    );

    return () => controller.abort();
  }, []);
}
