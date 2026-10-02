import { appendFileSync, writeFileSync } from "node:fs";

const env = process.env;
globalThis.fetch = async (url, options) => {
  if (env.HF_USAGE_FORBID_REQUESTS === "true") {
    writeFileSync(env.HF_USAGE_REQUESTS, "unexpected");
    throw new Error("unexpected network request");
  }
  appendFileSync(env.HF_USAGE_REQUESTS, JSON.stringify(String(url)) + "\n");
  const settings =
    env.HF_USAGE_HARNESS === "grok" && String(url) === "https://cli-chat-proxy.grok.com/v1/settings";
  if (String(url) !== env.HF_USAGE_URL && !settings) throw new Error("unexpected network request");
  if (options.headers.Authorization !== "Bearer fixture-token") throw new Error("wrong credential");
  if (env.HF_USAGE_HARNESS === "codex" && options.headers["ChatGPT-Account-Id"] !== "fixture-account")
    throw new Error("missing account header");
  if (env.HF_USAGE_HARNESS === "grok" && options.headers["X-XAI-Token-Auth"] !== "xai-grok-cli")
    throw new Error("missing Grok header");
  if (settings && env.HF_USAGE_SETTINGS_FAIL === "true") return new Response("unavailable", { status: 503 });
  return new Response(
    settings ? JSON.stringify({ subscription_tier_display: "SuperGrok" }) : env.HF_USAGE_RESPONSE,
  );
};
