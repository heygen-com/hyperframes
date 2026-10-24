// The WebDriver pieces both bench scripts share: which driver runs each browser, and a minimal client.
import { spawn, type ChildProcess } from "node:child_process";

export type Browser = "safari" | "chrome";

export const DRIVERS: Record<
  Browser,
  { cmd: string; args: (port: number) => string[]; caps: object; procs: RegExp }
> = {
  safari: {
    cmd: "safaridriver",
    args: (port) => ["-p", String(port)],
    caps: { browserName: "safari" },
    procs: /\/(?:com\.apple\.WebKit\.\w+|Safari)$/,
  },
  chrome: {
    cmd: process.env.CHROMEDRIVER ?? "chromedriver",
    args: (port) => [`--port=${port}`],
    caps: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
      },
    },
    procs: /Google Chrome|Chromium/,
  },
};

export async function wd(base: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { value: any };
  if (!res.ok || json.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 600)}`);
  }
  return json.value;
}

export async function startDriver(browser: Browser, port: number): Promise<ChildProcess> {
  const spec = DRIVERS[browser];
  const proc = spawn(spec.cmd, spec.args(port), { stdio: "inherit" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await wd(`http://127.0.0.1:${port}`, "GET", "/status")).ready) return proc;
    } catch {}
    await Bun.sleep(200);
  }
  proc.kill();
  throw new Error(`${spec.cmd} did not become ready on port ${port}`);
}
