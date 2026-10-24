import type { Server } from "node:http";
import puppeteer, { type Browser } from "puppeteer-core";

/** Listens on a free loopback port and returns the server's origin. */
export async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  return `http://127.0.0.1:${address.port}`;
}

export function launchTestChrome(executablePath: string | undefined): Promise<Browser> {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Closes a test Chrome, killing it when close hangs (seen on Windows runners) so afterAll never times out. */
export async function closeTestChrome(
  browser: Browser | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!browser) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    browser.close().then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => (timer = setTimeout(resolve, timeoutMs, false))),
  ]);
  clearTimeout(timer);
  if (closed) return;
  browser.process()?.kill("SIGKILL");
  await browser.disconnect().catch(() => undefined);
}
