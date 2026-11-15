// @vitest-environment jsdom
/**
 * Loads the REAL `@mcp-b/global` through Studio's loader, inside a page that is
 * framed by another site, and checks that neither of the package's message
 * transports answers anyone but Studio's own page.
 */
import { afterAll, expect, it, vi } from "vitest";

vi.mock("../telemetry/client", () => ({ trackEvent: vi.fn() }));

const framer = { postMessage: vi.fn() };
const ownParent = Object.getOwnPropertyDescriptor(window, "parent");
afterAll(() => {
  if (ownParent) Object.defineProperty(window, "parent", ownParent);
  else Reflect.deleteProperty(window, "parent");
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("answers no MCP client but Studio's own page when another site frames Studio", async () => {
  Object.defineProperty(window, "parent", { value: framer, configurable: true });
  const ownMessages = vi.spyOn(window, "postMessage");
  const { loadModelContextPolyfill } = await import("./polyfill");

  expect(await loadModelContextPolyfill()).not.toBeNull();
  await settle();
  expect(framer.postMessage).not.toHaveBeenCalled();

  ownMessages.mockClear();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        channel: "mcp-default",
        type: "mcp",
        direction: "client-to-server",
        payload: "mcp-check-ready",
      },
      origin: "https://other.example",
      source: window,
    }),
  );
  await settle();
  expect(ownMessages).not.toHaveBeenCalled();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        channel: "mcp-default",
        type: "mcp",
        direction: "client-to-server",
        payload: "mcp-check-ready",
      },
      origin: window.location.origin,
      source: window,
    }),
  );
  await settle();
  expect(ownMessages).toHaveBeenCalled();
});
