// Vite adapter that wires the shared Studio API to the local filesystem and build tools.

import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join, relative, resolve, isAbsolute, dirname } from "node:path";
import type { ViteDevServer } from "vite";
import {
  type ResolvedProject,
  type RenderJobState,
  type StudioApiAdapter,
  type BackgroundRemovalRender,
  createBackgroundRemovalJob,
  createProjectSignature,
} from "@hyperframes/studio-server";
import type { RegistryItem } from "@hyperframes/core/registry";
import { createRetryingModuleLoader, ensureProducerDist } from "./vite.producer";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { generateThumbnail, findSystemChrome } from "./vite.browser";

export function isPathWithin(parentDir: string, childPath: string): boolean {
  const childRelativePath = relative(resolve(parentDir), resolve(childPath));
  return (
    childRelativePath === "" ||
    (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath))
  );
}

export function createViteAdapter(dataDir: string, server: ViteDevServer): StudioApiAdapter {
  let _bundler:
    | ((
        dir: string,
        options?: { runtime?: "inline" | "placeholder"; inlineColorGradingLuts?: boolean },
      ) => Promise<string>)
    | null = null;
  let _producerModuleLoader:
    | (() => Promise<{
        createRenderJob: (config: {
          fps: 24 | 30 | 60;
          quality: "draft" | "standard" | "high";
          format: string;
          renderBodyScripts?: string[];
          outputResolution?: "landscape" | "portrait" | "landscape-4k" | "portrait-4k";
          variables?: Record<string, unknown>;
        }) => unknown;
        executeRenderJob: (
          job: unknown,
          projectDir: string,
          outputPath: string,
          onProgress?: (job: { progress: number; currentStage?: string }) => void,
        ) => Promise<void>;
      }>)
    | null = null;

  const projectSignatureCache = new Map<string, string>();
  server.watcher.on("all", (_event, file) => {
    for (const projectDir of projectSignatureCache.keys()) {
      if (isPathWithin(projectDir, file)) projectSignatureCache.delete(projectDir);
    }
  });

  const getBundler = async () => {
    if (!_bundler) {
      try {
        const mod = await server.ssrLoadModule("@hyperframes/core/compiler");
        _bundler = (dir, options) => mod.bundleToSingleHtml(dir, options);
      } catch (err) {
        console.warn("[Studio] Failed to load compiler, previews will use raw HTML:", err);
        _bundler = null as never;
      }
    }
    return _bundler;
  };

  const getProducerModule = async () => {
    if (!_producerModuleLoader) {
      _producerModuleLoader = createRetryingModuleLoader(async () => {
        const { built } = ensureProducerDist({
          studioDir: __dirname,
          env: process.env,
        });
        if (built) {
          console.warn(
            "[Studio] @hyperframes/producer dist missing; building producer package for local renders...",
          );
        }
        const producerPkg = "@hyperframes/producer";
        return await import(/* @vite-ignore */ producerPkg);
      });
    }
    return _producerModuleLoader();
  };

  return {
    // fallow-ignore-next-line complexity
    listProjects() {
      if (!existsSync(dataDir)) return [];
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionMap = new Map<string, { sessionId: string; title: string }>();
      if (existsSync(sessionsDir)) {
        for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
          try {
            const raw = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8"));
            if (raw.projectId) {
              sessionMap.set(raw.projectId, {
                sessionId: file.replace(".json", ""),
                title: raw.title || "Untitled",
              });
            }
          } catch {
            /* skip corrupt */
          }
        }
      }
      return readdirSync(dataDir, { withFileTypes: true })
        .filter(
          (d) =>
            (d.isDirectory() || d.isSymbolicLink()) &&
            (existsSync(join(dataDir, d.name, "index.html")) ||
              existsSync(join(dataDir, d.name, `${d.name}.html`))),
        )
        .map((d) => {
          const session = sessionMap.get(d.name);
          return {
            id: d.name,
            dir: join(dataDir, d.name),
            title: session?.title ?? d.name,
            sessionId: session?.sessionId,
          } satisfies ResolvedProject;
        })
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    },

    // fallow-ignore-next-line complexity
    resolveProject(id: string) {
      let projectDir = join(dataDir, id);
      if (!existsSync(projectDir)) {
        const sessionsDir = resolve(dataDir, "../sessions");
        const sessionFile = join(sessionsDir, `${id}.json`);
        if (existsSync(sessionFile)) {
          try {
            const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
            if (session.projectId) {
              projectDir = join(dataDir, session.projectId);
              if (existsSync(projectDir)) {
                return {
                  id: session.projectId,
                  dir: realpathSync(projectDir),
                  title: session.title,
                };
              }
            }
          } catch {
            /* ignore */
          }
        }
        return null;
      }
      return { id, dir: realpathSync(projectDir) };
    },

    async bundle(dir: string) {
      const bundler = await getBundler();
      if (!bundler) return null;
      let html = await bundler(dir, { runtime: "placeholder", inlineColorGradingLuts: false });
      html = html.replace(
        'data-hyperframes-preview-runtime="1" src=""',
        `data-hyperframes-preview-runtime="1" src="${this.runtimeUrl}"`,
      );
      return html;
    },

    async transformPreviewHtml({ html }) {
      const producer = await import("../producer/src/services/deterministicFonts.js");
      return producer.injectDeterministicFontFaces(html);
    },

    getProjectSignature(projectDir: string): string {
      const cacheKey = resolve(projectDir);
      const cached = projectSignatureCache.get(cacheKey);
      if (cached) return cached;
      // Project dirs are symlinked from anywhere on disk (often outside the
      // studio package), so Vite's default watch roots don't cover them.
      // Without this, the signature cache never invalidates for external
      // projects and the preview ETag serves stale 304s after edits.
      server.watcher.add(cacheKey);
      const signature = createProjectSignature(cacheKey);
      projectSignatureCache.set(cacheKey, signature);
      return signature;
    },

    async lint(html: string, opts?: { filePath?: string }) {
      const mod = await server.ssrLoadModule("@hyperframes/core/lint");
      return await mod.lintHyperframeHtml(html, opts);
    },

    runtimeUrl: "/api/runtime.js",

    rendersDir: () => resolve(dataDir, "../renders"),

    startRender(opts): RenderJobState {
      const abortController = new AbortController();
      const state: RenderJobState = {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
        cancel: () => abortController.abort(),
      };

      const startTime = Date.now();
      const removeCancelledOutput = () => {
        // User-initiated cancel: not a failure. Remove any output so the
        // cancelled job doesn't resurrect in the render history.
        state.status = "cancelled";
        for (const fp of [
          opts.outputPath,
          opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json"),
        ]) {
          try {
            if (existsSync(fp)) unlinkSync(fp);
          } catch {
            /* ignore */
          }
        }
      };
      // fallow-ignore-next-line complexity
      (async () => {
        try {
          if (!process.env.PRODUCER_HEADLESS_SHELL_PATH) {
            const systemChrome = findSystemChrome();
            if (systemChrome) process.env.PRODUCER_HEADLESS_SHELL_PATH = systemChrome;
          }
          const { createRenderJob, executeRenderJob } = await getProducerModule();
          const renderBodyScripts = createStudioDevRenderBodyScripts(opts.project.dir);
          const job = createRenderJob({
            fps: opts.fps,
            quality: opts.quality as "draft" | "standard" | "high",
            format: opts.format,
            ...(renderBodyScripts.length > 0 ? { renderBodyScripts } : {}),
            outputResolution: opts.outputResolution,
            ...(opts.composition ? { entryFile: opts.composition } : {}),
            ...(opts.variables ? { variables: opts.variables } : {}),
          });
          const onProgress = (j: { progress: number; currentStage?: string }) => {
            state.progress = j.progress;
            if (j.currentStage) state.stage = j.currentStage;
          };
          await executeRenderJob(
            job,
            opts.project.dir,
            opts.outputPath,
            onProgress,
            abortController.signal,
          );
          if (abortController.signal.aborted) {
            // Cancel landed just as the render finished: honor the cancel the
            // route already reported instead of resurrecting a completed job.
            removeCancelledOutput();
            return;
          }
          state.status = "complete";
          state.progress = 100;
          const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json");
          writeFileSync(
            metaPath,
            JSON.stringify({ status: "complete", durationMs: Date.now() - startTime }),
          );
        } catch (err) {
          if (abortController.signal.aborted) {
            removeCancelledOutput();
            return;
          }
          state.status = "failed";
          state.error = err instanceof Error ? err.message : String(err);
          try {
            const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json");
            writeFileSync(metaPath, JSON.stringify({ status: "failed" }));
          } catch {
            /* ignore */
          }
        }
      })();

      return state;
    },

    startBackgroundRemoval(opts) {
      return createBackgroundRemovalJob(opts, async (renderOpts) => {
        const mod = await server.ssrLoadModule(
          resolve(__dirname, "../cli/src/background-removal/pipeline.ts"),
        );
        const render = mod.render as BackgroundRemovalRender;
        return render(renderOpts);
      });
    },

    async generateThumbnail(opts) {
      return generateThumbnail(opts);
    },

    async resolveSession(sessionId: string) {
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionFile = join(sessionsDir, `${sessionId}.json`);
      if (!existsSync(sessionFile)) return null;
      try {
        const raw = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (raw.projectId) return { projectId: raw.projectId, title: raw.title };
      } catch {
        /* ignore */
      }
      return null;
    },

    // fallow-ignore-next-line complexity
    async listRegistryCatalog(): Promise<RegistryItem[]> {
      const registryRoot = resolve(__dirname, "../../registry");
      const items: RegistryItem[] = [];
      for (const subdir of ["blocks", "components"]) {
        const dir = join(registryRoot, subdir);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const manifestPath = join(dir, entry.name, "registry-item.json");
          if (!existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
            if (manifest.type === "hyperframes:block" || manifest.type === "hyperframes:component")
              items.push(manifest);
          } catch {
            /* skip malformed manifests */
          }
        }
      }
      return items;
    },

    // fallow-ignore-next-line complexity
    async installRegistryBlock(opts: {
      project: ResolvedProject;
      blockName: string;
    }): Promise<{ written: string[]; block: RegistryItem }> {
      const registryRoot = resolve(__dirname, "../../registry");
      let itemDir = join(registryRoot, "blocks", opts.blockName);
      if (!existsSync(join(itemDir, "registry-item.json"))) {
        itemDir = join(registryRoot, "components", opts.blockName);
      }
      const manifestPath = join(itemDir, "registry-item.json");

      if (!existsSync(manifestPath)) {
        throw new Error(`Item "${opts.blockName}" not found in registry`);
      }

      const block = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
      const written: string[] = [];

      for (const file of block.files) {
        const sourcePath = join(itemDir, file.path);
        const targetPath = resolve(opts.project.dir, file.target);

        if (!isPathWithin(opts.project.dir, targetPath)) {
          throw new Error(`Target path escapes project directory: ${file.target}`);
        }

        mkdirSync(dirname(targetPath), { recursive: true });

        if (file.type === "hyperframes:composition") {
          let content = readFileSync(sourcePath, "utf-8");
          content = `<!-- hyperframes-registry-item: ${block.name} -->\n${content}`;
          writeFileSync(targetPath, content, "utf-8");
        } else {
          copyFileSync(sourcePath, targetPath);
        }

        written.push(file.target);
      }

      return { written, block };
    },
  };
}
