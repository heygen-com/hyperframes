import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const publishState = vi.hoisted(() => ({
  publish: vi.fn(),
  credentialError: null as Error | null,
  noticeRelease: null as string | null,
  confirm: vi.fn(),
}));

vi.mock("../ui/prompts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ui/prompts.js")>()),
  confirm: publishState.confirm,
}));

vi.mock("../utils/attendedTerminal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/attendedTerminal.js")>()),
  isUnattended: () => false,
}));

vi.mock("../utils/publishProject.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/publishProject.js")>()),
  publishProjectArchive: publishState.publish,
  resolvePublishCredential: async (
    ...args: Parameters<typeof import("../utils/publishProject.js").resolvePublishCredential>
  ) => {
    if (publishState.credentialError) throw publishState.credentialError;
    return (
      await vi.importActual<typeof import("../utils/publishProject.js")>(
        "../utils/publishProject.js",
      )
    ).resolvePublishCredential(...args);
  },
}));

vi.mock("../share/publishTransition.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../share/publishTransition.js")>();
  return {
    ...actual,
    checkPublishTransition: (args: { dir?: string; update?: string }) =>
      actual.checkPublishTransition(args, publishState.noticeRelease),
  };
});

import publishCommand, { examples, parseUpdateTarget } from "./publish.js";
import { ensureProjectId, writeProjectLink, writeTeamProject } from "../utils/projectLink.js";
import { writeStore as writeUnboundStore, type Credentials } from "../auth/store.js";
import { oauthIdentity } from "../auth/config.js";
import { consumeCommandResult } from "../utils/commandResult.js";

async function writeStore(credentials: Credentials, path?: string): Promise<void> {
  await writeUnboundStore(
    {
      ...credentials,
      ...(credentials.oauth ? { oauth: { ...oauthIdentity(), ...credentials.oauth } } : {}),
    },
    path,
  );
}

const VISIBLE_INDEX = `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`;

function mockPublished(result: Record<string, unknown>): void {
  publishState.publish.mockReset();
  publishState.publish.mockResolvedValue({ title: "test", fileCount: 1, claimed: true, ...result });
}

async function captureLog(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    await run();
  } finally {
    log.mockRestore();
  }
  return lines.join("\n");
}

describe("parseUpdateTarget", () => {
  it("extracts the id from a full published URL", () => {
    expect(parseUpdateTarget("https://hyperframes.dev/p/hfp_abc123")).toBe("hfp_abc123");
  });

  it("handles a scheme-less URL (which new URL() rejects)", () => {
    expect(parseUpdateTarget("hyperframes.dev/p/hfp_abc123")).toBe("hfp_abc123");
  });

  it("strips a trailing query and hash", () => {
    expect(parseUpdateTarget("https://hyperframes.dev/p/hfp_abc123?claim_token=x#frag")).toBe(
      "hfp_abc123",
    );
  });

  it("accepts a bare id unchanged and trims surrounding whitespace", () => {
    expect(parseUpdateTarget("  hfp_abc123  ")).toBe("hfp_abc123");
  });

  it("falls back to the last path segment for a non-/p/ URL", () => {
    expect(parseUpdateTarget("https://example.com/foo/hfp_abc123")).toBe("hfp_abc123");
  });
});

describe("publish default-entry preflight", () => {
  async function runEntryMismatch(candidate: string): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-entry-mismatch-"));
    const candidatePath = join(project, candidate);
    mkdirSync(dirname(candidatePath), { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      candidatePath,
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    mockPublished({ projectId: "project-id", url: "https://hyperframes.dev/p/project-id" });

    try {
      const output = await captureLog(() =>
        expect(
          publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
        ).rejects.toMatchObject({ name: "CliRuntimeError" }),
      );
      expect(publishState.publish).not.toHaveBeenCalled();
      return output;
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it("suggests a nested index.html directory with the re-rooting caveat", async () => {
    const output = await runEntryMismatch("compositions/brand/index.html");

    expect(output).toContain("hyperframes publish <project>/compositions/brand");
    expect(output).toContain("assets are self-contained under that directory");
  });

  it("does not suggest a directory for a standalone file that is not index.html", async () => {
    const output = await runEntryMismatch("compositions/card.html");

    expect(output).toContain("compositions/card.html");
    expect(output).not.toContain("hyperframes publish <project>/compositions");
    expect(output).toContain("publish accepts project directories, not individual HTML files");
  });

  // Windows refuses control characters in file names.
  it.skipIf(process.platform === "win32")(
    "prints the suggested composition path with control characters as visible escapes",
    async () => {
      const esc = String.fromCharCode(27);
      const withoutColors = (text: string) =>
        text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
      const nested = await runEntryMismatch(`compositions/a${esc}]0;x\x07b/index.html`);
      const standalone = await runEntryMismatch(`compositions/c${esc}]0;x\x07d.html`);

      expect(withoutColors(nested)).not.toContain(esc);
      expect(nested).toContain("hyperframes publish <project>/compositions/a\\x1b]0;x\\x07b");
      expect(withoutColors(standalone)).not.toContain(esc);
      expect(standalone).toContain("Move or mount compositions/c\\x1b]0;x\\x07d.html");
    },
  );

  it("prints the full finding on a default-entry-mismatch abort even without --lint-verbose", async () => {
    const output = await runEntryMismatch("compositions/brand/index.html");

    expect(output).toContain("blank_root_with_standalone_composition");
    expect(output).not.toContain("for full output");
  });
});

describe("publish visibility messaging", () => {
  async function runPublish(options: {
    public: boolean;
    claimed?: boolean;
    inPlace?: boolean;
  }): Promise<string> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-visibility-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    // "Updated in place" is decided by the response echoing the id the directory already
    // resolves to — no --update flag required, which is how a plain re-publish reaches it.
    const projectId = options.inPlace === true ? ensureProjectId(project) : "project-id";
    mockPublished({
      claimed: options.claimed ?? true,
      projectId,
      url: `https://hyperframes.dev/p/${projectId}`,
      claimToken: "claim-secret",
    });

    try {
      return await captureLog(() =>
        publishCommand.run?.({
          args: { dir: project, yes: true, public: options.public, proxy: false },
        } as never),
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it.each([
    { public: false, label: "Private", hint: "--public" },
    { public: true, label: "Public", hint: undefined },
  ])(
    "keeps --yes orthogonal to requested $label visibility",
    async ({ public: isPublic, label, hint }) => {
      const output = await runPublish({ public: isPublic });

      expect(publishState.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ public: isPublic }),
      );
      expect(output).toContain("Requested visibility");
      expect(output).toContain(label);
      if (hint) expect(output).toContain(hint);
    },
  );

  // A re-publish without --public sends no visibility, so the server keeps whatever the
  // project already had. Claiming "Private" here would tell someone a public link is locked
  // down. This is the plain `hyperframes publish` path in an already-published directory,
  // not just --update — the same branch serves all three routes to an in-place update.
  it("does not claim private when re-publishing in place without --public", async () => {
    const output = await runPublish({ public: false, inPlace: true });

    expect(output).toContain("Requested visibility");
    expect(output).toContain("Unchanged — keeps this project's current setting");
    expect(output).toContain("Updated existing project");
    expect(output).not.toContain("Private — authentication and access required");
  });

  it("asks before updating an existing project named by the folder, without promising a private upload", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-existing-"));
    const config = mkdtempSync(join(tmpdir(), "hf-publish-existing-config-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    writeTeamProject(project, { projectId: "existing-\u001b[2Kproject" });
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", config);
    vi.stubEnv("HEYGEN_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_API_KEY", "");
    publishState.publish.mockReset();
    publishState.confirm.mockReset();
    publishState.confirm.mockResolvedValue(false);
    const prompt = (isPublic: boolean) =>
      captureLog(() =>
        publishCommand.run?.({ args: { dir: project, public: isPublic, proxy: false } } as never),
      );
    try {
      await writeStore({ oauth: { access_token: "token" } }, join(config, "credentials"));
      const output = await prompt(false);
      expect(output).toContain(
        "If you can access project existing-?[2Kproject, this updates it in place and keeps its current visibility, which may be public. Otherwise it creates a new private project.",
      );
      expect(output).not.toContain("privately");
      expect(output).toContain("Aborted.");
      const publicOutput = await prompt(true);
      expect(publicOutput).toContain("requests public visibility");
      expect(publicOutput).toContain(
        "If you can access project existing-?[2Kproject, this updates it in place. Otherwise it creates a new public project.",
      );
      await writeStore({ api_key: "valid-key" }, join(config, "credentials"));
      const signedOut = await prompt(false);
      expect(signedOut).toContain("uploads this project privately");
      expect(signedOut).not.toContain("existing-");
      expect(publishState.publish).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
    }
  });

  it("refuses --update without a login before asking", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-update-signed-out-"));
    const config = mkdtempSync(join(tmpdir(), "hf-publish-update-signed-out-config-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", config);
    vi.stubEnv("HEYGEN_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_API_KEY", "");
    publishState.confirm.mockReset();
    try {
      consumeCommandResult();
      const output = await captureLog(() =>
        publishCommand.run?.({
          args: { dir: project, public: false, proxy: false, update: "target" },
        } as never),
      );
      expect(output).toContain("--update requires authentication");
      expect(publishState.confirm).not.toHaveBeenCalled();
      expect(consumeCommandResult().exitCode).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
    }
  });

  it("prints the server's title and URL with control characters as visible escapes", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const project = mkdtempSync(join(tmpdir(), "hf-publish-escapes-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    mockPublished({
      title: `film${esc}]0;x${String.fromCharCode(7)}`,
      projectId: "project-id",
      url: `https://hyperframes.dev/p/project-id${esc}[2J`,
    });
    try {
      const output = await captureLog(() =>
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      );

      expect(output.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
      expect(output).toContain("film\\x1b]0;x\\x07");
      expect(output).toContain("project-id\\x1b[2J");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // fails without the fix: the stored link of an earlier publish reached the terminal with its control characters live.
  it("prints an earlier publish's link with control characters as visible escapes", async () => {
    const esc = String.fromCharCode(27);
    const project = mkdtempSync(join(tmpdir(), "hf-publish-prior-link-"));
    const config = mkdtempSync(join(tmpdir(), "hf-publish-prior-link-config-"));
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", config);
    vi.stubEnv("HEYGEN_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_API_KEY", "");
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    writeProjectLink(project, {
      projectId: "earlier",
      url: `https://hyperframes.dev/p/e${esc}[2J`,
    });
    await writeStore({ oauth: { access_token: "fixture-token" } }, join(config, "credentials"));
    mockPublished({
      projectId: "earlier",
      url: "https://hyperframes.dev/p/earlier",
      updated: true,
    });
    try {
      const printed = await captureLog(() =>
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      );
      expect(printed).toContain("Previously published at https://hyperframes.dev/p/e\\x1b[2J");
      expect(printed).not.toContain(`e${esc}[2J`);
    } finally {
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
    }
  });

  // fails without the fix: the sign-in failure reached the terminal with its control characters live.
  it("prints a sign-in failure with control characters as visible escapes", async () => {
    const esc = String.fromCharCode(27);
    const project = mkdtempSync(join(tmpdir(), "hf-publish-sign-in-failure-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    publishState.credentialError = new Error(`Sign-in refused${esc}[2J\nRun auth login`);
    const lines: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });
    try {
      await captureLog(() =>
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      );
      expect(consumeCommandResult().exitCode).toBe(1);
      expect(lines.join("\n")).toContain("  Sign-in refused\\x1b[2J\nRun auth login");
      expect(lines.join("\n")).not.toContain(esc);
    } finally {
      publishState.credentialError = null;
      error.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("prints a publish failure with control characters as visible escapes", async () => {
    const esc = String.fromCharCode(27);
    const project = mkdtempSync(join(tmpdir(), "hf-publish-failure-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    publishState.publish.mockReset();
    publishState.publish.mockRejectedValue(new Error(`Could not read a${esc}[2Jb.png\r\nsecond`));
    const lines: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });
    try {
      await captureLog(() =>
        publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
      );
      consumeCommandResult();
      const printed = lines.join("\n");

      expect(printed).not.toContain(esc);
      expect(printed).toContain("Could not read a\\x1b[2Jb.png\\x0d\nsecond");
    } finally {
      error.mockRestore();
      rmSync(project, { recursive: true, force: true });
    }
  });

  // Windows refuses control characters in file names.
  it.skipIf(process.platform === "win32")(
    "prints a left-out file name with control characters as visible escapes",
    async () => {
      const { log } = await import("@clack/prompts");
      // Built rather than written: a literal control character in the source is a lint error.
      const esc = String.fromCharCode(27);
      const project = mkdtempSync(join(tmpdir(), "hf-publish-left-out-"));
      writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
      writeFileSync(join(project, `.env.${esc}[2J`), "KEY=1");
      // Re-included by the ignore file, so the upload walks it and then leaves it out as private.
      writeFileSync(join(project, ".hyperframesignore"), "!.env.*\n");
      mockPublished({ projectId: "project-id", url: "https://hyperframes.dev/p/project-id" });
      const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
      try {
        await captureLog(() =>
          publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never),
        );
        const warned = warn.mock.calls.map((call) => call.join(" ")).join("\n");

        expect(warned).toContain("left out of the upload");
        expect(warned.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
        expect(warned).toContain(".env.\\x1b[2J");
      } finally {
        warn.mockRestore();
        rmSync(project, { recursive: true, force: true });
      }
    },
  );

  it("labels an authentication-required anonymous URL as a claim URL", async () => {
    const output = await runPublish({ public: false, claimed: false });

    expect(output).toContain("Claim URL");
    expect(output).toContain("claim_token=claim-secret");
    expect(output).toContain("sign in");
    expect(output).not.toMatch(/^\s*Public\s/m);
  });

  it("does not describe default publishing as public", () => {
    expect(examples[0]?.[0]).not.toContain("public URL");
  });
});

describe("publish --update / --space ownership preflight", () => {
  async function runWithFlag(
    flag: { update?: string; space?: string },
    credentials: { env?: string; stored?: Parameters<typeof writeStore>[0] },
    publish?: (...args: unknown[]) => Promise<unknown>,
  ): Promise<{ output: string; exitCode: number }> {
    const project = mkdtempSync(join(tmpdir(), "hf-publish-owner-"));
    const config = mkdtempSync(join(tmpdir(), "hf-publish-owner-config-"));
    writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", config);
    vi.stubEnv("HEYGEN_API_KEY", credentials.env ?? "");
    vi.stubEnv("HYPERFRAMES_API_KEY", "");
    if (credentials.stored) await writeStore(credentials.stored, join(config, "credentials"));
    mockPublished({ projectId: "target", url: "https://hyperframes.dev/p/target" });
    if (publish) publishState.publish.mockImplementation(publish);
    try {
      consumeCommandResult();
      const output = await captureLog(() =>
        publishCommand.run?.({
          args: { dir: project, yes: true, public: false, proxy: false, ...flag },
        } as never),
      );
      return { output, exitCode: consumeCommandResult().exitCode };
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      rmSync(project, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
    }
  }

  it.each([
    { flag: { update: "target" }, name: "--update" },
    { flag: { space: "space-1" }, name: "--space" },
  ])("refuses $name with an env API key before uploading", async ({ flag, name }) => {
    const { output, exitCode } = await runWithFlag(flag, { env: "valid-key" });

    expect(publishState.publish).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(output).toContain(`${name} requires a login; HEYGEN_API_KEY cannot own a project`);
  });

  it("refuses --update with a saved API key before uploading", async () => {
    const { output, exitCode } = await runWithFlag(
      { update: "target" },
      { stored: { api_key: "valid-key" } },
    );

    expect(publishState.publish).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
    expect(output).toContain("--update requires a login; an API key cannot own a project");
  });

  it("publishes --update with a login", async () => {
    const { output, exitCode } = await runWithFlag(
      { update: "target" },
      { stored: { oauth: { access_token: "token" } } },
    );

    expect(publishState.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ projectId: "target" }),
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("Updated existing project");
  });

  // The login expires while proxies bake; a second credential lookup at upload time would
  // fall back to the saved API key, publish unowned and drop the flag without a word.
  it.each([{ update: "target" }, { space: "space-1" }])(
    "uploads with the checked login even if it expires mid-publish (%o)",
    async (flag) => {
      const { publishProjectArchive } = await vi.importActual<
        typeof import("../utils/publishProject.js")
      >("../utils/publishProject.js");
      const fetchMock = vi.fn(async (url: string) =>
        url.endsWith("/publish/upload")
          ? new Response(null, { status: 404 })
          : Response.json({
              data: {
                project_id: "anon",
                title: "test",
                url: "https://hyperframes.dev/p/anon",
                file_count: 1,
                claimed: false,
                claim_token: "claim-secret",
              },
            }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { output, exitCode } = await runWithFlag(
        flag,
        { stored: { oauth: { access_token: "token" }, api_key: "valid-key" } },
        async (dir, opts) => {
          await writeStore({
            oauth: { access_token: "token", expires_at: past },
            api_key: "valid-key",
          });
          return publishProjectArchive(dir as string, opts as never);
        },
      );

      for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
        expect(init.headers).toMatchObject({ authorization: "Bearer token" });
        expect(init.headers).not.toHaveProperty("x-api-key");
      }
      expect(fetchMock).toHaveBeenCalled();
      expect(exitCode).toBe(1);
      expect(output).not.toContain("Claim URL");
    },
  );

  // Another CLI logs in as B while A's publish bakes; refreshing A must not write over B.
  it("fails without touching a login that replaced the checked one mid-publish", async () => {
    const { publishProjectArchive } = await vi.importActual<
      typeof import("../utils/publishProject.js")
    >("../utils/publishProject.js");
    const { readStore } = await import("../auth/store.js");
    vi.stubEnv("HYPERFRAMES_OAUTH_TOKEN_URL", "https://auth.test/token");
    const fetchMock = vi.fn(async (url: string) =>
      url === "https://auth.test/token"
        ? Response.json({ access_token: "a-new", expires_in: 3600 })
        : Response.json({
            data: {
              project_id: "target",
              title: "test",
              url: "https://hyperframes.dev/p/target",
              file_count: 1,
              claimed: true,
            },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const loginB = { access_token: "b-token", refresh_token: "b-refresh" };
    const errors: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    let stored: Awaited<ReturnType<typeof readStore>> | undefined;
    try {
      const { exitCode } = await runWithFlag(
        { update: "target" },
        {
          stored: {
            oauth: {
              access_token: "a-token",
              refresh_token: "a-refresh",
              expires_at: new Date(Date.now() + 90_000).toISOString(),
            },
          },
        },
        async (dir, opts) => {
          await writeStore({ oauth: loginB, user: { email: "b@example.com" } });
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(Date.now() + 10 * 60_000);
          try {
            return await publishProjectArchive(dir as string, opts as never);
          } finally {
            stored = await readStore();
            vi.useRealTimers();
          }
        },
      );

      expect(stored?.credentials.oauth).toMatchObject(loginB);
      expect(stored?.credentials.user?.email).toBe("b@example.com");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain("Your login changed during publish. Run publish again.");
    } finally {
      error.mockRestore();
    }
  });
});

describe("expired transition preserves only owned legacy updates", () => {
  it.each(["anonymous", "api-key", "oauth"])(
    "checks %s ownership before publication",
    async (kind) => {
      const project = mkdtempSync(join(tmpdir(), "hf-publish-transition-owner-"));
      const config = mkdtempSync(join(tmpdir(), "hf-publish-transition-config-"));
      vi.stubEnv("HYPERFRAMES_CONFIG_DIR", config);
      vi.stubEnv("HEYGEN_API_KEY", kind === "api-key" ? "fixture-key" : "");
      vi.stubEnv("HYPERFRAMES_API_KEY", "");
      writeFileSync(join(project, "index.html"), VISIBLE_INDEX);
      writeProjectLink(project, { projectId: "legacy", url: "https://hyperframes.dev/p/legacy" });
      writeTeamProject(project, { projectId: "legacy" });
      if (kind === "oauth")
        await writeStore({ oauth: { access_token: "fixture-token" } }, join(config, "credentials"));
      mockPublished({
        projectId: "legacy",
        url: "https://hyperframes.dev/p/legacy",
        updated: true,
      });
      publishState.noticeRelease = "2020-01-01T00:00:00.000Z";
      try {
        const run = () =>
          publishCommand.run?.({ args: { dir: project, yes: true, proxy: false } } as never);
        if (kind === "oauth") {
          await captureLog(run);
          expect(publishState.publish).toHaveBeenCalledWith(
            project,
            expect.objectContaining({
              projectId: "legacy",
              credential: expect.objectContaining({ type: "oauth" }),
            }),
          );
        } else {
          await expect(run()).rejects.toMatchObject({ code: "legacy_publish_login_required" });
          expect(publishState.publish).not.toHaveBeenCalled();
        }
      } finally {
        publishState.noticeRelease = null;
        vi.unstubAllEnvs();
        rmSync(project, { recursive: true, force: true });
        rmSync(config, { recursive: true, force: true });
      }
    },
  );
});
