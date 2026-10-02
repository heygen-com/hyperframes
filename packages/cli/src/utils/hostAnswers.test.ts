import { createSocket, type Socket } from "node:dgram";
import { afterEach, describe, expect, it, vi } from "vitest";

// Point every Resolver hostAnswers creates at a local UDP server this test controls.
const dnsServer = vi.hoisted(() => ({ address: "" }));
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  class Resolver extends real.promises.Resolver {
    constructor(options?: ConstructorParameters<typeof real.promises.Resolver>[0]) {
      super(options);
      this.setServers([dnsServer.address]);
    }
  }
  return { ...real, promises: { ...real.promises, Resolver } };
});

let socket: Socket | undefined;

/** A DNS server: "silent" never replies, "answer" answers A with 127.0.0.1, "no-aaaa" answers A and drops AAAA. */
async function startServer(mode: "silent" | "answer" | "no-aaaa"): Promise<void> {
  socket = createSocket("udp4");
  socket.on("message", (msg, peer) => {
    if (mode === "silent") return;
    let end = 12;
    while (msg[end] !== 0) end += (msg[end] ?? 0) + 1;
    end += 5;
    const isA = msg.readUInt16BE(end - 4) === 1;
    if (mode === "no-aaaa" && !isA) return;
    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(isA ? 1 : 0, 6);
    const record = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
    socket?.send(
      Buffer.concat([header, msg.subarray(12, end), ...(isA ? [record] : [])]),
      peer.port,
      peer.address,
    );
  });
  await new Promise<void>((resolve) => socket?.bind(0, "127.0.0.1", resolve));
  dnsServer.address = `127.0.0.1:${socket.address().port}`;
}

describe("hostAnswers", () => {
  afterEach(() => {
    socket?.close();
    socket = undefined;
  });

  it("says no, within its short timeout, when DNS never replies", async () => {
    await startServer("silent");
    const { hostAnswers } = await import("./hostAnswers.js");
    const started = Date.now();
    expect(await hostAnswers("registry.npmjs.org")).toBe(false);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it("says yes when DNS answers", async () => {
    await startServer("answer");
    const { hostAnswers } = await import("./hostAnswers.js");
    expect(await hostAnswers("registry.npmjs.org")).toBe(true);
  });
  it("says yes without asking DNS when fetch goes through an env proxy", async () => {
    await startServer("silent");
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    try {
      const { hostAnswers } = await import("./hostAnswers.js");
      expect(await hostAnswers("registry.npmjs.org")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("says no when A answers but AAAA never does, since the system lookup waits for both", async () => {
    await startServer("no-aaaa");
    const { hostAnswers } = await import("./hostAnswers.js");
    expect(await hostAnswers("registry.npmjs.org")).toBe(false);
  });
});
