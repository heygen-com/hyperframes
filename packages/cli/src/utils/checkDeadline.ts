import type { Browser, Page } from "puppeteer-core";
import { normalizeErrorMessage } from "./errorMessage.js";
import { withRemainingBudget } from "../capture/captureTimeout.js";
import { BrowserCleanupError, closeManagedBrowser } from "../browser/launch.js";
import type { CheckBrowserResult } from "./checkTypes.js";

const CHECK_IDLE_MS = 120_000;

export const idleWindow = (timeoutMs: number): number =>
  Math.max(CHECK_IDLE_MS, timeoutMs + 10_000);
const SCRIPT_START = "[hyperframes:script:start] ";
const SCRIPT_FINISH = "[hyperframes:script:finish] ";

const PHASE_LABELS = {
  copies: "making video copies",
  launch: "starting Chrome",
  load: "loading the page",
  settle: "waiting for the page to be ready",
  samples: "checking samples",
  overlap: "running the overlap pass",
  crops: "capturing finding crops",
  frames: "capturing finding frames",
} as const;
export type CheckPhase = keyof typeof PHASE_LABELS;
const BEFORE_DEADLINE: ReadonlySet<CheckPhase> = new Set(["copies", "launch"]);

export class CheckDeadlineError extends Error {
  constructor(
    readonly sourceFile?: string,
    phases = "",
  ) {
    super(
      (sourceFile === undefined
        ? "Check did not finish within its deadline"
        : `${sourceFile}: its script did not finish within the check deadline`) + (phases || "."),
    );
  }
}

export class CheckStoppedError extends Error {
  constructor(signal: string) {
    super(`Check stopped before finishing (${signal}).`);
  }
}

/** Ends a check that makes no progress for its idle window; each phase entered or operation settled restarts it. */
export class CheckDeadline {
  private readonly abort = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  readonly signal = this.abort.signal;
  private readonly browsers = new Set<Browser>();
  private readonly scripts: string[] = [];
  private expired: Error | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly expiry: Promise<never>;
  private rejectExpiry!: (error: Error) => void;
  private phase: "waiting" | "started" | "closed" = "waiting";
  private work: { phase: CheckPhase; since: number; detail?: string } | undefined;
  private readonly spent = new Map<CheckPhase, number>();
  private readonly partials: Array<() => Partial<CheckBrowserResult>> = [];

  constructor(private readonly idleMs = CHECK_IDLE_MS) {
    this.expiry = new Promise((_, reject) => {
      this.rejectExpiry = reject;
    });
  }

  keepPartial = (read: () => Partial<CheckBrowserResult>): void => {
    this.partials.push(read);
  };

  partialResult(): Partial<CheckBrowserResult> {
    return Object.assign({}, ...this.partials.map((read) => read()));
  }

  enter = (phase: CheckPhase, detail?: string): void => {
    if (this.expired) return;
    const now = Date.now();
    if (this.work) this.spend(this.work.phase, now - this.work.since);
    this.work = { phase, since: now, detail };
    this.spend(phase, 0);
    this.rearm();
  };

  private spend(phase: CheckPhase, ms: number): void {
    this.spent.set(phase, (this.spent.get(phase) ?? 0) + ms);
  }

  private describe(): string {
    if (!this.work) return "";
    const open = Date.now() - this.work.since;
    const parts = [...this.spent].map(([phase, ms]) => {
      const seconds = ((phase === this.work?.phase ? ms + open : ms) / 1000).toFixed(1);
      return `${PHASE_LABELS[phase]} ${seconds}${BEFORE_DEADLINE.has(phase) ? " (before the deadline)" : ""}`;
    });
    return ` (no progress for ${this.idleMs / 1000} s after Chrome was ready), while ${PHASE_LABELS[this.work.phase]}${this.work.detail ? ` (${this.work.detail})` : ""}. Seconds per phase: ${parts.join(", ")}.`;
  }

  start = (): void => {
    if (this.phase !== "waiting") return;
    this.phase = "started";
    this.enter("load");
  };

  private rearm(): void {
    if (this.phase !== "started" || this.expired) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.expire(new CheckDeadlineError(this.scripts.at(-1), this.describe())),
      this.idleMs,
    );
  }

  private expire(error: Error): void {
    clearTimeout(this.timer);
    this.expired = error;
    this.rejectExpiry(error);
    this.abort.abort(error);
  }

  stop = (signal: string): void => {
    if (this.expired || this.phase === "closed") return;
    this.expire(new CheckStoppedError(signal));
  };

  ownBrowser = (browser: Browser): void => {
    if (this.expired) throw this.expired;
    if (this.phase === "closed") throw new Error("Check has already finished.");
    this.browsers.add(browser);
  };

  async preparePage(page: Page): Promise<void> {
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith(SCRIPT_START)) this.scripts.push(text.slice(SCRIPT_START.length));
      if (text.startsWith(SCRIPT_FINISH)) {
        const index = this.scripts.lastIndexOf(text.slice(SCRIPT_FINISH.length));
        if (index !== -1) this.scripts.splice(index, 1);
      }
    });
    await page.evaluateOnNewDocument(
      (start, finish) => {
        Reflect.set(window, "__hfScriptState", (phase: "start" | "finish", source: string) => {
          console.debug((phase === "start" ? start : finish) + source);
        });
      },
      SCRIPT_START,
      SCRIPT_FINISH,
    );
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.expired) return Promise.reject(this.expired);
    const pending = operation();
    this.operations.add(pending);
    const settled = (): void => this.rearm();
    pending.then(settled, settled);
    return Promise.race([pending, this.expiry]);
  }

  async close(): Promise<void> {
    this.phase = "closed";
    clearTimeout(this.timer);
    const closes = await Promise.allSettled([...this.browsers].map(closeManagedBrowser));
    const errors = closes
      .filter((entry) => entry.status === "rejected")
      .map((entry) => entry.reason);
    try {
      const drained = await withRemainingBudget(
        Promise.allSettled(this.operations),
        1_000,
        "draining check cleanup",
      );
      for (const entry of drained) {
        if (entry.status === "rejected" && entry.reason instanceof BrowserCleanupError)
          errors.push(entry.reason);
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0)
      throw new BrowserCleanupError(errors, errors.map(normalizeErrorMessage).join("; "));
  }
}
