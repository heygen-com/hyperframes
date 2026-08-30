import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the server answered for the captured page, written beside the extraction.
 *
 * A capture that renders is not the same fact as a capture that succeeded: an error page has a
 * title, colors, typefaces and a DOM, so every extractor downstream reads it happily and produces
 * a design system belonging to whoever wrote the error page. `detectBlockedPage` cannot answer
 * this — it decides whether the page LOOKS like a protection wall, which is a heuristic over the
 * rendered document, and a rich 404 passes it. So the status is persisted as its own plain fact
 * and consumers decide for themselves what a non-success response means for their product.
 */
export const RESPONSE_RECORD_FILENAME = "response.json";

export interface CaptureResponseRecord {
  /**
   * The final response's status after redirects, or null when navigation produced no response at
   * all. Null is NOT "fine": it means we never learned what the server said, which is a different
   * fact from a 200 and from a 404, and a consumer must be able to tell the three apart.
   */
  status: number | null;
}

/** Writes the record into an already-created `extracted/` directory. */
export function writeResponseRecord(extractedDir: string, record: CaptureResponseRecord): void {
  writeFileSync(
    join(extractedDir, RESPONSE_RECORD_FILENAME),
    JSON.stringify(record, null, 2),
    "utf-8",
  );
}
