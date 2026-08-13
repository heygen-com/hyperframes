import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

export type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

const MAX_INSTANCES = 10;

function sandboxId(chunkIndex: number): string {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= MAX_INSTANCES) {
    throw new Error(`chunkIndex must be 0..${MAX_INSTANCES - 1}`);
  }
  return `hf-chunk-${chunkIndex}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/destroy") {
        const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
        const sandbox = getSandbox(env.Sandbox, sandboxId(chunkIndex));
        await sandbox.destroy();
        return Response.json({ ok: true, destroyed: sandboxId(chunkIndex) });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({
          ok: true,
          accountPinned: true,
          maxInstances: MAX_INSTANCES,
        });
      }

      if (request.method === "POST" && url.pathname === "/smoke") {
        const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
        const sandbox = getSandbox(env.Sandbox, sandboxId(chunkIndex));
        const ffmpeg = await sandbox.exec("ffmpeg -version");
        const chrome = await sandbox.exec(
          "sh -c 'chromium --version 2>/dev/null || chrome-headless-shell --version 2>/dev/null || echo missing'",
        );
        return Response.json({
          ffmpeg: { ok: ffmpeg.success, out: ffmpeg.stdout.slice(0, 200) },
          chrome: { ok: chrome.success, out: chrome.stdout.slice(0, 200) },
        });
      }

      if (request.method === "POST" && url.pathname === "/plan") {
        const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
        const sandbox = getSandbox(env.Sandbox, sandboxId(chunkIndex));
        const bytes = new Uint8Array(await request.arrayBuffer());
        await sandbox.writeFile("/tmp/project.tar.gz.b64", uint8ToBase64(bytes));
        const unpacked = await sandbox.exec(
          "sh -c 'base64 -d /tmp/project.tar.gz.b64 > /tmp/project.tar.gz && rm -rf /workspace/project /workspace/plan && mkdir -p /workspace/project /workspace/plan && tar -xzf /tmp/project.tar.gz -C /workspace/project'",
        );
        if (!unpacked.success) {
          return Response.json(
            { ok: false, error: unpacked.stderr || unpacked.stdout },
            { status: 500 },
          );
        }
        const planned = await sandbox.exec(
          "sh -c 'cd /opt/hf && mkdir -p node_modules && (test -d node_modules/ws || npm install --omit=dev ws) && NODE_PATH=/opt/hf/node_modules PRODUCER_HYPERFRAME_MANIFEST_PATH=/opt/hf/runtime/hyperframe.manifest.json HF_ACTION=plan HF_PROJECT_DIR=/workspace/project HF_PLAN_DIR=/workspace/plan HF_MAX_SANDBOXES=10 bun ./chunk-worker.mjs'",
        );
        if (!planned.success) {
          return Response.json(
            { ok: false, error: planned.stderr || planned.stdout },
            { status: 500 },
          );
        }
        const packed = await sandbox.exec(
          "sh -c 'tar -czf /tmp/plan.tar.gz -C /workspace/plan . && base64 /tmp/plan.tar.gz'",
        );
        if (!packed.success) {
          return Response.json({ ok: false, error: packed.stderr }, { status: 500 });
        }
        return Response.json({
          ok: true,
          meta: planned.stdout.trim(),
          planTarBase64: packed.stdout.replace(/\s+/g, ""),
        });
      }

      if (request.method === "POST" && url.pathname === "/write-plan") {
        const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
        const sandbox = getSandbox(env.Sandbox, sandboxId(chunkIndex));
        const bytes = new Uint8Array(await request.arrayBuffer());
        const b64 = uint8ToBase64(bytes);
        await sandbox.writeFile("/tmp/plan.tar.gz.b64", b64);
        const unpacked = await sandbox.exec(
          "sh -c 'base64 -d /tmp/plan.tar.gz.b64 > /tmp/plan.tar.gz && rm -rf /workspace/plan && mkdir -p /workspace/plan && tar -xzf /tmp/plan.tar.gz -C /workspace/plan'",
        );
        if (!unpacked.success) {
          return Response.json(
            { ok: false, error: unpacked.stderr || unpacked.stdout },
            { status: 500 },
          );
        }
        return Response.json({
          ok: true,
          sandboxId: sandboxId(chunkIndex),
          bytes: bytes.byteLength,
        });
      }

      if (request.method === "POST" && url.pathname === "/render-chunk") {
        const chunkIndex = Number(url.searchParams.get("chunk") ?? "0");
        const sandbox = getSandbox(env.Sandbox, sandboxId(chunkIndex));
        const started = Date.now();
        const result = await sandbox.exec(
          `sh -c 'cd /opt/hf && mkdir -p node_modules && (test -d node_modules/ws || npm install --omit=dev ws) && NODE_PATH=/opt/hf/node_modules PRODUCER_HYPERFRAME_MANIFEST_PATH=/opt/hf/runtime/hyperframe.manifest.json HF_ACTION=render HF_PLAN_DIR=/workspace/plan HF_CHUNK_INDEX=${chunkIndex} HF_OUTPUT=/workspace/chunk.mp4 bun ./chunk-worker.mjs'`,
        );
        if (!result.success) {
          return Response.json(
            { ok: false, error: result.stderr || result.stdout, elapsedMs: Date.now() - started },
            { status: 500 },
          );
        }
        const encoded = await sandbox.exec("base64 /workspace/chunk.mp4");
        if (!encoded.success) {
          return Response.json({ ok: false, error: encoded.stderr }, { status: 500 });
        }
        return Response.json({
          ok: true,
          chunkIndex,
          elapsedMs: Date.now() - started,
          mp4Base64: encoded.stdout.replace(/\s+/g, ""),
        });
      }

      return new Response("not found", { status: 404 });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  },
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
