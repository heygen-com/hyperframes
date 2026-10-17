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
