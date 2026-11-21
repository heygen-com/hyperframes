import type { TimelineRequest } from "../../core/src/runtime/timelineInspection";
import { withHyperframesBrowserMarker } from "../../core/src/browserMarker";
import { buildChromeLaunchEnv } from "../../core/src/chromeEnv";
import {
  chromeSandboxArgs,
  chromeSandboxEnabled,
  launchWithChromeSandboxFallback,
} from "../../core/src/chromeSandbox";
import {
  inspectComponents,
  inspectElementMap,
  inspectTimeline,
  type InspectionView,
  type SourceContext,
} from "./engine";
import { playerStatePage, seekPage, type PageRunner } from "./pageQueries";
import { assertGeneration, validateInspectRequest, validateTimelineRequest } from "./requests";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
  rmSync,
} from "node:fs";
import { join, extname } from "node:path";
import { getHyperframeRuntimeScript } from "../../core/src/generated/runtime-inline";
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";
import {
  bundleToSingleHtml,
  type BundleScriptProvenance,
} from "../../core/src/compiler/htmlBundler";
import { closeServer, isLoopbackHost, servableProjectFile } from "./pageServer";
import { serviceWorkerScriptFetch } from "../../core/src/studioPreviewMark";
import { Sources, fingerprint } from "./sources";
import type { InspectRequest, Snippet } from "./types";
import { foreignWritablePath, trustedCacheRoot } from "../../core/src/cacheDir";
import {
  browserProxyArgs,
  createPublicOnlyProfile,
  startCaptureProxy,
} from "../../engine/src/services/publicNetwork/captureProxy";

const pageRunner = (page: Page): PageRunner => ({
  run: <A, R>(fn: (arg: A) => R, arg: A) =>
    page.evaluate(fn as (arg: unknown) => R, arg) as Promise<R>,
});

interface Session {
  context: BrowserContext;
  page: Page;
  generation: string;
  fingerprint: string;
  sourceContext: () => SourceContext;
  openMs: number;
}
interface PublicOnlyHost {
  browser: Browser;
  server: Server;
  port: number;
  proxy: { close(): Promise<void> };
  profile: string;
}
type PageHandler = (req: IncomingMessage, res: ServerResponse) => void;

async function releaseEach(steps: ReadonlyArray<() => unknown>): Promise<void> {
  for (const step of steps) {
    try {
      await step();
    } catch {
      continue;
    }
  }
}

export function inspectorChromeArgs(
  proxyArgs: readonly string[],
  sandbox = chromeSandboxEnabled(),
): string[] {
  return [
    ...chromeSandboxArgs(sandbox),
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    ...proxyArgs,
  ];
}

export function launchInspectorChrome(options: {
  executablePath: string;
  userDataDir: string;
  proxyArgs: readonly string[];
  sandbox?: boolean;
}): Promise<Browser> {
  return launchWithChromeSandboxFallback(
    inspectorChromeArgs(options.proxyArgs, options.sandbox),
    (args) =>
      puppeteer.launch({
        executablePath: options.executablePath,
        env: buildChromeLaunchEnv(),
        headless: true,
        userDataDir: options.userDataDir,
        args: withHyperframesBrowserMarker(args),
      }),
  );
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
  const cacheRoot = trustedCacheRoot();
  const root = join(cacheRoot, "chrome", "chrome-headless-shell");
  if (existsSync(root))
    for (const version of readdirSync(root).sort().reverse()) {
      const dir = join(root, version);
      for (const platform of readdirSync(dir)) {
        const file = join(
          dir,
          platform,
          process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell",
        );
        if (existsSync(file) && !foreignWritablePath(file, cacheRoot)) return file;
      }
    }
  throw new Error(
    "Set HF_INSPECT_CHROME to an installed Chrome executable; inspection does not download a browser.",
  );
}
export class Inspector {
  private session?: Session;
  private host?: PublicOnlyHost;
  private serve?: PageHandler;
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
    this.serve = undefined;
    if (session) await session.context.close().catch(() => {});
  }
  private async openHost(): Promise<PublicOnlyHost> {
    if (this.host) return this.host;
    const server = createServer((req, res) =>
      this.serve ? this.serve(req, res) : void res.writeHead(404).end(),
    );
    let proxy: PublicOnlyHost["proxy"] | undefined;
    let profile: string | undefined;
    try {
      await new Promise<void>((done, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", done);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("preview address unavailable");
      const started = await startCaptureProxy();
      proxy = started;
      profile = await createPublicOnlyProfile("hf-inspect-profile-");
      const browser = await launchInspectorChrome({
        executablePath: this.options.executablePath ?? chromePath(),
        userDataDir: profile,
        proxyArgs: browserProxyArgs(started.url, `127.0.0.1:${address.port}`),
      });
      this.stats.browserStarts++;
      this.host = { browser, server, port: address.port, proxy: started, profile };
      return this.host;
    } catch (error) {
      const leftover = profile;
      await releaseEach([
        () => proxy?.close(),
        () => closeServer(server),
        () => leftover && rmSync(leftover, { recursive: true, force: true }),
      ]);
      throw error;
    }
  }
  private async closeHost() {
    const host = this.host;
    this.host = undefined;
    if (!host) return;
    await releaseEach([
      () => host.browser.close(),
      () => closeServer(host.server),
      () => host.proxy.close(),
      () => rmSync(host.profile, { recursive: true, force: true }),
    ]);
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
    const serve: PageHandler = (req, res) => {
      if (!isLoopbackHost(req.headers.host)) return void res.writeHead(403).end();
      const { "service-worker": serviceWorker, "sec-fetch-dest": fetchDest } = req.headers;
      if (serviceWorkerScriptFetch({ serviceWorker, fetchDest }))
        return void res.writeHead(403).end();
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
        const file = servableProjectFile(this.project, path);
        if (!file) {
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
    };
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      const host = await this.openHost();
      this.serve = serve;
      context = await host.browser.createBrowserContext();
      page = await context.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      if (this.options.instrument !== false) {
        await page.evaluateOnNewDocument(
          "window.__hfLiveInspection = " +
            JSON.stringify({ generation }) +
            ";\n" +
            readFileSync(new URL(`../dist/inspection.${"js"}`, import.meta.url), "utf8"),
        );
      }
      await page.goto(`http://127.0.0.1:${host.port}/`, { waitUntil: "load", timeout: 30_000 });
      await page.waitForFunction("!!window.__renderReady", { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      let sourceContext: SourceContext | undefined;
      const project = this.project;
      this.session = {
        context,
        page,
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
      await context?.close().catch(() => {});
      this.serve = undefined;
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
        await this.closeHost();
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
      await this.closeHost();
    });
  }
}

export type { InspectRequest, TimelineRequest };
