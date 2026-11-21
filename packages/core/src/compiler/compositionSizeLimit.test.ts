// @vitest-environment node
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertCompositionFileSize,
  CompositionExpansionBudget,
  MAX_COMPOSITION_HTML_BYTES,
  MAX_EXPANDED_COMPOSITION_BYTES,
  MAX_EXPANDED_ELEMENTS,
} from "./compositionSizeLimit";

const dir = mkdtempSync(join(tmpdir(), "hf-size-limit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const label = "scene\x1b[2J\x07\u009b\x7f.html";
const shown = '"scene\\x1b[2J\\x07\\x9b\\x7f.html"';

const messageOf = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("composition size limit messages", () => {
  it.each([
    [
      "one file over the file limit",
      () => {
        const path = join(dir, "big.html");
        writeFileSync(path, "");
        truncateSync(path, MAX_COMPOSITION_HTML_BYTES + 1);
        assertCompositionFileSize(path, label);
      },
    ],
    [
      "mounts over the byte limit",
      () => new CompositionExpansionBudget().charge(label, MAX_EXPANDED_COMPOSITION_BYTES + 1),
    ],
    [
      "mounts over the element limit",
      () => new CompositionExpansionBudget().chargeElements(label, MAX_EXPANDED_ELEMENTS + 1),
    ],
    [
      "generated text over the byte limit",
      () =>
        new CompositionExpansionBudget().chargeGenerated(label, MAX_EXPANDED_COMPOSITION_BYTES + 1),
    ],
  ])("show control characters in the file label as text: %s", (_name, run) => {
    const message = messageOf(run);
    expect(message).toContain(shown);
    // eslint-disable-next-line no-control-regex
    expect(message).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/);
  });
});
