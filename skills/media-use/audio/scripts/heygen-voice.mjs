#!/usr/bin/env node
// HeyGen voice clones: `clone <audio> --name <n>`, `delete <voice_id>`, `list --prefix <p>` (references/tts.md).
// The clone id works as `heygen-tts.mjs --voice <id>`. A refusal prints HeyGen's own message and exits 1.
// Auth: same resolver as heygen-tts.mjs (lib/heygen.mjs).

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { heygenAuthHeaders, heygenJSON, heygenMessage, loadEnvFromDir } from "./lib/heygen.mjs";

const MEDIA_TYPES = { ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const POLL_MS = 2_000;
const DEADLINE_MS = 120_000;

async function clone(file, name, headers, { sleep, now }) {
  const mediaType = MEDIA_TYPES[extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`unsupported audio file ${file}: use .mp3 or .wav`);
  const data = readFileSync(file).toString("base64");
  const created = await heygenJSON("/voices/clone", {
    method: "POST",
    headers,
    body: { voice_name: name, audio: { type: "base64", media_type: mediaType, data } },
  });
  const id = created.data.voice_clone_id;
  const deadline = now() + DEADLINE_MS;
  for (;;) {
    const { data: voice } = await heygenJSON(`/voices/${id}`, { headers });
    if (voice.status === "complete") return { voice_id: voice.voice_id ?? id };
    if (voice.status === "failed") throw new Error(voice.failure_message || "voice clone failed");
    if (now() >= deadline) throw new Error(`voice clone ${id} not ready after 120 s`);
    await sleep(POLL_MS);
  }
}

async function list(prefix, headers) {
  const mine = [];
  const seen = new Set();
  let token;
  do {
    if (token && seen.has(token)) throw new Error(`HeyGen returned page token ${token} twice`);
    if (token) seen.add(token);
    const query = new URLSearchParams({ type: "private", limit: "100" });
    if (token) query.set("token", token);
    const page = await heygenJSON(`/voices?${query}`, { headers });
    mine.push(...page.data.filter((v) => (v.name ?? "").startsWith(prefix)));
    token = page.has_more ? page.next_token : null;
  } while (token);
  // ponytail: the list response has no created_at, so one GET per match; bounded by the clone limit.
  return Promise.all(
    mine.map(async ({ voice_id, name }) => {
      const { data } = await heygenJSON(`/voices/${voice_id}`, { headers });
      return { voice_id, name, created_at: data.created_at ?? null };
    }),
  );
}

export async function main(
  argv,
  {
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    out = (s) => process.stdout.write(`${s}\n`),
    err = (s) => process.stderr.write(`${s}\n`),
  } = {},
) {
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { name: { type: "string" }, prefix: { type: "string", default: "" } },
    });
    const [command, arg] = positionals;
    if (command === "clone") {
      if (!arg || !values.name) throw new Error("usage: clone <audio-file> --name <name>");
      out(JSON.stringify(await clone(arg, values.name, heygenAuthHeaders(), { sleep, now })));
    } else if (command === "delete") {
      if (!arg) throw new Error("usage: delete <voice_id>");
      await heygenJSON(`/voices/${encodeURIComponent(arg)}`, {
        method: "DELETE",
        headers: heygenAuthHeaders(),
      });
    } else if (command === "list") {
      out(JSON.stringify(await list(values.prefix, heygenAuthHeaders())));
    } else {
      throw new Error("usage: heygen-voice.mjs clone|delete|list (see the header of this file)");
    }
    return 0;
  } catch (e) {
    err(heygenMessage(e));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFromDir(process.cwd());
  process.exitCode = await main(process.argv.slice(2));
}
