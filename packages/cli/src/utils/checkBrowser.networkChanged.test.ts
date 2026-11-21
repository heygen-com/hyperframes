import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { networkChangesStillFailing } from "./checkBrowser.js";

describe("networkChangesStillFailing", () => {
  it("names the cut requests whose file is still unreachable, not the ones that load again", async () => {
    const server = createServer((req, res) => {
      res.statusCode = req.url === "/gone.mp4" ? 404 : 206;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const draft = (url: string) => ({
      code: "request_failed",
      severity: "error" as const,
      message: url,
      time: 31,
      url,
      networkChanged: true,
    });
    try {
      const failing = await networkChangesStillFailing([
        draft(`${base}/clip.mp4`),
        draft(`${base}/gone.mp4`),
        { ...draft(`${base}/other.mp4`), networkChanged: false },
      ]);
      expect([...failing]).toEqual([`${base}/gone.mp4`]);
    } finally {
      server.close();
    }
    expect([...(await networkChangesStillFailing([draft(`${base}/clip.mp4`)]))]).toEqual([
      `${base}/clip.mp4`,
    ]);
  });

  it("rechecks as the page itself, so a server that wants a same-site signal answers", async () => {
    const server = createServer((req, res) => {
      res.statusCode = req.headers.referer === `${base}/` ? 206 : 403;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const url = `${base}/clip.mp4?hf-proxy=h264`;
      const failing = await networkChangesStillFailing([
        {
          code: "request_failed",
          severity: "error",
          message: url,
          time: 1,
          url,
          networkChanged: true,
        },
      ]);
      expect([...failing]).toEqual([]);
    } finally {
      server.close();
    }
  });
});
