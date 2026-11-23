import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { isBrowserSafePort, listenOnBrowserSafePort } from "./browserSafePort.js";

class OfferedPorts extends EventEmitter {
  bound = 0;
  closed = 0;
  constructor(private offers: number[]) {
    super();
  }
  listen(_port: number, _host: string, done: () => void) {
    this.bound = this.offers.shift() as number;
    queueMicrotask(done);
    return this;
  }
  address() {
    return { port: this.bound };
  }
  close(done: () => void) {
    this.closed++;
    queueMicrotask(done);
    return this;
  }
}

describe("listenOnBrowserSafePort", () => {
  it("rebinds past a port Chromium blocks", async () => {
    const server = new OfferedPorts([4045, 6000, 40000]);
    const port = await listenOnBrowserSafePort(server as never, "127.0.0.1");
    expect(port).toBe(40000);
    expect(server.closed).toBe(2);
  });

  it("gives up when the OS only offers blocked ports", async () => {
    const server = new OfferedPorts(Array(40).fill(4045));
    await expect(listenOnBrowserSafePort(server as never, "127.0.0.1")).rejects.toThrow(
      /restricted/,
    );
  });

  it("binds a real server on a safe port", async () => {
    const server = createServer();
    const port = await listenOnBrowserSafePort(server, "127.0.0.1");
    expect(isBrowserSafePort(port)).toBe(true);
    await new Promise((resolve) => server.close(resolve));
  });
});
