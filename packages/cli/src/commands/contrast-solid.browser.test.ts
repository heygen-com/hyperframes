import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openSettledCompositionPage } from "../capture/captureCompositionFrame.js";

const P = "position:absolute;margin:0;font:28px sans-serif;color:#9ab";
const HTML = `<!doctype html><html><body style="margin:0;background:#0d1117">
<div data-composition-id="main" data-width="800" data-height="600" data-duration="1" style="position:relative;width:800px;height:600px">
  <p id="on-canvas" style="${P};left:20px;top:20px">On canvas</p>
  <div style="position:absolute;left:20px;top:80px;width:300px;height:60px;background:#204060"><p id="on-panel" style="${P};left:10px;top:10px">On panel</p></div>
  <p id="under-overlay" style="${P};left:20px;top:160px">Under overlay</p>
  <div style="position:absolute;left:10px;top:150px;width:300px;height:60px;background:rgba(255,0,0,.4);pointer-events:none"></div>
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==" style="position:absolute;left:20px;top:230px;width:200px;height:40px">
  <p id="over-image" style="${P};left:20px;top:230px">Over image</p>
  <div style="position:absolute;left:400px;top:20px;width:300px;height:60px;background:linear-gradient(#123,#456)"><p id="on-gradient" style="${P};left:10px;top:10px">Gradient</p></div>
  <div style="position:absolute;left:400px;top:100px;width:300px;height:60px;background:#204060;border-radius:30px"><p id="rounded" style="${P};left:10px;top:10px">Rounded</p></div>
  <div style="position:absolute;left:400px;top:180px;width:300px;height:60px;background:#204060;opacity:.5"><p id="faded" style="${P};left:10px;top:10px">Faded</p></div>
  <p id="shadowed" style="${P};left:400px;top:260px;text-shadow:0 0 6px #fff">Shadowed</p>
  <div style="position:absolute;left:400px;top:340px;width:300px;height:60px;background:#204060;transform:rotate(5deg)"><p id="rotated" style="${P};left:10px;top:10px">Rotated</p></div>
</div><script>window.__renderReady = true;</script></body></html>`;
const SCRIPT = readFileSync(join(import.meta.dirname, "contrast-audit.browser.js"), "utf8");

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) =>
    res.writeHead(200, { "Content-Type": "text/html" }).end(HTML),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

type Candidate = { selector: string; solidBg: number[] | null };

it("reads a backdrop from styles only where pixels would give the same contrast", async () => {
  const { browser, page } = await openSettledCompositionPage(HTML, url, {
    renderReadyTimeoutMs: 5_000,
    renderReadyWarningSuffix: "test",
    browserGpuMode: "software",
  });
  try {
    await page.addScriptTag({ content: SCRIPT });
    const finish = async (dropSolid: boolean) => {
      const prepared = (await page.evaluate("window.__contrastAuditPrepare()")) as Candidate[];
      const shot = await page.screenshot({ encoding: "base64", omitBackground: true });
      const candidates = dropSolid ? prepared.map((c) => ({ ...c, solidBg: null })) : prepared;
      const entries = await page.evaluate(
        (png: string, items: unknown[]) =>
          Reflect.apply(Reflect.get(window, "__contrastAuditFinish"), window, [
            png,
            0,
            items,
            null,
          ]),
        shot,
        candidates,
      );
      return { prepared, entries };
    };

    const styled = await finish(false);
    const solid = Object.fromEntries(styled.prepared.map((c) => [c.selector, c.solidBg]));
    expect(solid).toEqual({
      "#on-canvas": [13, 17, 23],
      "#on-panel": [32, 64, 96],
      "#under-overlay": null,
      "#over-image": null,
      "#on-gradient": null,
      "#rounded": null,
      "#faded": null,
      "#shadowed": null,
      "#rotated": null,
    });
    expect(styled.entries).toEqual((await finish(true)).entries);
  } finally {
    await browser.close();
  }
}, 90_000);
