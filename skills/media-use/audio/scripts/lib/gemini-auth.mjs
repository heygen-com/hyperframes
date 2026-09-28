import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonInvocation } from "./python.mjs";

export function geminiConfigured() {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GCS_CREDS,
  );
}

export function geminiAuth({ run = spawnSync } = {}) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) return { headers: { "x-goog-api-key": key }, secret: key };
  if (!geminiConfigured()) {
    throw new Error(
      "Gemini TTS needs GEMINI_API_KEY or GOOGLE_API_KEY, or service-account credentials (GOOGLE_APPLICATION_CREDENTIALS or GCS_CREDS)",
    );
  }
  const { cmd, args } = pythonInvocation([
    fileURLToPath(new URL("./gemini-auth.py", import.meta.url)),
  ]);
  const result = run(cmd, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "Gemini service-account authentication failed; check Python and install google-auth requests",
    );
  }
  if (result.status !== 0 || !data.token) {
    // Do not echo subprocess output: it could contain credentials.
    throw new Error(
      "Gemini service-account authentication failed; check service-account JSON, permissions, and Python packages google-auth requests",
    );
  }
  const headers = { Authorization: `Bearer ${data.token}` };
  if (data.project) headers["x-goog-user-project"] = data.project;
  return { headers, secret: data.token };
}
