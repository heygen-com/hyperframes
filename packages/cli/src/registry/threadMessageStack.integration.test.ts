import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { registerPreviewRoutes } from "../../../studio-server/src/routes/preview.js";
import type { StudioApiAdapter } from "../../../studio-server/src/types.js";
import { compileForRender } from "../../../producer/src/services/htmlCompiler.js";
import {
  createRenderJob,
  executeRenderJob,
} from "../../../producer/src/services/renderOrchestrator.js";
import { resolveConfig } from "../../../producer/src/config.js";
import type { RegistryItem } from "@hyperframes/core";
import { installItem } from "./installer.js";
import { parseThreadMessageStackData } from "./threadMessageStack.js";
import { lintProject } from "../utils/lintProject.js";
import { DEFAULT_CHECK_OPTIONS, runCheckPipeline } from "../utils/checkPipeline.js";

const tempDirs: string[] = [];
const sourcePath = resolve(
  import.meta.dirname,
  "../../../../registry/blocks/thread-message-stack/thread-message-stack.html",
);

const item: RegistryItem = {
  name: "thread-message-stack",
  type: "hyperframes:block",
  title: "Thread Message Stack",
  description: "A source-owned editable conversation stack.",
  dimensions: { width: 1920, height: 1080 },
  duration: 8,
  files: [
    {
      path: "thread-message-stack.html",
      target: "compositions/thread-message-stack.html",
      type: "hyperframes:composition",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-thread-stack-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "compositions"), { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head><style>html,body,#host{margin:0;width:1920px;height:1080px;overflow:hidden}</style></head><body>
      <div id="host" data-composition-id="root" data-start="0" data-duration="8" data-width="1920" data-height="1080">
        <div id="thread-message-stack-host" data-composition-id="thread-message-stack" data-composition-src="compositions/thread-message-stack.html" data-start="0" data-duration="8" data-track-index="0" data-width="1920" data-height="1080"></div>
      </div><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
      <script>window.__timelines=window.__timelines||{};window.__timelines.root=gsap.timeline({paused:true}).to("#host",{x:1,duration:8,ease:"none"});</script>
    </body></html>`,
  );
  return dir;
}

function previewAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: projectDir }),
    bundle: async () => await bundleToSingleHtml(projectDir),
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(projectDir, "renders"),
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: join(projectDir, "renders/out.mp4"),
    }),
  };
}

function stubRegistrySource(source: string): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (
        String(input).includes("test.invalid/blocks/thread-message-stack/thread-message-stack.html")
      ) {
        return new Response(source, { status: 200 });
      }
      return await realFetch(input, init);
    }),
  );
}

// End-to-end boundary coverage intentionally stays together so every temp project is cleaned.
// fallow-ignore-next-line unit-size
describe("thread-message-stack install to preview/render parity", () => {
  for (const count of [1, 6, 20]) {
    it(`crosses the real installer, Studio preview route, and producer compiler for ${count} messages`, async () => {
      const projectDir = createProject();
      const source = readFileSync(sourcePath, "utf8");
      stubRegistrySource(source);
      const messages = Array.from({ length: count }, (_, index) => ({
        side: index % 2 === 0 ? ("incoming" as const) : ("outgoing" as const),
        text: index === count - 1 ? `${"long ".repeat(400)}${index}` : `message-${index}`,
        sender: index === 0 ? "" : undefined,
      }));

      await installItem(item, {
        destDir: projectDir,
        baseUrl: "https://test.invalid",
        threadMessageStackData: { messages, stagger: 0, hold: 0 },
      });
      const installedPath = join(projectDir, "compositions/thread-message-stack.html");
      expect(parseThreadMessageStackData(readFileSync(installedPath, "utf8")).messages).toEqual(
        messages,
      );

      const app = new Hono();
      registerPreviewRoutes(app, previewAdapter(projectDir));
      const previewResponse = await app.request("http://localhost/projects/demo/preview");
      const previewHtml = await previewResponse.text();
      expect(previewResponse.status).toBe(200);

      const producerDir = join(projectDir, "producer-output");
      mkdirSync(producerDir, { recursive: true });
      const producerHtml = await compileForRender(
        projectDir,
        join(projectDir, "index.html"),
        producerDir,
      );
      for (const message of messages) {
        expect(previewHtml).toContain(message.text);
        expect(producerHtml.html).toContain(message.text);
      }
      expect(previewHtml).toContain("thread-message-stack");
      expect(previewHtml).toContain("__timelines");
      expect(producerHtml.html).toContain("thread-message-stack");
      expect(producerHtml.html).toContain("__timelines");
      expect(producerHtml.html).toContain("hidden data-hf-primitive-data");
      expect(producerHtml.html).not.toMatch(
        /function\(document, gsap, window, __hyperframes\) \{\s*\{"messages"/,
      );
    });
  }

  it("produces a real deterministic frame chain and MP4 from the installed source", async () => {
    const projectDir = createProject();
    const source = readFileSync(sourcePath, "utf8");
    stubRegistrySource(source);
    await installItem(item, {
      destDir: projectDir,
      baseUrl: "https://test.invalid",
      threadMessageStackData: {
        messages: [
          { side: "incoming", text: "first", sender: "" },
          { side: "outgoing", text: "second" },
        ],
        stagger: 0,
        hold: 0,
      },
    });
    const lint = await lintProject(projectDir);
    expect(lint.totalErrors).toBe(0);
    const check = await runCheckPipeline(
      {
        dir: projectDir,
        name: "thread-message-stack-smoke",
        indexPath: join(projectDir, "index.html"),
      },
      { ...DEFAULT_CHECK_OPTIONS, samples: 3, contrast: false },
    );
    expect(check.ok, JSON.stringify(check, null, 2)).toBe(true);
    expect(check.runtime.errorCount).toBe(0);
    const output = join(projectDir, "thread-message-stack.mp4");
    const job = createRenderJob({
      fps: 1,
      quality: "draft",
      workers: 1,
      producerConfig: resolveConfig({ forceScreenshot: true }),
    });
    await executeRenderJob(job, projectDir, output);
    expect(job.status).toBe("complete");
    expect(job.outcome).toBe("completed");
    expect(job.warnings).toEqual([]);
    expect(job.perfSummary?.totalFrames).toBe(8);
    expect(statSync(output).size).toBeGreaterThan(0);
  }, 120_000);
});
