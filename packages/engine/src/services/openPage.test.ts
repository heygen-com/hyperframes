import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { CdpPage } from "puppeteer-core/internal/cdp/Page.js";
import { TargetCloseError } from "puppeteer-core/internal/common/Errors.js";
import { openPage, PageTabLostError } from "./openPage.js";

/** A CDP session for a new tab; `closedDuringSetup` makes Page.getFrameTree fail as Chrome does when the tab closes. */
function tabSession(closedDuringSetup: boolean) {
  const target = {
    _targetId: "T",
    _targetManager: () => Object.assign(new EventEmitter(), { getChildTargets: () => [] }),
    _getTargetInfo: () => ({ targetId: "T", type: "page", url: "about:blank" }),
    _isClosedDeferred: { valueOrThrow: () => new Promise(() => {}) },
    browser: () => browserStub,
  };
  const session = Object.assign(new EventEmitter(), {
    id: () => "S",
    target: () => target,
    connection: () => ({ on() {}, off() {} }),
    parentSession: () =>
      Object.assign(new EventEmitter(), { target: () => target, send: async () => ({}) }),
    send: async (method: string) => {
      if (method !== "Page.getFrameTree") return {};
      if (closedDuringSetup)
        throw new TargetCloseError("Protocol error (Page.getFrameTree): Target closed");
      return {
        frameTree: { frame: { id: "T", loaderId: "L", url: "about:blank" }, childFrames: [] },
      };
    },
  });
  return { session, target };
}
const browserStub = { isNetworkEnabled: () => true, isIssuesEnabled: () => false };

/** A real puppeteer page for a tab that either closes during setup or comes up normally. */
async function cdpPage(closedDuringSetup: boolean): Promise<Page> {
  const { session, target } = tabSession(closedDuringSetup);
  return (await CdpPage._create(session as never, target as never, null, () => undefined)) as Page;
}

function browserWith(
  pages: Array<() => Promise<Page>>,
  state: { connected: boolean; exitCode?: number },
) {
  const opened: Page[] = [];
  const browser = {
    get connected() {
      return state.connected;
    },
    process: () => ({ exitCode: state.exitCode ?? null, signalCode: null, pid: 1 }),
    newPage: vi.fn(async () => {
      const page = await pages[opened.length]!();
      vi.spyOn(page, "close").mockResolvedValue();
      opened.push(page);
      return page;
    }),
  };
  return { browser: browser as unknown as Browser, opened };
}

describe("openPage", () => {
  it("puppeteer resolves a tab that closed during setup with no main frame", async () => {
    const page = await cdpPage(true);
    expect(() => page.mainFrame()).toThrow("Requesting main frame too early!");
  });

  it("opens one more page when the first tab closed during setup and the browser still runs", async () => {
    const { browser, opened } = browserWith([() => cdpPage(true), () => cdpPage(false)], {
      connected: true,
    });

    const page = await openPage(browser);

    expect(page).toBe(opened[1]);
    expect(page.mainFrame().url()).toBe("about:blank");
    expect(opened[0]!.close).toHaveBeenCalled();
  });

  it("names a tab that closed twice while the browser still runs", async () => {
    const { browser, opened } = browserWith([() => cdpPage(true), () => cdpPage(true)], {
      connected: true,
    });

    const error = await openPage(browser).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PageTabLostError);
    expect((error as PageTabLostError).browserRunning).toBe(true);
    expect((error as Error).message).toContain("the browser is still running");
    expect(opened.every((page) => vi.mocked(page.close).mock.calls.length === 1)).toBe(true);
  });

  it("never opens another page in a browser that exited, and names its exit code", async () => {
    const state = { connected: true, exitCode: undefined as number | undefined };
    const { browser } = browserWith(
      [
        async () => {
          Object.assign(state, { connected: false, exitCode: 137 });
          return cdpPage(true);
        },
      ],
      state,
    );

    const error = await openPage(browser).catch((e: unknown) => e);

    expect((error as Error).message).toBe(
      "Chrome exited while opening a render page (exit code 137, signal none)",
    );
    expect((error as PageTabLostError).browserRunning).toBe(false);
    expect(browser.newPage).toHaveBeenCalledTimes(1);
  });

  // fails without the fix: reads child.exitCode before Node's exit event lands, reporting "exit code unknown".
  it("waits briefly for a real Chrome child process to finish exiting so its exit code is reported", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.stdin.resume(); process.stdout.write("ready\\n"); process.stdin.on("end", () => process.exit(42));',
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    try {
      await new Promise<void>((resolve) => child.stdout!.once("data", () => resolve()));
      let connected = true;
      const browser = {
        get connected() {
          return connected;
        },
        process: () => child,
        newPage: vi.fn(async () => {
          connected = false;
          child.stdin!.end();
          const page = await cdpPage(true);
          vi.spyOn(page, "close").mockResolvedValue();
          return page;
        }),
      } as unknown as Browser;

      const error = await openPage(browser).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PageTabLostError);
      expect((error as Error).message).toBe(
        "Chrome exited while opening a render page (exit code 42, signal none)",
      );
      expect(child.listenerCount("exit")).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  it("reports a delayed signal exit and cleans up its exit listener when Chrome hangs", async () => {
    vi.useFakeTimers();
    try {
      const signalled = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
      });
      const browserWithSignal = {
        connected: false,
        process: () => signalled,
        newPage: vi.fn(async () => {
          setTimeout(() => {
            signalled.signalCode = "SIGKILL";
            signalled.emit("exit", null, "SIGKILL");
          }, 50);
          const page = await cdpPage(true);
          vi.spyOn(page, "close").mockResolvedValue();
          return page;
        }),
      } as unknown as Browser;

      const sigPending = openPage(browserWithSignal).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(50);
      const sigErr = await sigPending;
      expect((sigErr as Error).message).toBe(
        "Chrome exited while opening a render page (exit code unknown, signal SIGKILL)",
      );
      expect(signalled.listenerCount("exit")).toBe(0);

      const hung = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
      });
      const browserHung = {
        connected: false,
        process: () => hung,
        newPage: vi.fn(async () => {
          const page = await cdpPage(true);
          vi.spyOn(page, "close").mockResolvedValue();
          return page;
        }),
      } as unknown as Browser;

      const pending = openPage(browserHung).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      const hungErr = await pending;
      expect((hungErr as Error).message).toBe(
        "Chrome exited while opening a render page (exit code unknown, signal none)",
      );
      expect(hung.listenerCount("exit")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
