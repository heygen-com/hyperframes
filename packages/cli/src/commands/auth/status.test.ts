import { describe, expect, it } from "vitest";
import {
  buildUnconfiguredJson,
  buildUnconfiguredLines,
  type OfflineEngineLine,
  type UnconfiguredContext,
} from "./status-guidance.js";

const INTERACTIVE: UnconfiguredContext = { interactive: true };
const NON_INTERACTIVE: UnconfiguredContext = { interactive: false };

function joined(ctx: UnconfiguredContext, engines?: OfflineEngineLine[]): string {
  return buildUnconfiguredLines(ctx, engines).join("\n");
}

describe("buildUnconfiguredLines — interactive (TTY / agent-driven)", () => {
  const text = joined(INTERACTIVE);

  it("makes browser OAuth the hyperframes path", () => {
    expect(text).toContain("hyperframes auth login");
    expect(text).toMatch(/browser oauth/i);
    expect(text).toMatch(/sign in or sign up/i);
  });

  it("never steers users toward a per-repo .env", () => {
    // The improvised flow recommended writing keys into videos/<project>/.env;
    // this guidance must actively rule that out, not suggest it.
    expect(text).toContain("no per-repo .env");
    expect(text).not.toMatch(/paste keys.*\.env/i);
  });

  it("names the local fallback so 'no key' never reads as a failure", () => {
    expect(text).toMatch(/Kokoro/);
    expect(text).toMatch(/MusicGen/);
    expect(text).toMatch(/free, offline/i);
  });

  it("shows only zero-install `npx hyperframes` paths, not the separately-installed heygen CLI", () => {
    expect(text).not.toMatch(/heygen auth login/);
    expect(text).toContain("npx hyperframes auth login");
    expect(text).toContain("npx hyperframes auth login --api-key");
  });

  it("offers the --api-key path as a secondary option", () => {
    expect(text).toContain("hyperframes auth login --api-key");
  });
});

describe("buildUnconfiguredLines — non-interactive (CI / piped)", () => {
  const lines = buildUnconfiguredLines(NON_INTERACTIVE);
  const text = lines.join("\n");

  it("is terse — two lines, no browser walkthrough", () => {
    expect(lines).toHaveLength(2);
    expect(text).not.toMatch(/opens your browser/i);
  });

  it("points at HEYGEN_API_KEY and the local fallback", () => {
    expect(text).toContain("HEYGEN_API_KEY");
    expect(text).toMatch(/local engines/i);
  });
});

describe("buildUnconfiguredLines — offline engine readiness", () => {
  const ready: OfflineEngineLine[] = [
    { capability: "voice", label: "Kokoro", ready: true },
    { capability: "music", label: "MusicGen", ready: true },
  ];
  const missing: OfflineEngineLine[] = [
    { capability: "voice", label: "Kokoro", ready: true },
    {
      capability: "music",
      label: "MusicGen",
      ready: false,
      setupHint: "pip install transformers torch soundfile numpy",
    },
  ];

  it("shows the resolved engine per capability when ready", () => {
    const text = joined(INTERACTIVE, ready);
    expect(text).toMatch(/voice .*Kokoro/);
    expect(text).toMatch(/music .*MusicGen/);
    expect(text).toMatch(/ready/);
  });

  it("surfaces the pip setup hint and doctor pointer when a dep is missing", () => {
    const text = joined(INTERACTIVE, missing);
    expect(text).toContain("pip install transformers torch soundfile numpy");
    expect(text).toMatch(/deps missing/);
    expect(text).toContain("hyperframes doctor");
  });

  it("falls back to a generic line when readiness wasn't probed", () => {
    const text = joined(INTERACTIVE);
    expect(text).toMatch(/Kokoro/);
    expect(text).toMatch(/MusicGen/);
  });
});

describe("buildUnconfiguredJson", () => {
  it("recommends auth login and reports the local fallback", () => {
    for (const ctx of [INTERACTIVE, NON_INTERACTIVE]) {
      const payload = buildUnconfiguredJson(ctx);
      expect(payload).toMatchObject({
        configured: false,
        interactive: ctx.interactive,
        recommended_action: "npx hyperframes auth login",
        fallback: "local",
      });
    }
  });

  it("includes probed engines when provided", () => {
    const engines: OfflineEngineLine[] = [
      { capability: "voice", label: "Kokoro", ready: true },
      { capability: "music", label: "MusicGen", ready: false, setupHint: "pip install ..." },
    ];
    expect(buildUnconfiguredJson(INTERACTIVE, engines)).toMatchObject({ offline_engines: engines });
  });
});
