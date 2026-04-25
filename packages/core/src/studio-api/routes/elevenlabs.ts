import type { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import {
  loadElevenLabsKey,
  listVoices,
  fetchVoicePreview,
  synthesize,
  fileExtensionForFormat,
  ElevenLabsError,
  type SynthesizeOptions,
} from "../../elevenlabs/index.js";

const VALID_FORMATS: readonly string[] = [
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_16000",
  "pcm_22050",
  "pcm_44100",
];

interface GenerateBody {
  text?: string;
  voiceId?: string;
  filename?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  outputFormat?: string;
}

function keyMissingResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "ELEVENLABS_API_KEY not set. Add it to <project>/.env, ~/.hyperframes/.env, or the process environment.",
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function elevenLabsError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof ElevenLabsError && err.status ? err.status : 502;
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function registerElevenLabsRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Voice list — uses project-scoped key when a project is supplied via query param.
  api.get("/elevenlabs/voices", async (c) => {
    const projectId = c.req.query("project");
    let projectDir: string | undefined;
    if (projectId) {
      const project = await adapter.resolveProject(projectId);
      if (project) projectDir = project.dir;
    }
    const apiKey = loadElevenLabsKey(projectDir);
    if (!apiKey) return keyMissingResponse();

    try {
      const voices = await listVoices(apiKey);
      return c.json({
        voices: voices.map((v) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category,
          labels: v.labels ?? {},
          description: v.description,
          // Browser-safe preview URL — hits our proxy so the API key never leaves the server.
          preview_url: `/api/elevenlabs/voices/${encodeURIComponent(v.voice_id)}/preview${
            projectId ? `?project=${encodeURIComponent(projectId)}` : ""
          }`,
        })),
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });

  // Stream the short preview clip for one voice.
  api.get("/elevenlabs/voices/:voiceId/preview", async (c) => {
    const projectId = c.req.query("project");
    let projectDir: string | undefined;
    if (projectId) {
      const project = await adapter.resolveProject(projectId);
      if (project) projectDir = project.dir;
    }
    const apiKey = loadElevenLabsKey(projectDir);
    if (!apiKey) return keyMissingResponse();

    try {
      const result = await fetchVoicePreview(apiKey, c.req.param("voiceId"));
      if (!result) {
        return c.json({ error: "preview not available" }, 404);
      }
      return new Response(result.body, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });

  // Synthesize speech and write it into the project's assets/voice directory.
  api.post("/projects/:id/elevenlabs/generate", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const apiKey = loadElevenLabsKey(project.dir);
    if (!apiKey) return keyMissingResponse();

    let body: GenerateBody;
    try {
      body = (await c.req.json()) as GenerateBody;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const text = body.text?.trim();
    const voiceId = body.voiceId?.trim();
    if (!text) return c.json({ error: "text is required" }, 400);
    if (!voiceId) return c.json({ error: "voiceId is required" }, 400);

    let outputFormat: NonNullable<SynthesizeOptions["outputFormat"]> = "mp3_44100_128";
    if (body.outputFormat) {
      if (!VALID_FORMATS.includes(body.outputFormat)) {
        return c.json({ error: `invalid outputFormat. valid: ${VALID_FORMATS.join(", ")}` }, 400);
      }
      outputFormat = body.outputFormat as typeof outputFormat;
    }

    const ext = fileExtensionForFormat(outputFormat);
    const safeFilename = sanitizeFilename(body.filename) ?? `voice/scene-${Date.now()}.${ext}`;
    const relativePath = safeFilename.endsWith(`.${ext}`) ? safeFilename : `${safeFilename}.${ext}`;
    const finalRelative = relativePath.startsWith("assets/")
      ? relativePath
      : `assets/${relativePath}`;
    const absPath = resolve(project.dir, finalRelative);
    if (!isSafePath(project.dir, absPath)) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const { bytes } = await synthesize(apiKey, text, voiceId, {
        modelId: body.modelId,
        stability: body.stability,
        similarityBoost: body.similarityBoost,
        style: body.style,
        outputFormat,
      });
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, bytes);
      return c.json({
        ok: true,
        path: finalRelative,
        bytes: bytes.byteLength,
        format: outputFormat,
      });
    } catch (err) {
      return elevenLabsError(err);
    }
  });
}

function sanitizeFilename(value: string | undefined): string | null {
  if (!value) return null;
  // Allow forward slashes for subdirectory hints, strip everything else risky.
  const cleaned = value
    .replace(/\\/g, "/")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9._\-/]/g, "_")
    .replace(/^\/+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
