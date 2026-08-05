import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readUserConfig() {
  const path = join(homedir(), ".media", "providers.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function configuredBgmProvider() {
  return readUserConfig()?.bgm?.default || process.env.HYPERFRAMES_BGM_PROVIDER || null;
}

export function aceStepConfig() {
  const configured = readUserConfig()?.bgm?.acestep || {};
  const baseUrl = String(process.env.ACESTEP_API_URL || configured.base_url || "").replace(
    /\/$/,
    "",
  );
  const keyName = configured.api_key_env || "ACESTEP_API_KEY";
  return { baseUrl, apiKey: process.env[keyName] || "" };
}

function headers(apiKey) {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function requestJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    // The status below is more useful than a JSON parser stack.
  }
  if (!response.ok) {
    const detail = body?.detail || body?.error || `HTTP ${response.status}`;
    throw new Error(`ACE-Step request failed: ${detail}`);
  }
  return body;
}

function resultObject(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error("ACE-Step returned an invalid result payload");
    }
  }
  if (Array.isArray(parsed)) return parsed[0] || null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

export async function generateWithAceStep(intent, ctx = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const sleepImpl = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const { baseUrl, apiKey } = deps.config || aceStepConfig();
  if (!baseUrl) return null;

  const duration = Math.max(10, Math.min(600, Number(ctx.duration) || 30));
  const submitted = await requestJson(
    `${baseUrl}/release_task`,
    {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        prompt: intent,
        lyrics: "[Instrumental]",
        thinking: true,
        use_format: false,
        audio_duration: duration,
        audio_format: "mp3",
        batch_size: 1,
        model: "acestep-v15-sft",
        lm_backend: "pt",
        inference_steps: 50,
      }),
    },
    fetchImpl,
  );
  const taskId = submitted?.data?.task_id || submitted?.task_id || submitted?.data?.id;
  if (!taskId) throw new Error("ACE-Step did not return a task ID");

  const started = now();
  const timeoutMs = Number(process.env.ACESTEP_POLL_TIMEOUT_MS) || 20 * 60 * 1000;
  while (now() - started < timeoutMs) {
    const queried = await requestJson(
      `${baseUrl}/query_result`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ task_id_list: [taskId] }),
      },
      fetchImpl,
    );
    const row = queried?.data?.[0];
    if (!row) throw new Error(`ACE-Step lost task ${taskId}`);
    if (Number(row.status) === 2)
      throw new Error(row.error || row.message || "ACE-Step generation failed");
    if (Number(row.status) === 1) {
      const result = resultObject(row.result);
      if (!result?.file) throw new Error("ACE-Step completed without an audio file");
      const audioUrl = new URL(String(result.file), `${baseUrl}/`).toString();
      const metadata = result.metas && typeof result.metas === "object" ? result.metas : {};
      return {
        url: audioUrl,
        downloadHeaders: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
        ext: ".mp3",
        source: "generate",
        metadata: {
          description: intent,
          duration: Number(metadata.duration) || duration,
          provider: "acestep.remote",
          provenance: {
            endpoint: new URL(baseUrl).origin,
            task_id: String(taskId),
            dit_model: result.dit_model || "acestep-v15-sft",
            lm_model: result.lm_model || null,
            seed: result.seed_value || null,
          },
        },
      };
    }
    await sleepImpl(now() - started < 30_000 ? 2000 : 5000);
  }
  throw new Error(`ACE-Step task ${taskId} exceeded the generation timeout`);
}
