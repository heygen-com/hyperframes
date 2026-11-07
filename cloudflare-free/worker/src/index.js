/**
 * hyperframes-render — Cloudflare Worker (paket Workers Free).
 *
 * Peran Worker ini sengaja kecil: ia TIDAK merender apa pun. Render dilakukan
 * oleh GitHub Actions (.github/workflows/render-video.yml); Worker hanya
 *   1. menerima permintaan render (POST /render, dilindungi x-api-key),
 *   2. memicu repository_dispatch (event: render-video) ke repo fork,
 *   3. menyajikan hasil MP4 dari R2 (GET /video/:id) dan statusnya (GET /status/:id).
 *
 * Binding & secret (lihat wrangler.jsonc):
 *   env.VIDEOS       R2 bucket "hyperframes-renders"
 *   env.GITHUB_REPO  var "owner/repo" tujuan dispatch
 *   env.GITHUB_TOKEN secret, PAT fine-grained (Contents: Read and write)
 *   env.API_KEY      secret, kunci untuk POST /render
 *
 * Kunci objek di R2 HARUS sama dengan yang dipakai workflow: renders/<id>.mp4
 */

// Aturan input yang sama dipakai ulang di workflow (validasi dua lapis).
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const QUALITIES = new Set(["draft", "standard", "high"]);
const DEFAULT_COMPOSITION = "contoh";
const MAX_BODY_BYTES = 2048; // body /render hanya JSON kecil

const objectKey = (id) => `renders/${id}.mp4`;

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Respons JSON (termasuk 404 "belum selesai") tidak boleh di-cache.
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

const methodNotAllowed = (allowed) =>
  json({ error: "method_not_allowed" }, 405, { allow: allowed.join(", ") });

/**
 * Bandingkan dua string tanpa membocorkan panjang/isi lewat waktu respons.
 * Keduanya di-hash SHA-256 dulu supaya panjangnya sama, lalu dibandingkan
 * dengan crypto.subtle.timingSafeEqual (tersedia di Workers runtime).
 */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      // Log pesan saja; jangan pernah mencetak env/secret/header.
      console.error("unhandled", err instanceof Error ? err.message : String(err));
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/render") {
    if (method !== "POST") return methodNotAllowed(["POST"]);
    return handleRender(request, env, url.origin);
  }

  const match = pathname.match(/^\/(status|video)\/([^/]+)$/);
  if (match) {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
    let id;
    try {
      id = decodeURIComponent(match[2]);
    } catch {
      return json({ error: "invalid_id" }, 400);
    }
    if (!ID_RE.test(id)) return json({ error: "invalid_id" }, 400);
    return match[1] === "status"
      ? handleStatus(env, id, url.origin)
      : handleVideo(request, env, id);
  }

  if (pathname === "/" && (method === "GET" || method === "HEAD")) {
    return json({
      service: "hyperframes-render",
      endpoints: ["POST /render", "GET /status/:id", "GET /video/:id"],
    });
  }

  return json({ error: "not_found" }, 404);
}

/** POST /render  body: { id?, composition?, quality? } → 202 */
async function handleRender(request, env, origin) {
  if (!env.API_KEY || !env.GITHUB_TOKEN || !REPO_RE.test(env.GITHUB_REPO ?? "")) {
    return json({ error: "server_not_configured" }, 500);
  }

  const provided = request.headers.get("x-api-key") ?? "";
  if (!(await safeEqual(provided, env.API_KEY))) {
    return json({ error: "unauthorized" }, 401);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }
  let body = {};
  if (raw.trim() !== "") {
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_json" }, 400);
  }

  // id otomatis berupa UUID (tak mudah ditebak) bila tidak diberikan.
  const id = body.id ?? crypto.randomUUID();
  const composition = body.composition ?? DEFAULT_COMPOSITION;
  const quality = body.quality ?? "standard";

  if (typeof id !== "string" || !ID_RE.test(id)) return json({ error: "invalid_id" }, 400);
  if (typeof composition !== "string" || !ID_RE.test(composition)) {
    return json({ error: "invalid_composition" }, 400);
  }
  if (typeof quality !== "string" || !QUALITIES.has(quality)) {
    return json({ error: "invalid_quality", allowed: [...QUALITIES] }, 400);
  }

  // Jangan menimpa hasil yang sudah ada.
  if (await env.VIDEOS.head(objectKey(id))) {
    return json({ error: "id_already_exists", id }, 409);
  }

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "hyperframes-render-worker", // wajib untuk GitHub API
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: "render-video",
      client_payload: { id, composition, quality },
    }),
  });

  // GitHub membalas 204 No Content bila dispatch diterima.
  if (res.status !== 204) {
    const detail = (await res.text()).slice(0, 200);
    console.error("dispatch_failed", res.status, detail);
    return json({ error: "dispatch_failed", github_status: res.status }, 502);
  }

  return json(
    {
      id,
      composition,
      quality,
      status: "queued",
      status_url: `${origin}/status/${id}`,
      video_url: `${origin}/video/${id}`,
    },
    202,
  );
}

/** GET /status/:id — hanya cek keberadaan file di R2. */
async function handleStatus(env, id, origin) {
  const head = await env.VIDEOS.head(objectKey(id));
  if (!head) {
    // Tidak bisa membedakan "antre/sedang render" dari "id tidak pernah ada".
    return json({ id, status: "not_ready" }, 404);
  }
  return json({
    id,
    status: "done",
    size: head.size,
    uploaded: head.uploaded.toISOString(),
    video_url: `${origin}/video/${id}`,
  });
}

/** GET|HEAD /video/:id — sajikan MP4 dari R2 (404 selama belum selesai). */
async function handleVideo(request, env, id) {
  const key = objectKey(id);
  const isHead = request.method === "HEAD";

  // `range: request.headers` membuat R2 menangani header Range sehingga
  // pemutar video bisa seek (respons 206).
  const object = isHead
    ? await env.VIDEOS.head(key)
    : await env.VIDEOS.get(key, { range: request.headers });
  if (!object) return json({ id, error: "not_ready" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", "video/mp4");
  headers.set("accept-ranges", "bytes");
  // id tidak pernah ditimpa lewat API (409), jadi aman di-cache sejam.
  headers.set("cache-control", "public, max-age=3600");

  if (isHead) {
    headers.set("content-length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  let status = 200;
  if (object.range) {
    status = 206;
    headers.set("content-range", contentRange(object.range, object.size));
  }
  return new Response(object.body, { status, headers });
}

/** Bangun header Content-Range dari R2Range (offset/length atau suffix). */
function contentRange(range, size) {
  let start;
  let end;
  if (range.suffix !== undefined) {
    start = Math.max(size - range.suffix, 0);
    end = size - 1;
  } else {
    start = range.offset ?? 0;
    end = range.length !== undefined ? Math.min(start + range.length, size) - 1 : size - 1;
  }
  return `bytes ${start}-${end}/${size}`;
}
