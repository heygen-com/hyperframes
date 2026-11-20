import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "node:http";
import { _publicOnlyNetworkForTests } from "./browserManager.js";

const { resolveAddress } = vi.hoisted(() => ({ resolveAddress: vi.fn() }));
vi.mock("./publicNetwork/publicNetwork.js", async (actual) => ({
  ...(await actual<typeof import("./publicNetwork/publicNetwork.js")>()),
  resolvePublicAddress: resolveAddress,
}));

describe("render page network", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    resolveAddress.mockReset();
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  it("tunnels page traffic to the egress proxy named by HYPERFRAMES_CAPTURE_PROXY", async () => {
    resolveAddress.mockRejectedValue(new Error("dialled directly"));
    const tunnels: string[] = [];
    const upstream = createServer();
    upstream.on("connect", (req, socket) => {
      tunnels.push(req.url ?? "");
      socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    vi.stubEnv(
      "HYPERFRAMES_CAPTURE_PROXY",
      `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
    );

    const network = await _publicOnlyNetworkForTests("127.0.0.1:4321");
    try {
      const proxyUrl = network.args
        .find((a) => a.startsWith("--proxy-server="))!
        .slice("--proxy-server=".length);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(proxyUrl, { method: "CONNECT", path: "example.com:443" });
        req.on("connect", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode!);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(200);
      expect(tunnels).toEqual(["example.com:443"]);
      expect(resolveAddress).not.toHaveBeenCalled();
    } finally {
      await network.close();
    }
  });
});
