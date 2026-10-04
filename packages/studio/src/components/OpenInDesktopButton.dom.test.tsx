// @vitest-environment happy-dom

/**
 * "Edit with Framey": shown where the preview server has the app or its download to offer; a press opens the project in the app,
 * or introduces Framey with the download while the app cannot take it or is missing.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const showToast = vi.fn();
vi.mock("../contexts/StudioContext", () => ({ useStudioShellContext: () => ({ showToast }) }));
vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const { OpenInDesktopButton } = await import("./OpenInDesktopButton");

const DOWNLOAD = "https://hyperframes.dev/studio/download";
let mounted: { root: Root; host: HTMLElement } | null = null;
let posts: number;

function serve(get: Response | null, post?: unknown) {
  posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return Response.json(post);
      }
      return get ?? new Response("Not found", { status: 404 });
    }),
  );
}

async function mount(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => root.render(<OpenInDesktopButton />));
  return host;
}

const downloadHref = () =>
  [...document.querySelectorAll("a")]
    .find((a) => a.textContent?.includes("Get HyperFrames Studio"))
    ?.getAttribute("href");

const button = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="header-open-in-desktop"]');

beforeEach(() => showToast.mockReset());

afterEach(() => {
  vi.unstubAllGlobals();
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

it("stays hidden where the server has no hand-off (the desktop's own Studio)", async () => {
  serve(null);
  await mount();
  expect(button()).toBeNull();
});

it("stays hidden when the app has no build for this machine (Windows)", async () => {
  serve(Response.json({ available: false, handoff: true, downloadUrl: null }));
  await mount();
  expect(button()).toBeNull();
});

it("with the app installed but no download (Windows), shows only once the app can take the project", async () => {
  serve(Response.json({ available: true, handoff: false, downloadUrl: null }));
  await mount();
  expect(button()).toBeNull();
});

it("opens the project in an installed app that has no download (Windows)", async () => {
  serve(Response.json({ available: true, handoff: true, downloadUrl: null }), {
    opened: true,
    app: "HyperFrames Studio",
  });
  await mount();
  await act(async () => button()!.click());
  expect(posts).toBe(1);
});

it("while the app cannot take a project yet, introduces Framey with the download and opens nothing", async () => {
  const linux = `${DOWNLOAD}?os=linux`;
  serve(Response.json({ available: true, handoff: false, downloadUrl: linux }), { opened: true });
  await mount();
  await act(async () => button()!.click());
  expect(posts).toBe(0);
  expect(document.body.textContent).toContain("Meet Framey");
  expect(downloadHref()).toBe(linux);
});

it("opens the project in the app and says so", async () => {
  serve(Response.json({ available: true, handoff: true, downloadUrl: DOWNLOAD }), {
    opened: true,
    app: "HyperFrames Studio",
  });
  await mount();
  await act(async () => button()!.click());
  expect(posts).toBe(1);
  expect(showToast).toHaveBeenCalledWith(
    "Framey is opening this project in HyperFrames Studio",
    "info",
  );
  expect(button()!.dataset.opening).toBe("true");
  expect(document.body.textContent).not.toContain("Meet Framey");
});

it("introduces Framey and offers the download when the app is missing", async () => {
  serve(Response.json({ available: true, handoff: true, downloadUrl: DOWNLOAD }), {
    opened: false,
    reason: "not-installed",
    downloadUrl: DOWNLOAD,
  });
  await mount();
  await act(async () => button()!.click());
  expect(showToast).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Meet Framey");
  expect(downloadHref()).toBe(DOWNLOAD);
});
