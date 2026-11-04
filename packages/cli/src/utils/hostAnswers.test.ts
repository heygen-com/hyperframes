import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestDnsServer, type TestDnsServer } from "./dnsTestServer.js";

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

let server: TestDnsServer | undefined;

async function startServer(mode: "silent" | "answer" | "no-aaaa"): Promise<void> {
  server = await startTestDnsServer(mode);
  dnsServer.address = server.address;
}

describe("hostAnswers", () => {
  afterEach(() => {
    server?.close();
    server = undefined;
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
