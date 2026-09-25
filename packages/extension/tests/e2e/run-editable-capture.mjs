import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const repo = resolve(import.meta.dirname, "../../../..");
const extensionDir = resolve(repo, "packages/extension/store/unpacked");
const fixtureDir = resolve(import.meta.dirname, "fixtures/torture");
const chromePath = process.env.HYPERFRAMES_E2E_CHROME;
const ffmpegPath = process.env.HYPERFRAMES_E2E_FFMPEG ?? "ffmpeg";
const caseName = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7) ?? "fixture";
const outputRoot = resolve(
  process.env.HYPERFRAMES_E2E_OUTPUT ?? resolve(repo, "packages/extension/artifacts/e2e"),
  caseName,
);
const studioPort = 20_000 + (process.pid % 10_000);
const fixturePort = studioPort + 1;
const projectName = `extension-e2e-${process.pid}`;

if (!chromePath) throw new Error("Set HYPERFRAMES_E2E_CHROME to a Chrome executable.");

const cases = {
  fixture: {
    url: `http://127.0.0.1:${fixturePort}/`,
    selector: "#torture-card",
    ready: () => document.querySelector("#motion-canvas") instanceof HTMLCanvasElement,
    minimumVisualBytes: 30_000,
  },
  youtube: {
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    selector: "#movie_player",
    ready: () => {
      const video = document.querySelector("#movie_player video");
      return video instanceof HTMLVideoElement && video.readyState >= 2;
    },
    minimumVisualBytes: 40_000,
  },
  apple: {
    url: "https://www.apple.com/iphone/",
    selector: "#gallery-item-1",
    ready: () => {
      const image = document.querySelector("#gallery-item-1 picture img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    },
    minimumVisualBytes: 20_000,
  },
  webgl: {
    url: "https://threejs.org/examples/webgl_animation_keyframes.html",
    selector: "#container > canvas",
    ready: () => {
      const canvas = document.querySelector("#container > canvas");
      return canvas instanceof HTMLCanvasElement && canvas.width > 1000;
    },
    minimumVisualBytes: 40_000,
    expectsModel: true,
  },
  ultramock: {
    url: "https://www.ultramock.io/",
    selector: "canvas",
    ready: () => {
      const canvas = document.querySelector("canvas");
      return (
        canvas instanceof HTMLCanvasElement &&
        canvas.width > 500 &&
        performance.getEntriesByType("resource").some((entry) => /\.glb(?:$|\?)/i.test(entry.name))
      );
    },
    minimumVisualBytes: 40_000,
    expectsModel: true,
    pickPoint: { x: 0.1, y: 0.1 },
  },
};

const selectedCase = cases[caseName];
if (!selectedCase) throw new Error(`Unknown case: ${caseName}`);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function fixtureServer() {
  return createServer(async (request, response) => {
    if (request.url === "/asset.svg") {
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220"><defs><linearGradient id="g"><stop stop-color="#4de8ff"/><stop offset="1" stop-color="#54f59a"/></linearGradient></defs><rect width="600" height="220" rx="32" fill="#0b0d12"/><circle cx="110" cy="110" r="72" fill="url(#g)"/><text x="220" y="125" fill="#f6f7fb" font-family="system-ui" font-size="44" font-weight="800">CROSS ORIGIN</text></svg>',
      );
      return;
    }
    const body = await readFile(resolve(fixtureDir, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body);
  });
}

async function startStudio(projectDir) {
  const child = spawn(
    resolve(repo, "packages/studio/node_modules/.bin/vite"),
    ["--host", "127.0.0.1", `--port=${studioPort}`],
    {
      cwd: resolve(repo, "packages/studio"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HYPERFRAMES_AUTO_PROXY: "false",
        HYPERFRAMES_PREVIEW_PROJECT_DIR: projectDir,
        HYPERFRAMES_PREVIEW_PROJECT_NAME: projectName,
      },
    },
  );
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null) throw new Error(`Studio exited early.\n${log}`);
        try {
          return (await fetch(`http://127.0.0.1:${studioPort}/__hyperframes_config`)).ok;
        } catch {
          return false;
        }
      },
      "Studio server",
      45_000,
    );
  } catch (error) {
    await stopStudio(child);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${log}`);
  }
  return { child, log: () => log };
}

async function stopStudio(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolveExit) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolveExit();
    });
    child.kill("SIGTERM");
  });
}

async function projectFiles(projectDir) {
  const compositionDir = join(projectDir, "compositions/web-captures");
  const names = await readdir(compositionDir).catch(() => []);
  const childName = names.find((name) => name.endsWith(".html"));
  if (!childName) return null;
  const childPath = join(compositionDir, childName);
  const [parent, child] = await Promise.all([
    readFile(join(projectDir, "index.html")),
    readFile(childPath),
  ]);
  const relativeChild = `compositions/web-captures/${childName}`;
  const childText = child.toString();
  const runtimeRelativePath = selectedCase.expectsModel
    ? (/<script[^>]+src="([^"]*hyperframes-web-capture-3d[^"]*)"/.exec(childText)?.[1] ?? null)
    : null;
  const runtime = runtimeRelativePath
    ? await readFile(join(projectDir, runtimeRelativePath)).catch(() => null)
    : null;
  const hasLocalizedPayload = selectedCase.expectsModel
    ? childText.includes("data:model/gltf-binary;base64,") &&
      childText.includes("<model-viewer") &&
      runtime?.includes("customElements.define")
    : /data:image\/(?:png|jpeg|webp);base64,/.test(childText);
  if (
    !parent.toString().includes(relativeChild) ||
    !hasLocalizedPayload ||
    !childText.includes("data-hf-captured-tag")
  ) {
    return null;
  }
  return { parent, child, childPath, relativeChild, runtime, runtimeRelativePath };
}

async function loadedModelViewer(page) {
  for (const frame of page.frames()) {
    const viewer = await frame.$("model-viewer").catch(() => null);
    if (!viewer) continue;
    const loaded = await viewer.evaluate((element) => element.loaded === true).catch(() => false);
    if (loaded) return viewer;
    await viewer.dispose();
  }
  return null;
}

async function screenshotLoadedModelViewer(page, path, label) {
  return waitFor(
    async () => {
      const viewer = await loadedModelViewer(page);
      if (!viewer) return null;
      try {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
        return await viewer.screenshot({ path });
      } catch {
        return null;
      } finally {
        await viewer.dispose().catch(() => undefined);
      }
    },
    label,
    60_000,
  );
}

async function dispatchNativePaste(page) {
  const session = await page.createCDPSession();
  try {
    await session.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "v",
      code: "KeyV",
      modifiers: 4,
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 9,
      commands: ["Paste"],
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "v",
      code: "KeyV",
      modifiers: 4,
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 9,
    });
  } finally {
    await session.detach();
  }
}

await mkdir(outputRoot, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), `hyperframes-extension-${caseName}-`));
const projectDir = join(scratch, "project");
const profileDir = join(scratch, "chrome-profile");
await mkdir(projectDir, { recursive: true });
const studioProjectLink = resolve(repo, "packages/studio/data/projects", projectName);
await symlink(projectDir, studioProjectLink, "dir");
await writeFile(
  join(projectDir, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#07080b}.base{position:absolute;inset:0;display:grid;place-items:center;color:#556;font:700 42px system-ui}</style></head><body><main data-composition-id="main" data-duration="3" data-width="1280" data-height="720" data-no-timeline><section id="base" data-hf-id="hf-base" class="clip base" data-start="0" data-duration="3" data-track-index="0">DROP A FRAME HERE</section></main></body></html>`,
);

const localServer = caseName === "fixture" ? fixtureServer() : null;
let localServerListening = false;
let studio;
let browser;
let recorder;
const studioErrors = [];

try {
  if (localServer) {
    await new Promise((resolveListen) => localServer.listen(fixturePort, "0.0.0.0", resolveListen));
    localServerListening = true;
  }
  studio = await startStudio(projectDir);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    enableExtensions: [extensionDir],
    userDataDir: profileDir,
    defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 1 },
    args: ["--window-size=1440,960", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const extension = await waitFor(
    async () => {
      const extensions = [...(await browser.extensions()).values()];
      return extensions.find((candidate) => candidate.name === "HyperFrames Capture");
    },
    "installed HyperFrames extension",
    15_000,
  );

  const page = await browser.newPage();
  page.on("pageerror", (error) => {
    if (page.url().startsWith(`http://127.0.0.1:${studioPort}`)) {
      studioErrors.push(error.message);
    }
  });
  await browser
    .defaultBrowserContext()
    .overridePermissions(new URL(selectedCase.url).origin, ["clipboard-read", "clipboard-write"]);
  await browser
    .defaultBrowserContext()
    .overridePermissions(`http://127.0.0.1:${studioPort}`, ["clipboard-read", "clipboard-write"]);
  recorder = await page.screencast({
    path: join(outputRoot, `${caseName}.webm`),
    fps: 30,
    ffmpegPath,
  });

  await page.goto(selectedCase.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(selectedCase.selector, { visible: true, timeout: 60_000 });
  await page.waitForFunction(selectedCase.ready, { timeout: 60_000 });
  await page.$eval(selectedCase.selector, (element) =>
    element.scrollIntoView({ block: "center", inline: "center" }),
  );
  const sourceTarget = await page.$(selectedCase.selector);
  if (!sourceTarget) throw new Error(`Target disappeared: ${selectedCase.selector}`);
  const visualBytes = await waitFor(
    async () => {
      const screenshot = await sourceTarget.screenshot({ type: "png" });
      return screenshot.byteLength >= selectedCase.minimumVisualBytes ? screenshot.byteLength : 0;
    },
    "non-blank target pixels",
    60_000,
  );
  await sourceTarget.screenshot({ path: join(outputRoot, "00-target.png") });
  await page.screenshot({ path: join(outputRoot, "01-source.png") });

  await page.triggerExtensionAction(extension);
  await page.waitForSelector("[data-hyperframes-capture]", { timeout: 15_000 });
  const target = await page.$(selectedCase.selector);
  if (!target) throw new Error(`Target disappeared: ${selectedCase.selector}`);
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Target has no visible bounds.");
  const pickPoint = selectedCase.pickPoint ?? { x: 0.5, y: 0.5 };
  const center = {
    x: bounds.x + bounds.width * pickPoint.x,
    y: bounds.y + bounds.height * pickPoint.y,
  };
  await page.mouse.move(center.x, center.y, {
    steps: 24,
  });
  const requestedSignature = await page.$eval(selectedCase.selector, (element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  await waitFor(
    async () => {
      const candidate = await page.$eval("[data-hyperframes-capture]", (host) => ({
        tag: host.getAttribute("data-hyperframes-candidate-tag"),
        id: host.getAttribute("data-hyperframes-candidate-id"),
        left: Number(host.getAttribute("data-hyperframes-candidate-left")),
        top: Number(host.getAttribute("data-hyperframes-candidate-top")),
        width: Number(host.getAttribute("data-hyperframes-candidate-width")),
        height: Number(host.getAttribute("data-hyperframes-candidate-height")),
      }));
      const exact = requestedSignature.id
        ? candidate.id === requestedSignature.id
        : candidate.tag === requestedSignature.tag &&
          Math.abs(candidate.left - requestedSignature.left) <= 1 &&
          Math.abs(candidate.top - requestedSignature.top) <= 1 &&
          Math.abs(candidate.width - requestedSignature.width) <= 1 &&
          Math.abs(candidate.height - requestedSignature.height) <= 1;
      if (exact) return true;
      await page.keyboard.press("ArrowUp");
      return false;
    },
    "picker to reach the exact requested element",
    10_000,
  );
  await page.screenshot({ path: join(outputRoot, "02-picker.png") });
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => {
      const state = document
        .querySelector("[data-hyperframes-capture]")
        ?.getAttribute("data-hyperframes-capture-state");
      return state === "locked" || state === "failed";
    },
    { timeout: 60_000 },
  );
  const captureState = await page.$eval("[data-hyperframes-capture]", (host) => ({
    state: host.getAttribute("data-hyperframes-capture-state"),
    message: host.getAttribute("data-hyperframes-failure-message"),
  }));
  if (captureState.state !== "locked") {
    throw new Error(`Extension capture failed before lock: ${JSON.stringify(captureState)}`);
  }
  const lockedContract = await page.$eval("[data-hyperframes-capture]", (host) => ({
    artifactKind: host.getAttribute("data-hyperframes-artifact-kind"),
    fallbackCode: host.getAttribute("data-hyperframes-fallback-code"),
    serializerCode: host.getAttribute("data-hyperframes-serializer-code"),
    serializerActual: host.getAttribute("data-hyperframes-serializer-actual"),
    modelIslands: Number(host.getAttribute("data-hyperframes-model-islands")),
  }));
  if (lockedContract.artifactKind !== "editable-dom") {
    throw new Error(
      `Picker locked ${lockedContract.artifactKind ?? "unknown"} instead of editable-dom: ${lockedContract.serializerCode ?? lockedContract.fallbackCode ?? "no reason"} (${lockedContract.serializerActual ?? "unknown"}).`,
    );
  }
  if (selectedCase.expectsModel && lockedContract.modelIslands !== 1) {
    throw new Error(
      `Expected one localized model island, received ${lockedContract.modelIslands}.`,
    );
  }
  await page.screenshot({ path: join(outputRoot, "03-locked.png") });
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-hyperframes-capture-state="copied"]', { timeout: 15_000 });
  await page.screenshot({ path: join(outputRoot, "03b-copied.png") });

  try {
    await page.goto(`http://127.0.0.1:${studioPort}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(
      `Studio became unavailable before paste: ${error instanceof Error ? error.message : String(error)}\n${studio.log()}`,
    );
  }
  await page.waitForSelector('[data-testid="preview-zoom-stage"]', {
    visible: true,
    timeout: 60_000,
  });
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  const clipboardEnvelope = clipboardText.startsWith("hyperframes-web-capture\n")
    ? JSON.parse(clipboardText.slice("hyperframes-web-capture\n".length))
    : null;
  if (clipboardEnvelope?.artifact?.kind !== "editable-dom") {
    throw new Error(
      `Expected editable-dom clipboard artifact, received ${clipboardEnvelope?.artifact?.kind ?? "unreadable"}.`,
    );
  }
  if (!selectedCase.expectsModel) {
    await writeFile(join(outputRoot, "clipboard-artifact.html"), clipboardEnvelope.artifact.html);
  }
  if (!clipboardEnvelope.artifact.html.includes("data-hf-captured-tag")) {
    throw new Error("Editable artifact contains no exposed DOM nodes beyond opaque islands.");
  }
  await page.evaluate(() => {
    window.__hyperframesE2ePasteEvents = 0;
    window.addEventListener(
      "paste",
      () => {
        window.__hyperframesE2ePasteEvents += 1;
      },
      true,
    );
  });
  await dispatchNativePaste(page);
  const files = await waitFor(
    async () => {
      const alert = await page
        .$eval('[role="alert"]', (element) => element.textContent?.trim() ?? "")
        .catch(() => "");
      if (alert) throw new Error(`Studio rejected browser capture: ${alert}`);
      return projectFiles(projectDir);
    },
    "persisted parent and child files",
    45_000,
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
  const pasteEvents = await page.evaluate(() => window.__hyperframesE2ePasteEvents);
  if (pasteEvents !== 1) {
    throw new Error(`Expected one native paste event, received ${pasteEvents}.`);
  }
  await page.screenshot({ path: join(outputRoot, "04-studio-pasted.png") });

  let modelProof = null;
  if (selectedCase.expectsModel) {
    const beforeBytes = await screenshotLoadedModelViewer(
      page,
      join(outputRoot, "04a-model-before-camera-edit.png"),
      "stable rendered local 3D model",
    );

    const externalRequests = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (/^(?:data|blob):/.test(url) || url.startsWith(`http://127.0.0.1:${studioPort}`)) {
        void request.continue();
      } else {
        externalRequests.push(url);
        void request.abort();
      }
    });
    const editedChild = files.child
      .toString()
      .replace('camera-orbit="45deg 65deg auto"', 'camera-orbit="135deg 65deg auto"');
    if (editedChild === files.child.toString()) {
      throw new Error("Editable camera orbit attribute was not present in the imported child.");
    }
    await writeFile(files.childPath, editedChild);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="preview-zoom-stage"]', {
      visible: true,
      timeout: 60_000,
    });
    const afterBytes = await screenshotLoadedModelViewer(
      page,
      join(outputRoot, "04b-model-after-camera-edit-offline.png"),
      "stable offline 3D model after camera edit",
    );
    if (sha256(beforeBytes) === sha256(afterBytes)) {
      throw new Error(
        "Changing the editable camera orbit did not change the rendered model pixels.",
      );
    }
    if (externalRequests.length > 0) {
      throw new Error(
        `Offline model reload attempted external URLs: ${externalRequests.join(", ")}`,
      );
    }
    modelProof = {
      localizedModels: clipboardEnvelope.resources.filter((resource) => resource.kind === "model")
        .length,
      cameraOrbitBefore: "45deg 65deg auto",
      cameraOrbitAfter: "135deg 65deg auto",
      beforeSha256: sha256(beforeBytes),
      afterSha256: sha256(afterBytes),
      externalRequests: [],
    };
  }

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="preview-zoom-stage"]', {
    visible: true,
    timeout: 60_000,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
  if (await page.$('[data-testid="composition-preview-error"]')) {
    throw new Error("Studio shows a composition preview error after reload.");
  }
  if (studioErrors.length) throw new Error(`Studio page errors: ${studioErrors.join(" | ")}`);
  await page.screenshot({ path: join(outputRoot, "05-studio-reloaded.png") });

  await recorder.stop();
  recorder = null;
  const evidence = {
    case: caseName,
    sourceUrl: selectedCase.url,
    selector: selectedCase.selector,
    visualReadiness: { targetPngBytes: visualBytes },
    extension: { id: extension.id, name: extension.name },
    clipboard: {
      transport: "OS clipboard -> Chrome Paste command -> native ClipboardEvent",
      nativePasteEvents: pasteEvents,
      artifactKind: clipboardEnvelope.artifact.kind,
      opaqueIslands: clipboardEnvelope.resources.filter((resource) => resource.kind === "image")
        .length,
      modelIslands: clipboardEnvelope.resources.filter((resource) => resource.kind === "model")
        .length,
      editableHtmlBytes: Buffer.byteLength(clipboardEnvelope.artifact.html),
      diagnosticRead: clipboardText.startsWith("hyperframes-web-capture\n")
        ? { route: "hyperframes-web-capture", bytes: Buffer.byteLength(clipboardText) }
        : "unavailable in headless Chrome",
    },
    persisted: [
      { path: "index.html", bytes: files.parent.byteLength, sha256: sha256(files.parent) },
      { path: files.relativeChild, bytes: files.child.byteLength, sha256: sha256(files.child) },
      ...(files.runtime && files.runtimeRelativePath
        ? [
            {
              path: files.runtimeRelativePath,
              bytes: files.runtime.byteLength,
              sha256: sha256(files.runtime),
            },
          ]
        : []),
    ],
    editability: {
      childContainsCapturedDom: files.child.toString().includes("data-hf-captured-tag"),
      childContainsRemoteUrls: /(?:src|href)=["']https?:/i.test(files.child.toString()),
      trusted3dRuntimeIsProjectLocal: selectedCase.expectsModel
        ? files.runtimeRelativePath?.startsWith("assets/") === true
        : null,
    },
    reload: { previewError: false, pageErrors: [] },
    modelProof,
  };
  await writeFile(join(outputRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (recorder) await recorder.stop().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (studio) await stopStudio(studio.child);
  if (localServer && localServerListening) {
    await new Promise((resolveClose) => localServer.close(resolveClose));
  }
  await unlink(studioProjectLink).catch(() => undefined);
}
