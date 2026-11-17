import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "./captureCompositionFrame.js";

// A host service the composition page must not reach when the caller restricts the page network.
const hostHits: string[] = [];
let hostService: Server;
let hostPort: number;
let pageServer: Server;
let pageUrl: string;
const previous = process.env.PRODUCER_RESTRICT_PAGE_NETWORK;

function privateIpv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
}

function html(hosts: string[]): string {
  return `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-width="320" data-height="180" data-duration="1"></div>
<script>
  const read = (url) => fetch(url).then((response) => response.text(), () => "refused");
  const load = (url) => new Promise((done) => {
    const image = new Image();
    image.onload = () => done("loaded");
    image.onerror = () => done("refused");
    image.src = url;
  });
  window.__probe = Promise.all([
    read("/own.txt"),
    ...${JSON.stringify(hosts)}.flatMap((host) => [
      read("http://" + host + ":${hostPort}/fetch"),
      load("http://" + host + ":${hostPort}/img"),
    ]),
  ]);
  window.__renderReady = true;
</script></body></html>`;
}

beforeAll(async () => {
  hostService = createServer((req, res) => {
    hostHits.push(`${req.socket.localAddress} ${req.url}`);
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end("host service");
  });
  await new Promise<void>((resolve) => hostService.listen(0, "0.0.0.0", resolve));
  hostPort = (hostService.address() as AddressInfo).port;
  pageServer = createServer((req, res) => {
    if (req.url === "/own.txt") return void res.end("own asset");
    const hosts = ["127.0.0.1", privateIpv4()].filter((host): host is string => Boolean(host));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html(hosts));
  });
  await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;
});

afterEach(() => {
  if (previous === undefined) delete process.env.PRODUCER_RESTRICT_PAGE_NETWORK;
  else process.env.PRODUCER_RESTRICT_PAGE_NETWORK = previous;
});

afterAll(() => {
  for (const server of [hostService, pageServer]) {
    server.closeAllConnections();
    server.close();
  }
});

// fails without the fix: with PRODUCER_RESTRICT_PAGE_NETWORK=true, the page check, snapshot and compare open
// still fetched and loaded images from loopback and the private IP, and the host service saw every request.
it("keeps a composition page off loopback and private hosts when the page network is restricted", async () => {
  process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
  hostHits.length = 0;
  const { browser, page } = await openSettledCompositionPage(
    await (await fetch(pageUrl)).text(),
    pageUrl,
    { renderReadyTimeoutMs: 5_000, renderReadyWarningSuffix: "test", browserGpuMode: "software" },
  );
  try {
    const [own, ...others] = await page.evaluate(
      () => (window as unknown as { __probe: Promise<string[]> }).__probe,
    );
    expect(own).toBe("own asset");
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(others).toEqual(others.map(() => "refused"));
    expect(hostHits).toEqual([]);
  } finally {
    await browser.close();
  }
}, 90_000);
