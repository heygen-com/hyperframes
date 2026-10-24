import type { TimelineRequest } from "../../core/src/runtime/timelineInspection";
import {
  inspectComponents,
  inspectElementMap,
  inspectTimeline,
  type InspectionView,
  type SourceContext,
} from "./engine";
import { playerStatePage, seekPage, type PageRunner } from "./pageQueries";
import { assertGeneration, validateInspectRequest, validateTimelineRequest } from "./requests";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { homedir } from "node:os";
import { getHyperframeRuntimeScript } from "../../core/src/generated/runtime-inline";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  bundleToSingleHtml,
  type BundleScriptProvenance,
} from "../../core/src/compiler/htmlBundler";
import { closeServer } from "./pageServer";
import { Sources, fingerprint } from "./sources";
import type { InspectRequest, Snippet } from "./types";

const pageRunner = (page: Page): PageRunner => ({
  run: <A, R>(fn: (arg: A) => R, arg: A) =>
    page.evaluate(fn as (arg: unknown) => R, arg) as Promise<R>,
});

interface Session {
  page: Page;
  server: Server;
  generation: string;
  fingerprint: string;
  sourceContext: () => SourceContext;
  openMs: number;
}
export interface InspectorOptions {
  executablePath?: string;
  idleMs?: number;
  instrument?: boolean;
}
function chromePath() {
  const configured = process.env.HF_INSPECT_CHROME;
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new Error(
      "Set HF_INSPECT_CHROME to an installed Chrome executable; inspection does not download a browser.",
    );
  }
  const root = join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
  if (existsSync(root))
    for (const version of readdirSync(root).sort().reverse()) {
      const dir = join(root, version);
      for (const platform of readdirSync(dir)) {
        const file = join(
          dir,
          platform,
          process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell",
        );
        if (existsSync(file)) return file;
      }
    }
  throw new Error(
    "Set HF_INSPECT_CHROME to an installed Chrome executable; inspection does not download a browser.",
  );
}
export class Inspector {
  private session?: Session;
  private browser?: Browser;
  private tail: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private catalog = new Map<string, Snippet>();
  readonly project: string;
  readonly stats = { browserStarts: 0, pageLoads: 0, sourceLoads: 0, queries: 0, seeks: 0 };
  constructor(
    project: string,
    readonly options: InspectorOptions = {},
  ) {
    this.project = realpathSync(project);
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  private async closeSession() {
    const session = this.session;
    this.session = undefined;
    this.catalog.clear();
    if (session) {
      await session.page.close().catch(() => {});
      await closeServer(session.server);
    }
  }
  private async ensure(): Promise<{ session: Session; reused: boolean }> {
    const digest = fingerprint(this.project);
    if (this.session?.fingerprint === digest) return { session: this.session, reused: true };
    await this.closeSession();
    const start = performance.now();
    const generation = randomUUID();
    const provenance: BundleScriptProvenance[] = [];
    const reads = new Set<string>();
    const html = await bundleToSingleHtml(this.project, {
      runtime: "placeholder",
      scriptProvenance: (p) => provenance.push(p),
      onRead: (path) => reads.add(path),
    });
    if (fingerprint(this.project) !== digest)
      throw new Error("source_changed_during_load: retry against a stable project");
    const server = createServer((req, res) => {
      try {
        const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        if (path === "/" || path === "/index.html") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            html.replace(
              'data-hyperframes-preview-runtime="1" src=""',
              'data-hyperframes-preview-runtime="1" src="/__hf-runtime.js"',
            ),
          );
          return;
        }
        if (path === "/__hf-runtime.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(getHyperframeRuntimeScript());
          return;
        }
        const file = realpathSync(resolve(this.project, `.${path}`));
        if (!file.startsWith(this.project + sep)) {
          res.writeHead(404).end();
          return;
        }
        const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!fstatSync(fd).isFile()) {
            res.writeHead(404).end();
            return;
          }
          const types: Record<string, string> = {
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
            ".png": "image/png",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
          };
          res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
          res.end(readFileSync(fd));
        } finally {
          closeSync(fd);
        }
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("preview address unavailable");
    let page: Page | undefined;
    try {
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          executablePath: this.options.executablePath ?? chromePath(),
          headless: true,
          args: [
            "--disable-dev-shm-usage",
            "--enable-webgl",
            "--use-gl=angle",
            "--use-angle=swiftshader",
          ],
        });
        this.stats.browserStarts++;
      }
      page = await this.browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      if (this.options.instrument !== false) {
        await page.evaluateOnNewDocument(
          "window.__hfLiveInspection = " +
            JSON.stringify({ generation }) +
            ";\n" +
            readFileSync(new URL(`../dist/inspection.${"js"}`, import.meta.url), "utf8"),
        );
      }
      await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load", timeout: 30_000 });
      await page.waitForFunction("!!window.__renderReady", { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      let sourceContext: SourceContext | undefined;
      const project = this.project;
      this.session = {
        page,
        server,
        generation,
        fingerprint: digest,
        sourceContext: () => {
          if (!sourceContext) {
            const sources = new Sources(project, reads);
            sourceContext = { sources, map: sources.mapper(html, provenance) };
            this.stats.sourceLoads++;
          }
          return sourceContext;
        },
        openMs: performance.now() - start,
      };
      this.stats.pageLoads++;
      return { session: this.session, reused: false };
    } catch (error) {
      await page?.close().catch(() => {});
      await closeServer(server);
      throw error;
    }
  }
  private view(session: Session): InspectionView {
    return {
      generation: session.generation,
      sourceVersion: session.fingerprint,
      sourceContext: session.sourceContext,
      assertCurrent: async () => {
        if (fingerprint(this.project) === session.fingerprint) return;
        await this.closeSession();
        throw new Error("source_changed_during_query: retry");
      },
    };
  }
  private idle() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.serialize(async () => {
        await this.closeSession();
        await this.browser?.close();
        this.browser = undefined;
      });
    }, this.options.idleMs ?? 120_000);
    this.timer.unref();
  }
  async inspect(request: InspectRequest) {
    return this.serialize(async () => {
      if (this.closed) throw new Error("inspector_disposed");
      clearTimeout(this.timer);
      try {
        return await this.query(request);
      } finally {
        this.idle();
      }
    });
  }
  private async query(request: InspectRequest) {
    validateInspectRequest(request);
    const start = performance.now();
    const { session, reused } = await this.ensure();
    assertGeneration(request.generation, session.generation);
    const runner = pageRunner(session.page);
    if (request.time != null) {
      await runner.run(seekPage, request.time);
      this.stats.seeks++;
    }
    const visualState =
      request.time == null ? undefined : await runner.run(playerStatePage, undefined);
    const report = await inspectComponents(runner, this.view(session), request, {
      catalog: this.catalog,
      reused,
      start,
      visualState,
    });
    this.stats.queries++;
    return report;
  }
  async timeline(request: TimelineRequest) {
    validateTimelineRequest(request);
    return this.serialize(async () => {
      if (this.closed) throw new Error("inspector_disposed");
      clearTimeout(this.timer);
      try {
        const { session, reused } = await this.ensure();
        assertGeneration(request.generation, session.generation);
        const report = await inspectTimeline(
          pageRunner(session.page),
          this.view(session),
          request,
          reused,
        );
        this.stats.queries++;
        return report;
      } finally {
        this.idle();
      }
    });
  }
  async elementMap() {
    return this.serialize(async () => {
      if (this.closed) throw new Error("inspector_disposed");
      clearTimeout(this.timer);
      try {
        if (!existsSync(join(this.project, "index.html"))) throw new Error("no-composition");
        const { session } = await this.ensure();
        return await inspectElementMap(pageRunner(session.page), this.view(session));
      } finally {
        this.idle();
      }
    });
  }
  async withPage<T>(fn: (page: Page) => Promise<T>) {
    return this.serialize(async () => {
      if (this.closed) throw new Error("inspector_disposed");
      clearTimeout(this.timer);
      try {
        const { session } = await this.ensure();
        return await fn(session.page);
      } finally {
        this.idle();
      }
    });
  }
  async dispose() {
    return this.serialize(async () => {
      this.closed = true;
      clearTimeout(this.timer);
      await this.closeSession();
      await this.browser?.close();
      this.browser = undefined;
    });
  }
}

export type { InspectRequest, TimelineRequest };
