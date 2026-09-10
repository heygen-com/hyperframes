// @vitest-environment jsdom
/**
 * Drives a write tool through the REAL `@mcp-b/global` package rather than a
 * fake `document.modelContext`.
 *
 * The package invokes a registered `execute` with the input alone, from its
 * in-page `BrowserMcpServer` wrapper and from the descriptor it mirrors into a
 * native model context. A Studio handler that destructured `{ signal }` from
 * the missing second argument threw before it ran, so every write tool failed
 * with "Cannot destructure property 'signal' of 'undefined'" while the read
 * tools kept working. This file is what proves the fix against the code that
 * actually ships in the polyfill chunk; `useStudioAgentTools.test.tsx` covers
 * the spec-shaped call and the abort path, which the polyfill cannot exercise
 * because it drops the caller's signal before it reaches the handler.
 *
 * Its own file because the package defines `document.modelContext` as an import
 * side effect that the sibling suite's fake would otherwise have to fight.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { mintElementHandle } from "./handles";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import { previewDoc, selectionFor, studioAgentToolsDeps } from "./webmcpTestUtils";

vi.mock("../telemetry/client", () => ({ trackEvent: vi.fn() }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The polyfill's registry entry, as the reporter of the bug drove it. */
interface PolyfillToolEntry {
  item: { name: string };
  execute: (input: object, signal?: AbortSignal) => Promise<unknown>;
}

interface PolyfillModelContext {
  tools: Map<string, PolyfillToolEntry>;
  getTools(): Promise<Array<{ name: string }>>;
  executeTool(
    tool: { name: string },
    inputArguments: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

let cleanup: (() => void) | null = null;

afterEach(async () => {
  cleanup?.();
  cleanup = null;
  // The polyfill watches the document with a MutationObserver that reads jsdom
  // globals. Empty the document and let the observer settle now, while those
  // globals still exist, instead of when vitest closes the window.
  document.body.replaceChildren();
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.localStorage.clear();
});

function mountTools(deps: StudioAgentToolsDeps): void {
  function Probe() {
    useStudioAgentTools(deps);
    return null;
  }
  const root = mountReactHarness(<Probe />);
  cleanup = () => act(() => root.unmount());
}

/** Registration runs after a dynamic import, so wait for the full tool set. */
async function polyfillModelContext(expectedTools: number): Promise<PolyfillModelContext> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const candidate = Reflect.get(document, "modelContext") as PolyfillModelContext | undefined;
    if (candidate && candidate.tools.size >= expectedTools) return candidate;
    if (Date.now() > deadline) {
      throw new Error(`expected ${expectedTools} tools, saw ${candidate?.tools.size ?? "none"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function entryNamed(modelContext: PolyfillModelContext, name: string): PolyfillToolEntry {
  const entry = [...modelContext.tools.values()].find((candidate) => candidate.item.name === name);
  if (!entry) throw new Error(`expected ${name} in the polyfill registry`);
  return entry;
}

describe("useStudioAgentTools with the @mcp-b/global polyfill", () => {
  it("saves through studio_set_text when the polyfill calls execute with the input alone", async () => {
    const doc = previewDoc('<h1 id="agent">Agent</h1>');
    const agent = doc.getElementById("agent") as HTMLElement;
    const handle = mintElementHandle({
      projectId: "demo",
      domId: "agent",
      sourceFile: "index.html",
      activeCompositionPath: "index.html",
    });
    if (!handle) throw new Error("expected agent handle");
    const setText = vi.fn(
      async () =>
        ({
          ok: true,
          persistence: { sourceFile: "index.html", version: '"sha256:after"', changed: true },
        }) as const,
    );

    await act(async () => {
      mountTools(
        studioAgentToolsDeps({
          getPreviewDocument: () => doc,
          buildSelection: async (element) => selectionFor(element),
          setText,
        }),
      );
    });
    const modelContext = await polyfillModelContext(12);

    // Registry entry, as `[...document.modelContext.tools.values()]` exposes it.
    const viaEntry = await entryNamed(modelContext, "studio_set_text").execute(
      { handle, text: "Through the polyfill" },
      new AbortController().signal,
    );
    expect(viaEntry).toMatchObject({ ok: true, stage: "saved", changed: true });

    // Chromium's `executeTool` extension, which the polyfill also implements.
    const descriptor = (await modelContext.getTools()).find(
      (tool) => tool.name === "studio_set_text",
    );
    if (!descriptor) throw new Error("expected studio_set_text in getTools()");
    const viaExecuteTool = await modelContext.executeTool(
      descriptor,
      JSON.stringify({ handle, text: "Through executeTool" }),
      { signal: new AbortController().signal },
    );
    expect(JSON.parse(viaExecuteTool ?? "null")).toMatchObject({ ok: true, stage: "saved" });

    expect(setText).toHaveBeenCalledTimes(2);
    expect(setText).toHaveBeenCalledWith(
      expect.objectContaining({ element: agent }),
      "Through the polyfill",
      "self",
    );
  });
});
