import { snippetSource } from "./snippetSource";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { bundleToSingleHtml } from "../../core/src/compiler/htmlBundler";
// Built Node entry, exactly the import consumed by Desktop.
const entry = "../dist/live.js";
const { prepareLiveInspection, fingerprint }: typeof import("../src/live") = await import(entry);
type PageRunner = import("../src/live").PageRunner;
const dir = mkdtempSync(join(tmpdir(), "hf-live-"));
const vendor = process.argv[2];
if (!vendor) throw new Error("Pass gsap.min.js");
const source = `<!doctype html><html><head><script src="gsap.min.js"></script><style>.title{color:red}</style></head><body><main data-composition-id="test" data-start="0" data-duration="10" data-width="1920" data-height="1080"><section id="a"><h1 class="title" id="title">One</h1></section><section id="b"><h1 class="title" id="other">Two</h1></section></main><script>
const title = document.querySelector('#title');
const other = document.querySelector('#other');
const tl=gsap.timeline({paused:true});
function move(el){tl.to(el,{x:80,duration:2},1);}
move(title);
move(other);
window.__timelines = window.__timelines || {}; window.__timelines.test = tl;
</script></body></html>`;
writeFileSync(join(dir, "index.html"), source);
writeFileSync(join(dir, "gsap.min.js"), readFileSync(vendor));
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
  const version = fingerprint(dir),
    provenance: import("../../core/src/compiler/htmlBundler").BundleScriptProvenance[] = [];
  const bundled = await bundleToSingleHtml(dir, {
    runtime: "inline",
    scriptProvenance: (p) => provenance.push(p),
  });
  const live = prepareLiveInspection(dir, bundled, provenance, version);
  // Studio adds scripts after the bundler. Map the final served document, not its earlier offsets.
  const served = live.html.replace(
    "<head>",
    '<head>\n<meta name="studio-fixture" content="extra-lines">\n',
  );
  live.finalizeDocument(served);
  let servedDocument = served;
  server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url?.endsWith("/gsap.min.js") ? "text/javascript" : "text/html",
    );
    res.end(req.url?.endsWith("/gsap.min.js") ? readFileSync(vendor) : servedDocument);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  browser = await puppeteer.launch({
    executablePath:
      process.env.HF_INSPECT_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/projects/test/preview`,
  );
  await page.waitForFunction("!!window.__hfInspection && !!window.__timelines?.test", {
    timeout: 3000,
  });
  // The host's transport: page functions cross as source text, as Electron's executeJavaScript takes them.
  const runner: PageRunner = {
    run: <A, R>(fn: (arg: A) => R, arg: A) =>
      page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`) as Promise<R>,
  };
  const playhead = () => page.evaluate(() => (window as any).__timelines.test.time() as number);
  const before = await playhead();
  const request = {
    targets: [
      { selector: "#title" },
      { selector: "#other" },
      { selector: ".title" },
      { selector: ".title", within: "#b" },
    ],
  };
  const result = await live.inspect(runner, request);
  assert.deepEqual(
    result.results.map((r) => r.status),
    ["found", "found", "found", "found"],
  );
  // A selector matching several elements answers for the group (0009), listing each as a candidate.
  assert.deepEqual(
    result.results[2]!.candidates.map((c) => c.id),
    ["title", "other"],
  );
  assert.equal(result.results[0]!.unmappedAnimations, 0);
  assert(
    result.snippets.some(
      (s) => s.code.includes("function move") && s.targets?.includes(0) && s.targets.includes(1),
    ),
  );
  for (const s of result.snippets) assert.equal(s.code, snippetSource(dir, s.id));
  const timeline = await live.timeline(runner, { at: 2, component: { selector: "#title" } });
  assert.equal(timeline.status, "found");
  assert(timeline.text.includes("index.html:"), "timeline maps its animations to source lines");
  const map = await live.elementMap(runner);
  assert(map.text.includes("#title") && map.generation === live.generation);
  const advance = (on: boolean) => {
    const h1 = document.querySelector("#other")!;
    h1.classList.toggle("on", on);
    h1.textContent = on ? "9.9" : "Two";
  };
  await runner.run(advance, true);
  assert.equal((await live.elementMap(runner)).text, map.text, "runtime class and text");
  await runner.run(advance, false);
  const reloadDuringQuery = async (
    run: (inspection: typeof live, racingRunner: PageRunner) => Promise<unknown>,
  ) => {
    const beforeReload = prepareLiveInspection(dir, bundled, provenance, version);
    const afterReload = prepareLiveInspection(dir, bundled, provenance, version);
    beforeReload.finalizeDocument(beforeReload.html);
    afterReload.finalizeDocument(afterReload.html);
    servedDocument = beforeReload.html;
    await page.reload();
    await page.waitForFunction("!!window.__hfInspection");
    let calls = 0;
    const racingRunner: PageRunner = {
      run: async <A, R>(fn: (arg: A) => R, arg: A) => {
        calls++;
        if (calls === 2) {
          servedDocument = afterReload.html;
          await page.reload();
          await page.waitForFunction("!!window.__hfInspection");
        }
        return page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`) as Promise<R>;
      },
    };
    await assert.rejects(run(beforeReload, racingRunner), /preview reloaded/);
  };
  await reloadDuringQuery((inspection, racingRunner) => inspection.inspect(racingRunner, request));
  await reloadDuringQuery((inspection, racingRunner) =>
    inspection.timeline(racingRunner, { at: 2, component: { selector: "#title" } }),
  );
  await reloadDuringQuery((inspection, racingRunner) => inspection.elementMap(racingRunner));
  servedDocument = served;
  await page.reload();
  await page.waitForFunction("!!window.__hfInspection");
  assert.equal(await playhead(), before, "inspection moved the playhead");
  await assert.rejects(live.inspect(runner, { ...request, generation: "old" }), /stale_generation/);
  await assert.rejects(live.inspect(runner, { ...request, time: 3 }), /does_not_seek/);
  const other = prepareLiveInspection(dir, bundled, provenance, version);
  await assert.rejects(other.elementMap(runner), /preview reloaded/);
  writeFileSync(join(dir, "index.html"), source + "\n");
  await assert.rejects(live.inspect(runner, request), /stale_preview/);
  assert.equal((await browser.pages()).length, 2); // initial blank + the one host preview
  console.log(
    "PASS live preview: components, timeline and element map through a source-text runner; source lines, shared helper mapping, ambiguity, no seek, stale generation/page/source, one host page",
  );
} finally {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
}
