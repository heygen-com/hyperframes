// @vitest-environment happy-dom

/**
 * "Edit with Framey": shown where the preview server has the app or its download to offer. Every Studio open shows a
 * card under it with one action that ends in the app: open the project there, or download the app and open the
 * project once it is installed. Where the app cannot take a project yet, the action is the download alone.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const showToast = vi.fn();
const trackStudioEvent = vi.fn();
vi.mock("../contexts/StudioContext", () => ({ useStudioShellContext: () => ({ showToast }) }));
vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent }));

const { OpenInDesktopButton } = await import("./OpenInDesktopButton");

const DOWNLOAD = "https://hyperframes.dev/studio/download";
const OPENED = { opened: true, app: "the HyperFrames desktop app" };
let mounted: { root: Root; host: HTMLElement } | null = null;
let posts: number;

type RouteBody = {
  available: boolean;
  handoff: boolean;
  downloadUrl: string | null;
  installed?: boolean;
};

/** Each GET answers with the next body (the last one repeats); null answers 404, as the app's own Studio does. */
function serve(gets: (RouteBody | null)[], post?: unknown) {
  posts = 0;
  let asked = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return Response.json(post);
      }
      const body = gets[Math.min(asked++, gets.length - 1)];
      return body ? Response.json(body) : new Response("Not found", { status: 404 });
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

const button = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="header-open-in-desktop"]');

const cardAction = () =>
  [...document.querySelectorAll<HTMLElement>("a, button")].find(
    (el) =>
      el !== button() &&
      (el.textContent === "Open in HyperFrames" || el.textContent === "Download HyperFrames"),
  );

beforeEach(() => {
  showToast.mockReset();
  trackStudioEvent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

it("stays hidden where the server has no hand-off (the desktop's own Studio)", async () => {
  serve([null]);
  await mount();
  expect(button()).toBeNull();
  expect(document.body.textContent).not.toContain("Keep editing with Framey");
});

it("stays hidden when the app has no build for this machine (Windows)", async () => {
  serve([{ available: false, handoff: true, downloadUrl: null }]);
  await mount();
  expect(button()).toBeNull();
});

it("with the app installed but no download (Windows), shows only once the app can take the project", async () => {
  serve([{ available: true, handoff: false, downloadUrl: null, installed: true }]);
  await mount();
  expect(button()).toBeNull();
});

it("shows the card on its own as Studio opens, with one action and no way to put it off", async () => {
  serve([{ available: true, handoff: true, downloadUrl: DOWNLOAD, installed: true }]);
  await mount();
  expect(document.body.textContent).toContain("Keep editing with Framey");
  expect(cardAction()?.textContent).toBe("Open in HyperFrames");
  expect(document.body.textContent).not.toContain("Not now");
  expect(trackStudioEvent).toHaveBeenCalledWith("desktop_card_shown", {
    trigger: "auto",
    state: "open",
  });
});

it("opens the project in an installed app from the card and says so", async () => {
  serve([{ available: true, handoff: true, downloadUrl: DOWNLOAD, installed: true }], OPENED);
  await mount();
  await act(async () => cardAction()!.click());
  expect(posts).toBe(1);
  expect(showToast).toHaveBeenCalledWith(
    "Framey is opening this project in the HyperFrames desktop app",
    "info",
  );
  expect(button()!.dataset.opening).toBe("true");
  expect(document.body.textContent).not.toContain("Keep editing with Framey");
});

it("opens the project straight from the header button once the app is installed", async () => {
  serve([{ available: true, handoff: true, downloadUrl: null, installed: true }], OPENED);
  await mount();
  await act(async () => button()!.click());
  expect(posts).toBe(1);
});

it("without the app, downloads it from the card and opens the project once it is installed", async () => {
  vi.useFakeTimers();
  const missing = { available: true, handoff: true, downloadUrl: DOWNLOAD, installed: false };
  serve([missing, missing, { ...missing, installed: true }], OPENED);
  await mount();
  const action = cardAction()!;
  expect(action.textContent).toBe("Open in HyperFrames");
  expect(action.getAttribute("href")).toBe(`${DOWNLOAD}?ref=studio`);

  await act(async () => action.click());
  expect(document.querySelector('[data-testid="desktop-card-installing"]')).not.toBeNull();
  expect(posts).toBe(0);

  await act(async () => vi.advanceTimersByTimeAsync(3000)); // still missing
  expect(posts).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(3000)); // installed
  expect(posts).toBe(1);
  expect(trackStudioEvent).toHaveBeenCalledWith("desktop_open_result", {
    trigger: "after_install",
    result: "opened",
  });
  expect(showToast).toHaveBeenCalledWith(
    "Framey is opening this project in the HyperFrames desktop app",
    "info",
  );
});

it("where the app cannot take a project yet (Linux), offers only the download and opens nothing", async () => {
  const linux = `${DOWNLOAD}?os=linux`;
  serve([{ available: true, handoff: false, downloadUrl: linux, installed: false }], OPENED);
  await mount();
  const action = cardAction()!;
  expect(action.textContent).toBe("Download HyperFrames");
  expect(action.getAttribute("href")).toBe(`${linux}&ref=studio`);
  await act(async () => action.click());
  expect(posts).toBe(0);
});

it("offers the download again when the app went missing since Studio asked", async () => {
  serve([{ available: true, handoff: true, downloadUrl: DOWNLOAD, installed: true }], {
    opened: false,
    reason: "not-installed",
    downloadUrl: DOWNLOAD,
  });
  await mount();
  await act(async () => cardAction()!.click());
  expect(showToast).not.toHaveBeenCalled();
  expect(cardAction()?.getAttribute("href")).toBe(`${DOWNLOAD}?ref=studio`);
});
