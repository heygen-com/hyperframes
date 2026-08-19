import { failCommand } from "../../utils/commandResult.js";
/**
 * `hyperframes auth logout` — remove the credential file. With
 * `--keep-api-key`, only the OAuth block is cleared (no-op for
 * API-key-only stores).
 *
 * Env-only credentials (`HEYGEN_API_KEY`, `HYPERFRAMES_API_KEY`) can't
 * be cleared by this command — we tell the user to unset them.
 */

import { defineCommand } from "citty";
import {
  clearOAuth,
  configDir,
  credentialPath,
  deleteStore,
  readStore,
  revokeTokens,
} from "../../auth/index.js";
import { c } from "../../ui/colors.js";

export default defineCommand({
  meta: { name: "logout", description: "Remove the stored HeyGen credential" },
  args: {
    "keep-api-key": {
      type: "boolean",
      description: "Only clear the OAuth session; preserve the API key.",
      default: false,
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation prompt.",
      default: false,
    },
  },
  async run({ args }) {
    warnIfEnvCredentialActive();
    const keepApiKey = Boolean(args["keep-api-key"]);

    if (!(await ensureConfirmed(Boolean(args.yes), keepApiKey))) {
      console.log("Aborted.");
      failCommand();
    }

    // Best-effort revoke before we wipe local state. RFC 7009 says
    // success is empty 200 — we ignore failure either way.
    await bestEffortRevoke();

    if (keepApiKey) {
      await clearOAuth();
      console.log(c.success("✓ OAuth session removed. API key retained."));
      return;
    }
    await deleteStore();
    console.log(c.success(`✓ Signed out. Removed ${credentialPath()}.`));
  },
});

function warnIfEnvCredentialActive(): void {
  if (process.env["HEYGEN_API_KEY"] || process.env["HYPERFRAMES_API_KEY"]) {
    console.log(
      c.warn(
        "An env-var credential is active. Unset HEYGEN_API_KEY / HYPERFRAMES_API_KEY to remove it.",
      ),
    );
  }
}

async function ensureConfirmed(yes: boolean, keepApiKey: boolean): Promise<boolean> {
  if (yes) return true;
  const prompt = keepApiKey
    ? `This will sign out of any active OAuth session on this machine (~/.heygen lives at ${configDir()}). Continue? [y/N] `
    : `This will sign out of HeyGen on this machine (~/.heygen lives at ${configDir()}). Continue? [y/N] `;
  return confirmInteractive(prompt);
}

// fallow-ignore-next-line complexity
async function bestEffortRevoke(): Promise<void> {
  try {
    const { credentials, source } = await readStore();
    if (source === "absent" || !credentials.oauth) return;
    const { access_token, refresh_token } = credentials.oauth;
    // Revoke the refresh_token first (per RFC 7009, that typically
    // invalidates all derived access tokens), but also revoke the
    // access_token explicitly to cover servers that don't cascade.
    if (refresh_token) {
      await revokeTokens(refresh_token, { token_type_hint: "refresh_token" });
    }
    if (access_token) {
      await revokeTokens(access_token, { token_type_hint: "access_token" });
    }
  } catch {
    /* Best-effort — never block local wipe on a network/IdP issue. */
  }
}

async function confirmInteractive(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, (line) => resolve(line));
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
