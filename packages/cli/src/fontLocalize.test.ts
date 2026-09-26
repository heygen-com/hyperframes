import { describe, expect, it, vi } from "vitest";
import { runFontLocalize, stampFontVersions, type FontLocalizeIo } from "./fontLocalize.js";

function makeIo(input: string): {
  io: FontLocalizeIo;
  output: string[];
  errors: string[];
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      readInput: async () => input,
      writeOutput: (value) => output.push(value),
      writeError: (value) => errors.push(value),
    },
    output,
    errors,
  };
}

// Shaped like the producer's FontFetchError: runFontLocalize reads only its
// class name and structured `unresolvedFamilies`, never the message.
class FontFetchLikeError extends Error {
  readonly unresolvedFamilies: readonly unknown[];

  constructor(message: string, unresolvedFamilies: readonly unknown[]) {
    super(message);
    this.name = "FontFetchError";
    this.unresolvedFamilies = unresolvedFamilies;
  }
}

describe("runFontLocalize", () => {
  it("writes only the localized document to stdout", async () => {
    const harness = makeIo("<html>source</html>");
    const localize = vi.fn(async () => "<html>localized</html>");

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(0);
    expect(localize).toHaveBeenCalledWith("<html>source</html>");
    expect(harness.output).toEqual(["<html>localized</html>"]);
    expect(harness.errors).toEqual([]);
  });

  it("rejects blank input without calling the resolver", async () => {
    const harness = makeIo("  \n");
    const localize = vi.fn(async (html: string) => html);

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(2);
    expect(localize).not.toHaveBeenCalled();
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("input is empty");
  });

  it("fails without echoing source HTML or resolver details", async () => {
    const source = '<html><img src="https://signed.example/secret"></html>';
    const harness = makeIo(source);
    const localize = vi.fn(async () => {
      throw new Error(`fetch failed for ${source}`);
    });

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(1);
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("font localization failed (Error)");
    expect(harness.errors.join(" ")).not.toContain("signed.example");
    expect(harness.errors.join(" ")).not.toContain("<html>");
  });

  it("names the unresolved font families after the unchanged failure prefix", async () => {
    const harness = makeIo("<html>source</html>");

    const exitCode = await runFontLocalize(harness.io, async () => {
      throw new FontFetchLikeError("unresolved", ["Foo Bar", "Baz"]);
    });

    expect(exitCode).toBe(1);
    expect(harness.errors).toEqual([
      'font localization failed (FontFetchError): unresolved font families: "Foo Bar", "Baz"\n',
    ]);
  });

  it("never echoes a URL or signed query from the error message", async () => {
    const harness = makeIo('<html><link href="https://fonts.example/css?sig=SECRETSIG"></html>');
    const message =
      "[Compiler] Unresolved fonts in fail-closed mode: Saira ExtraCondensed. " +
      "fetch https://fonts.googleapis.com/css2?family=Saira&X-Amz-Signature=SECRETSIG failed";

    await runFontLocalize(harness.io, async () => {
      throw new FontFetchLikeError(message, ["Saira ExtraCondensed"]);
    });

    const stderr = harness.errors.join("");
    expect(stderr).toBe(
      'font localization failed (FontFetchError): unresolved font families: "Saira ExtraCondensed"\n',
    );
    expect(stderr).not.toContain("SECRETSIG");
    expect(stderr).not.toContain("https://");
    expect(stderr).not.toContain("Unresolved fonts in fail-closed mode");
  });

  it("drops URL-shaped family names whole and strips other characters", async () => {
    const harness = makeIo("<html>source</html>");

    await runFontLocalize(harness.io, async () => {
      throw new FontFetchLikeError("unresolved", [
        "https://signed.example/font?token=SECRETTOKEN",
        'Evil"Name\n<script>',
        "Saira+ExtraCondensed",
        42,
      ]);
    });

    const stderr = harness.errors.join("");
    expect(stderr).toBe(
      'font localization failed (FontFetchError): unresolved font families: "Evil Name script", "Saira ExtraCondensed" (+2 more)\n',
    );
    expect(stderr).not.toContain("SECRETTOKEN");
    expect(stderr).not.toContain("signed");
  });

  it("caps each family name's length and the number of names", async () => {
    const harness = makeIo("<html>source</html>");
    const families = Array.from({ length: 11 }, (_, index) => `Family ${index}`);
    families[0] = "A".repeat(200);

    await runFontLocalize(harness.io, async () => {
      throw new FontFetchLikeError("unresolved", families);
    });

    const stderr = harness.errors.join("");
    expect(stderr).toContain(`"${"A".repeat(64)}", "Family 1"`);
    expect(stderr).not.toContain("A".repeat(65));
    expect(stderr).toContain('"Family 7" (+3 more)\n');
    expect(stderr).not.toContain("Family 8");
  });

  it("keeps the bare failure line when the error carries no family list", async () => {
    const harness = makeIo("<html>source</html>");

    await runFontLocalize(harness.io, async () => {
      throw new FontFetchLikeError("Google Fonts CSS returned HTTP 503", []);
    });

    expect(harness.errors).toEqual(["font localization failed (FontFetchError)\n"]);
  });

  it("fails closed when the resolver returns an empty document", async () => {
    const harness = makeIo("<html>source</html>");

    const exitCode = await runFontLocalize(harness.io, async () => "\n");

    expect(exitCode).toBe(1);
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("empty output");
  });
});

describe("stampFontVersions", () => {
  it("records producer and localizer versions inside the document head", () => {
    const stamped = stampFontVersions(
      "<!doctype html><html><head><title>x</title></head><body></body></html>",
      { producer: "0.8.15", localizer: "0.8.16" },
    );

    expect(stamped).toContain('<meta name="hyperframes-font-compiler-version" content="0.8.15">');
    expect(stamped).toContain('<meta name="hyperframes-font-localizer-version" content="0.8.16">');
    expect(stamped.indexOf("hyperframes-font-compiler-version")).toBeLessThan(
      stamped.indexOf("</head>"),
    );
  });

  it("inserts both diagnostic stamps after a doctype when no head close exists", () => {
    const stamped = stampFontVersions("<!doctype html><main>x</main>", {
      producer: "0.8.15",
      localizer: "0.8.16",
    });

    expect(stamped).toMatch(
      /^<!doctype html><meta name="hyperframes-font-compiler-version" content="0\.8\.15"><meta name="hyperframes-font-localizer-version" content="0\.8\.16">/,
    );
  });

  it("inserts both diagnostic stamps at the start when no head or doctype exists", () => {
    const stamped = stampFontVersions("<main>x</main>", {
      producer: "0.8.15<script>",
      localizer: "0.8.16<script>",
    });

    expect(stamped).toBe(
      '<meta name="hyperframes-font-compiler-version" content="0.8.15script"><meta name="hyperframes-font-localizer-version" content="0.8.16script"><main>x</main>',
    );
  });
});
