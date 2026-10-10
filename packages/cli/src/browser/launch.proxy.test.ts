import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { acquireBrowser, type BrowserLease } from "@hyperframes/engine";
import { launchManagedBrowser } from "./launch.js";
import { ensureBrowser } from "./manager.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("native browser proxy routing", () => {
  it("refuses credentials from an explicit launch environment before starting Chrome", async () => {
    await expect(
      launchManagedBrowser(puppeteer, { env: { HTTPS_PROXY: "http://user:password@proxy.test" } }),
    ).rejects.toThrow("HTTPS_PROXY contains proxy credentials.");
  });

  it.each(["cli", "engine"] as const)(
    "%s launch routes external fetches through the proxy and bypasses loopback",
    async (owner) => {
      const requests: string[] = [];
      const connections: string[] = [];
      const proxy = createServer((request, response) => {
        requests.push(request.url ?? "");
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain",
        });
        response.end("local-proxy-witness");
      });
      proxy.on("connect", (request, socket) => {
        connections.push(request.url ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      });
      const fileServer = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<!doctype html><title>loopback-witness</title>");
      });
      let browser: Browser | undefined;
      let lease: BrowserLease | undefined;
      try {
        const proxyPort = await listen(proxy);
        const filePort = await listen(fileServer);
        vi.stubEnv("http_proxy", `http://127.0.0.1:${proxyPort}`);
        vi.stubEnv("https_proxy", `http://127.0.0.1:${proxyPort}`);
        vi.stubEnv("all_proxy", "");
        vi.stubEnv("no_proxy", "");
        const { executablePath } = await ensureBrowser();
        const args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"];
        if (owner === "cli") {
          browser = await launchManagedBrowser(puppeteer, { executablePath, args, headless: true });
        } else {
          lease = await acquireBrowser(args, {
            chromePath: executablePath,
            enableBrowserPool: false,
            forceScreenshot: true,
          });
          browser = lease.browser;
        }
        expect(browser.process()?.spawnargs).toContain(
          `--proxy-server=http=http://127.0.0.1:${proxyPort};https=http://127.0.0.1:${proxyPort}`,
        );
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${filePort}/`);
        expect(await page.title()).toBe("loopback-witness");
        expect(
          await page.evaluate(async () => {
            const response = await fetch("http://render-network-probe.invalid/probe", {
              signal: AbortSignal.timeout(5_000),
            });
            return response.text();
          }),
        ).toBe("local-proxy-witness");
        expect(requests).toContain("http://render-network-probe.invalid/probe");
        expect(requests.some((url) => url.includes(`127.0.0.1:${filePort}`))).toBe(false);
        const denied = await page.evaluate(async () => {
          try {
            await fetch("https://render-network-probe.invalid/probe", {
              signal: AbortSignal.timeout(5_000),
            });
            return false;
          } catch {
            return true;
          }
        });
        expect(denied).toBe(true);
        expect(connections).toContain("render-network-probe.invalid:443");
      } finally {
        if (lease) await lease.release();
        else await browser?.close();
        if (fileServer.listening) await close(fileServer);
        if (proxy.listening) await close(proxy);
      }
    },
    60_000,
  );
});
