// @vitest-environment jsdom
/**
 * Drives the write tools through the REAL `@mcp-b/global` package rather than
 * a fake `document.modelContext`.
 *
 * The package installs the W3C polyfill and wraps it in an in-page MCP server
 * that an out-of-browser agent reaches over the tab transport. This file
 * proves a write tool saves when an MCP `tools/call` drives it through that
 * chain, against the code that ships in the polyfill chunk. Its own file
 * because the import is a one-shot side effect that the sibling suite's fake
 * would otherwise have to fight.
 */
import { act } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { mintElementHandle } from "./handles";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import { previewDoc, selectionFor, studioAgentToolsDeps } from "./webmcpTestUtils";

vi.mock("../telemetry/client", () => ({ trackEvent: vi.fn() }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

interface BridgeModelContext {
  listTools(): { name: string }[];
  getTools(): Promise<{ name: string }[]>;
}

interface JsonRpcResponse {
  id: number;
  result?: { structuredContent?: unknown; content?: { type: string; text?: string }[] };
  error?: unknown;
}

let cleanup: (() => void) | null = null;

beforeAll(async () => {
  // jsdom leaves this undefined and the polyfill installs only in a secure context.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  await import("@mcp-b/global");
  expect(typeof bridge().listTools).toBe("function");
});

afterAll(async () => {
  // Close the server so its deferred tools-changed event doesn't fire after jsdom is torn down.
  const { cleanupWebModelContext } = await import("@mcp-b/global");
  cleanupWebModelContext();
  await new Promise((resolve) => setTimeout(resolve, 0));
  Reflect.deleteProperty(window, "isSecureContext");
});

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

function bridge(): BridgeModelContext {
  // Through `unknown`: importing the package brings its own `Document.modelContext`
  // typing into scope, and this file reads the bridge's non-standard surface.
  return Reflect.get(document, "modelContext") as unknown as BridgeModelContext;
}

/** Registration is async, so wait for the whole tool set to land. */
async function waitForTools(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (bridge().listTools().length !== count || (await bridge().getTools()).length !== count) {
    if (Date.now() > deadline) {
      throw new Error(`expected ${count} tools, saw ${bridge().listTools().length} in the bridge`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Mount Studio's tools against a preview whose `#agent` element can be edited. */
async function mountEditableAgent() {
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
  const deps: StudioAgentToolsDeps = studioAgentToolsDeps({
    getPreviewDocument: () => doc,
    buildSelection: async (element) => selectionFor(element),
    setText,
  });

  function Probe() {
    useStudioAgentTools(deps);
    return null;
  }
  await act(async () => {
    const root = mountReactHarness(<Probe />);
    cleanup = () => act(() => root.unmount());
  });
  await waitForTools(12);
  return { agent, handle, setText };
}

/** Post one JSON-RPC message to the in-page server the way the tab client does. */
function postToServer(payload: object): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: "mcp-default", type: "mcp", direction: "client-to-server", payload },
      origin: window.location.origin,
      source: window,
    }),
  );
}

/** The server answers through `window.postMessage`; wait for the reply to `id`. */
async function replyTo(sent: MockInstance, id: number): Promise<JsonRpcResponse> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    for (const [message] of sent.mock.calls) {
      const payload = (message as { payload?: unknown } | undefined)?.payload;
      if (typeof payload === "object" && payload !== null && Reflect.get(payload, "id") === id) {
        return payload as JsonRpcResponse;
      }
    }
    if (Date.now() > deadline) throw new Error(`no MCP reply to request ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("useStudioAgentTools through @mcp-b/global", () => {
  it("saves through studio_set_text when an MCP client calls it", async () => {
    const { agent, handle, setText } = await mountEditableAgent();
    const sent = vi.spyOn(window, "postMessage");

    postToServer({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "studio-test", version: "1.0.0" },
      },
    });
    expect((await replyTo(sent, 1)).error).toBeUndefined();
    postToServer({ jsonrpc: "2.0", method: "notifications/initialized" });

    postToServer({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "studio_set_text", arguments: { handle, text: "Through MCP" } },
    });
    const reply = await replyTo(sent, 2);
    sent.mockRestore();

    const text = reply.result?.content?.[0]?.text;
    const result = reply.result?.structuredContent ?? JSON.parse(text ?? "null");
    expect(result).toMatchObject({ ok: true, stage: "saved", changed: true });
    expect(setText).toHaveBeenCalledWith(
      expect.objectContaining({ element: agent }),
      "Through MCP",
      "self",
    );
  });
});
