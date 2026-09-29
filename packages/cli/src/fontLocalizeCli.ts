// fallow-ignore-file unused-file
import { injectDeterministicFontFaces } from "@hyperframes/producer";
import { runFontLocalize, stampFontVersions } from "./fontLocalize.js";
import { PRODUCER_VERSION, VERSION } from "./version.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Standalone-entry main; the bin wrapper owns the actual process exit code. */
export async function main(): Promise<number> {
  return runFontLocalize(
    {
      readInput: readStdin,
      writeOutput: (value) => process.stdout.write(value),
      writeError: (value) => process.stderr.write(value),
    },
    async (html) => {
      const localized = await injectDeterministicFontFaces(html, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
      });
      return stampFontVersions(localized, {
        producer: PRODUCER_VERSION,
        localizer: VERSION,
      });
    },
  );
}
