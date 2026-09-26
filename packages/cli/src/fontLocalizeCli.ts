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

/**
 * Preview bundling is a best-effort preview, not a distributed render: it has no
 * byte-identical-output requirement across workers, so an unresolved font should
 * substitute (and log via warnUnresolvedFonts) rather than hard-fail the whole
 * activity. failClosedFontFetch=true is for the distributed-render compiler, where
 * non-deterministic substitution really would be a correctness bug.
 */
export async function localizeForPreviewBundle(html: string): Promise<string> {
  const localized = await injectDeterministicFontFaces(html, {
    failClosedFontFetch: false,
    allowSystemFontCapture: false,
  });
  return stampFontVersions(localized, {
    producer: PRODUCER_VERSION,
    localizer: VERSION,
  });
}

/** Standalone-entry main; the bin wrapper owns the actual process exit code. */
// fallow-ignore-next-line unused-export
export async function main(): Promise<number> {
  return runFontLocalize(
    {
      readInput: readStdin,
      writeOutput: (value) => process.stdout.write(value),
      writeError: (value) => process.stderr.write(value),
    },
    localizeForPreviewBundle,
  );
}
