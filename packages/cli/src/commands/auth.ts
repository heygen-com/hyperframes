/**
 * `hyperframes auth` — credential management for HeyGen.
 *
 * Subverbs:
 *   - `login`   sign in via API key (OAuth coming next)
 *   - `status`  show the active credential + identity
 *   - `logout`  remove the stored credential
 *
 * Each subverb lives in `./auth/<name>.ts` and is dynamic-imported on
 * demand. Keeps cold-start fast and lets the auth library load only
 * when the user is doing auth work.
 */

import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Sign in via browser (OAuth)", "hyperframes auth login"],
  ["Sign in from SSH/headless terminal", "hyperframes auth login --device"],
  ["Save an API key (interactive)", "hyperframes auth login --api-key"],
  ["Save an API key from stdin", "echo $HEYGEN_API_KEY | hyperframes auth login --api-key"],
  ["Check who you're signed in as", "hyperframes auth status"],
  ["Force-refresh the OAuth access token", "hyperframes auth refresh"],
  ["Sign out", "hyperframes auth logout"],
];

const HELP = `
${c.bold("hyperframes auth")} ${c.dim("<subcommand> [args]")}

Manage HeyGen credentials. Credentials live in
${c.accent("~/.heygen/credentials")} and are shared with heygen-cli.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("login")}    ${c.dim("Sign in via browser, --device for SSH, or --api-key for a long-lived key.")}
  ${c.accent("status")}   ${c.dim("Show the active credential's source, type, and identity.")}
  ${c.accent("refresh")}  ${c.dim("Force-refresh the OAuth access token.")}
  ${c.accent("logout")}   ${c.dim("Remove the stored credential (--keep-api-key for OAuth-only).")}

${c.bold("ENV VARS:")}
  ${c.accent("HEYGEN_API_KEY")}              Override the stored credential.
  ${c.accent("HYPERFRAMES_API_KEY")}         Alias for HEYGEN_API_KEY.
  ${c.accent("HEYGEN_API_URL")}              Override the API base URL (default https://api.heygen.com).
  ${c.accent("HEYGEN_CONFIG_DIR")}           Override the credentials directory (default ~/.heygen).
  ${c.accent("HYPERFRAMES_OAUTH_CLIENT_ID")} Override the OAuth client_id (for dev/test).
  ${c.accent("HYPERFRAMES_OAUTH_DEVICE_URL")} Override the RFC 8628 device endpoint (for dev/test).
`;

export default defineCommand({
  meta: { name: "auth", description: "Sign in to HeyGen and manage credentials" },
  subCommands: {
    login: () => import("./auth/login.js").then((m) => m.default),
    status: () => import("./auth/status.js").then((m) => m.default),
    logout: () => import("./auth/logout.js").then((m) => m.default),
    refresh: () => import("./auth/refresh.js").then((m) => m.default),
  },
  async run({ args }) {
    if (!args._?.[0]) console.log(HELP);
  },
});
