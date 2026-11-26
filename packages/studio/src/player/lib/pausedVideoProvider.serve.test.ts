// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { servePausedVideoFrames } from "./pausedVideoProvider";

const handedOver = vi.hoisted(() => ({ ports: [] as MessagePort[] }));
vi.mock("./previewChannel", () => ({
  previewEditingClient: () => ({
    request: vi.fn(async (_: string, params: { channel: MessagePort }) => {
      handedOver.ports.push(params.channel);
      return { served: true };
    }),
  }),
}));

afterEach(() => {
  for (const port of handedOver.ports.splice(0)) port.close();
});

/** A same-origin preview frame whose document the test swaps, as a navigation would. */
function previewFrame() {
  const iframe = document.createElement("iframe");
  let doc: Document = document.implementation.createHTMLDocument("served");
  Object.defineProperty(iframe, "contentDocument", { get: () => doc });
  Object.defineProperty(iframe, "src", {
    value: `${location.origin}/api/projects/p1/preview/index.html`,
  });
  return {
    iframe,
    loadSameDocument: () => iframe.dispatchEvent(new Event("load")),
    loadNextDocument: () => {
      doc = document.implementation.createHTMLDocument("next");
      iframe.dispatchEvent(new Event("load"));
    },
  };
}

/** Whether Studio still answers the frame's runtime on its port. */
async function answers(port: MessagePort): Promise<boolean> {
  const reply = new Promise<boolean>((resolve) => {
    port.onmessage = () => resolve(true);
    setTimeout(() => resolve(false), 50);
  });
  port.postMessage({ type: "suspend", id: 1 });
  return reply;
}

// fails without the fix: a shadow reload served while its page loaded lost Studio's decoder at that page's own load.
it("keeps serving a frame through the load of the document it was served for", async () => {
  const frame = previewFrame();
  servePausedVideoFrames(frame.iframe);
  await vi.waitFor(() => expect(handedOver.ports).toHaveLength(1));
  const port = handedOver.ports[0]!;

  frame.loadSameDocument();
  expect(await answers(port)).toBe(true);

  frame.loadNextDocument();
  expect(await answers(port)).toBe(false);
});
