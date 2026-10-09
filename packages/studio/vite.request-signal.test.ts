import { createServer, get } from "node:http";
import { describe, expect, it } from "vitest";
import { bindNodeRequestSignal } from "./vite.request-signal";

// A real connection is required: completing a request body is not a disconnect.
describe("Studio dev request cancellation", () => {
  it("aborts a held response when its client disconnects", async () => {
    let received!: () => void;
    let disconnected!: () => void;
    const ready = new Promise<void>((resolve) => {
      received = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    let signal: AbortSignal | undefined;
    const server = createServer((_, response) => {
      const request = bindNodeRequestSignal(response);
      signal = request.signal;
      signal.addEventListener(
        "abort",
        () => {
          request.dispose();
          disconnected();
        },
        { once: true },
      );
      received();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    const client = get(`http://127.0.0.1:${address.port}/thumbnail`);
    client.on("error", (error) => expect(error).toMatchObject({ code: "ECONNRESET" }));
    try {
      await ready;
      expect(signal?.aborted).toBe(false);
      client.destroy();
      await closed;
      expect(signal?.aborted).toBe(true);
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not abort completed work after its listener is disposed", async () => {
    let signal: AbortSignal | undefined;
    const server = createServer((_, response) => {
      const request = bindNodeRequestSignal(response);
      signal = request.signal;
      response.end("complete");
      request.dispose();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/thumbnail`);
      expect(await response.text()).toBe("complete");
      expect(signal?.aborted).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
