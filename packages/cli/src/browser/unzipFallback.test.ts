import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform, install } from "@puppeteer/browsers";
import AdmZip from "adm-zip";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Windows unzips with tar.exe by absolute path, so an empty PATH only hides `unzip` elsewhere.
it.skipIf(process.platform === "win32")(
  "unpacks the browser download on a machine without an unzip command",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-unzip-fallback-"));
    const platform = detectBrowserPlatform();
    if (!platform) throw new Error("unsupported test platform");
    const cacheDir = join(root, "cache");
    const options = { cacheDir, browser: Browser.CHROMEHEADLESSSHELL, buildId: "1.0.0", platform };
    const executablePath = computeExecutablePath(options);
    const archive = new AdmZip();
    archive.addFile(
      relative(join(cacheDir, Browser.CHROMEHEADLESSSHELL, `${platform}-1.0.0`), executablePath),
      Buffer.from("browser"),
    );
    const zipBytes = archive.toBuffer();
    const server = createServer((_request, response) => response.end(zipBytes));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    vi.stubEnv("PATH", join(root, "empty-bin"));
    try {
      const { port } = server.address() as AddressInfo;

      await install({ ...options, baseUrl: `http://127.0.0.1:${port}` });

      expect(existsSync(executablePath)).toBe(true);
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
