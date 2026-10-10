import { afterEach, expect, it, vi } from "vitest";
import { resolveProjectMock, runAndCaptureStdio } from "./deprecationTestHarness.js";

const browser = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  newPage: vi.fn(async () => ({
    setViewport: async () => undefined,
    on: () => undefined,
    goto: async () => undefined,
    evaluate: async () => undefined,
  })),
}));

vi.mock("../utils/project.js", () => resolveProjectMock());
vi.mock("../utils/lintProject.js", () => ({ lintProject: async () => ({ results: [] }) }));
vi.mock("../utils/producer.js", () => ({
  loadProducer: async () => {
    const keep = async (html: string) => ({ html, remoteMediaAssets: new Map() });
    return {
      localizeRemoteMediaSources: keep,
      localizeRemoteImageSources: keep,
      localizeRemoteFontFaces: keep,
    };
  },
}));
vi.mock("@hyperframes/core/compiler", () => ({
  bundleToSingleHtml: async () => '<div data-composition-id="main"></div>',
}));
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  buildChromeArgs: () => [],
}));
vi.mock("../browser/manager.js", () => ({
  ensureBrowser: async () => ({ executablePath: "/chrome" }),
}));
vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: async () => ({ url: "http://127.0.0.1:1/", close: async () => {} }),
}));
vi.mock("../browser/launch.js", () => ({
  launchManagedBrowser: async () => browser,
  resolveManagedGpuMode: async () => "software",
}));
vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  installPageFunctionGuard: async () => undefined,
  waitForRuntimeReady: async () => {
    throw new Error("HyperFrames runtime failed: Error: boom.");
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("closes the browser when the runtime fails to start, so validate exits", async () => {
  const { default: validateCommand } = await import("./validate.js");

  const { stdoutText } = await runAndCaptureStdio(validateCommand);

  expect(stdoutText + JSON.stringify(vi.mocked(console.log).mock.calls)).toContain(
    "HyperFrames runtime failed",
  );
  expect(browser.close).toHaveBeenCalled();
});
