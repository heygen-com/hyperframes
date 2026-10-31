// fallow-ignore-file unused-file
import { ensureBrowser } from "./manager.js";

const [baseUrl, attempts] = process.argv.slice(2);
try {
  await ensureBrowser({
    preferManagedChrome: true,
    downloadStallMs: 200,
    downloadBaseUrl: baseUrl,
    ...(attempts ? { downloadAttempts: Number(attempts) } : {}),
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
