import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import {
  getExplainerVideoJob,
  getUser,
  mergeExplainerVideoJob,
  uploadBufferArtifact,
  uploadFileArtifact,
  uploadJsonArtifact,
  readJsonArtifact,
} from "./amplifier.js";
import { authorComposition } from "./llm-client.js";
import {
  buildNarrationOnlyMessages,
  dimensionsForAspect,
  extendCompositionDuration,
  loadSkillBundle,
  lintCompositionHtml,
  NARRATION_JSON_SCHEMA,
  postRenderSanityCheck,
  probeDurationWithFfprobe,
  runCompositionLoop,
} from "./composition.js";
import type { SkillBundle } from "./composition.js";
import { synthesizeSpeechWithTimestamps } from "./elevenlabs.js";
import {
  briefWithLocalCover,
  injectQrCode,
  prefetchCoverImage,
  stripCrossoriginOnLocalImages,
} from "./post-process.js";
import type {
  AmplifierQueueMessage,
  ArtifactRef,
  ExplainerScript,
  ExplainerSourceArtifact,
  ExplainerVideoBrief,
  ExplainerVideoRenderPlan,
  RenderSceneCard,
  ScriptSegment,
  TimedWord,
} from "./types.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
const queueUrl = process.env.AMPLIFIER_VIDEO_QUEUE_URL?.trim() || "";
const pollWaitSeconds = Number.parseInt(process.env.WORKER_POLL_WAIT_SECONDS || "20", 10);
const visibilityTimeout = Number.parseInt(
  process.env.WORKER_VISIBILITY_TIMEOUT_SECONDS || "3600",
  10,
);
const healthPort = Number.parseInt(process.env.PORT || "3000", 10);
const renderWorkers = Math.max(
  1,
  Number.parseInt(process.env.HYPERFRAMES_RENDER_WORKERS || "1", 10),
);

let currentJobId: string | null = null;
let processedJobs = 0;
let failedJobs = 0;
let shuttingDown = false;

function titleCase(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function trimToWords(text: string, maxWords: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function sanitizeCandidateParagraph(paragraph: string, article: ExplainerVideoBrief["article"]) {
  const cleaned = paragraph.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const title = article.title.toLowerCase();
  const subtitle = (article.subtitle || "").toLowerCase();

  if (cleaned.length < 60) return null;
  if (lower === title || lower === subtitle) return null;
  if (lower.startsWith("thanks for reading")) return null;
  if (lower.startsWith("discussion about this post")) return null;
  if (lower.startsWith("install:")) return null;
  if (lower.includes("start your substack")) return null;
  if (lower.includes("privacy ∙ terms")) return null;
  if (lower.includes("this site requires javascript")) return null;

  return cleaned;
}

function expandParagraphCandidates(
  source: ExplainerSourceArtifact,
  article: ExplainerVideoBrief["article"],
) {
  const seed = [...source.article.paragraphs, ...source.article.text.split(/\n+/)];

  const expanded = seed.flatMap((paragraph) => {
    const cleaned = sanitizeCandidateParagraph(paragraph, article);
    if (!cleaned) return [];
    if (cleaned.length <= 420) return [cleaned];

    const sentences = splitSentences(cleaned);
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length > 360 && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  });

  return expanded.filter(Boolean);
}

function fingerprintText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 12)
    .join(" ");
}

function dedupeParagraphs(paragraphs: string[]) {
  const seen = new Set<string>();
  return paragraphs.filter((paragraph) => {
    const key = fingerprintText(paragraph);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitSupportPoints(text: string, maxPoints = 3) {
  return text
    .split(/[;:]\s+|,\s+(?=[A-Z0-9])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 18)
    .slice(0, maxPoints)
    .map((part) => trimToWords(part, 10));
}

function pickQuote(text: string) {
  const sentence =
    splitSentences(text)
      .filter((part) => part.length >= 60)
      .sort((a, b) => b.length - a.length)[0] || text;
  return trimToWords(sentence.replace(/^["“]|["”]$/g, ""), 24);
}

function buildNarrationFromParagraph(paragraph: string, maxWords: number, leadIn?: string) {
  const sentences = splitSentences(paragraph);
  const joined = [leadIn, sentences[0], sentences[1]]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return trimToWords(joined || paragraph, maxWords);
}

function buildSafeMeta(...values: Array<string | null | undefined>) {
  return values
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function deriveSceneTitle(paragraph: string, fallback: string) {
  const sentence = splitSentences(paragraph)[0] || paragraph;
  const words = sentence
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 5);
  return words.length ? titleCase(words.join(" ")) : fallback;
}

function fitNarration(maxWords: number, ...parts: Array<string | null | undefined>) {
  const joined = parts
    .map((part) => (part || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return trimToWords(joined, maxWords);
}

function buildExplainerScript(args: {
  brief: ExplainerVideoBrief;
  plan: ExplainerVideoRenderPlan;
  source: ExplainerSourceArtifact;
}): ExplainerScript {
  const paragraphs = dedupeParagraphs(expandParagraphCandidates(args.source, args.brief.article));
  const primaryAuthor = args.brief.article.primaryAuthor;
  const ctaUrl = args.plan.cta.url || args.brief.article.url;
  const publicationName = args.brief.article.publication?.name || "Amplifier";
  const uniqueParagraphs = {
    context:
      paragraphs[0] ||
      args.brief.article.description ||
      args.brief.article.subtitle ||
      args.brief.article.title,
    insight1:
      paragraphs[1] || paragraphs[0] || args.brief.article.description || args.brief.article.title,
    insight2:
      paragraphs[2] ||
      paragraphs[1] ||
      paragraphs[0] ||
      args.brief.article.description ||
      args.brief.article.title,
    evidence:
      paragraphs[3] ||
      paragraphs[2] ||
      paragraphs[1] ||
      paragraphs[0] ||
      args.brief.article.description ||
      args.brief.article.title,
  };
  const scenes: RenderSceneCard[] = [];
  const segments: ScriptSegment[] = [];
  let cursor = 0;

  args.plan.scenes.forEach((scene, index) => {
    const narrationBudget = Math.max(10, Math.round(scene.durationSeconds * 2.5));
    const alignment = index % 2 === 0 ? "left" : "right";

    let eyebrow = publicationName;
    let title = args.brief.article.title;
    let body = trimToWords(uniqueParagraphs.context, 24);
    let highlight: string | null = null;
    let meta: string | null = null;
    let ctaLabel: string | null = null;
    let narration = buildNarrationFromParagraph(uniqueParagraphs.context, narrationBudget);
    let supportingPoints: string[] = [];
    let kind: RenderSceneCard["kind"] =
      scene.id === "hook"
        ? "hook"
        : scene.id === "context"
          ? "context"
          : scene.id === "author"
            ? "author"
            : scene.id === "cta"
              ? "cta"
              : "insight";
    let layout: RenderSceneCard["layout"] = "split";

    switch (scene.id) {
      case "hook":
        layout = "hero";
        eyebrow = publicationName;
        title = args.brief.article.title;
        body = trimToWords(
          args.brief.article.subtitle || args.brief.article.description || args.brief.article.title,
          18,
        );
        narration = fitNarration(
          narrationBudget,
          args.brief.article.title,
          args.brief.article.subtitle || args.brief.article.description,
        );
        meta =
          buildSafeMeta(
            args.brief.article.primaryAuthor?.name,
            args.brief.article.publication?.name,
          ) || null;
        supportingPoints = splitSupportPoints(uniqueParagraphs.context, 3);
        break;
      case "context":
        layout = "split";
        eyebrow = "Why it matters";
        title = "The setup";
        body = trimToWords(uniqueParagraphs.context, 22);
        narration = buildNarrationFromParagraph(
          uniqueParagraphs.context,
          narrationBudget,
          "Here is the setup.",
        );
        supportingPoints = splitSupportPoints(uniqueParagraphs.context, 3);
        highlight = trimToWords(
          splitSentences(uniqueParagraphs.context)[0] || uniqueParagraphs.context,
          14,
        );
        break;
      case "insight-1":
        layout = "split";
        eyebrow = "Key point";
        title = deriveSceneTitle(uniqueParagraphs.insight1, "First insight");
        body = trimToWords(uniqueParagraphs.insight1, 22);
        narration = buildNarrationFromParagraph(
          uniqueParagraphs.insight1,
          narrationBudget,
          "The first real shift is this.",
        );
        supportingPoints = splitSupportPoints(uniqueParagraphs.insight1, 3);
        highlight = trimToWords(
          splitSentences(uniqueParagraphs.insight1)[0] || uniqueParagraphs.insight1,
          16,
        );
        break;
      case "insight-2":
        kind = "quote";
        layout = "quote";
        eyebrow = "The payoff";
        title = deriveSceneTitle(uniqueParagraphs.insight2, "What changes");
        highlight = pickQuote(uniqueParagraphs.evidence);
        body = trimToWords(uniqueParagraphs.insight2, 22);
        narration = buildNarrationFromParagraph(
          uniqueParagraphs.insight2,
          narrationBudget,
          "Then the payoff becomes clear.",
        );
        supportingPoints = splitSupportPoints(uniqueParagraphs.evidence, 2);
        break;
      case "author":
        layout = "author";
        eyebrow = "About the author";
        title = primaryAuthor ? primaryAuthor.name : "Author perspective";
        body = trimToWords(
          primaryAuthor?.bio ||
            [primaryAuthor?.role, args.brief.article.publication?.name]
              .filter(Boolean)
              .join(" · ") ||
            "The article comes from a practitioner perspective grounded in real operating work.",
          24,
        );
        narration = fitNarration(
          narrationBudget,
          primaryAuthor
            ? `${primaryAuthor.name}${primaryAuthor.role ? `, ${primaryAuthor.role}` : ""}.`
            : "This perspective comes from the author behind the article.",
          primaryAuthor?.bio,
        );
        meta = buildSafeMeta(primaryAuthor?.linkedin, primaryAuthor?.website) || null;
        break;
      case "cta":
        layout = "cta";
        eyebrow = "Read the full piece";
        title = args.plan.cta.label;
        body = trimToWords(
          args.brief.article.bookletLink?.shortUrl
            ? "The booklet keeps the argument, examples, and author context together in one link."
            : "The full article has the complete argument and examples.",
          24,
        );
        narration = fitNarration(
          narrationBudget,
          `${args.plan.cta.label}.`,
          args.brief.article.bookletLink?.shortUrl
            ? "Use the booklet link for the full argument and examples."
            : "Use the article link for the full argument and examples.",
        );
        meta = args.brief.article.bookletLink?.shortUrl || ctaUrl;
        ctaLabel = args.plan.cta.label;
        supportingPoints = [
          trimToWords(args.brief.article.title, 9),
          trimToWords(
            args.brief.article.subtitle ||
              args.brief.article.description ||
              "Full argument and examples.",
            9,
          ),
        ];
        break;
      default:
        break;
    }

    scenes.push({
      id: scene.id,
      kind,
      layout,
      eyebrow,
      title,
      body,
      highlight,
      meta,
      ctaLabel,
      supportingPoints,
      alignment,
      startSeconds: cursor,
      durationSeconds: scene.durationSeconds,
    });

    segments.push({
      id: scene.id,
      title,
      narration,
      durationSeconds: scene.durationSeconds,
    });

    cursor += scene.durationSeconds;
  });

  return {
    version: "2026-05-15",
    targetDurationSeconds: cursor,
    fullNarration: segments.map((segment) => segment.narration).join(" "),
    scenes,
    segments,
  };
}

function buildSyntheticWordTimings(segments: ScriptSegment[]) {
  const words: TimedWord[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const segmentWords = segment.narration.split(/\s+/).filter(Boolean);
    const step = segmentWords.length
      ? Math.max(0.16, segment.durationSeconds / segmentWords.length)
      : segment.durationSeconds;
    segmentWords.forEach((word, index) => {
      const start = cursor + index * step;
      words.push({
        text: word,
        start,
        end: Math.min(cursor + segment.durationSeconds, start + step * 0.82),
      });
    });
    cursor += segment.durationSeconds;
  }

  return words;
}

function timestampForSrt(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function buildCaptionGroups(words: TimedWord[]) {
  const groups: Array<{ text: string; start: number; end: number }> = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (!current.length) return;
    groups.push({
      text: current.map((word) => word.text).join(" "),
      start: current[0]?.start ?? 0,
      end: current[current.length - 1]?.end ?? current[0]?.end ?? 0,
    });
    current = [];
  };

  words.forEach((word) => {
    current.push(word);
    if (
      current.length >= 6 ||
      /[.!?]$/.test(word.text) ||
      (current[0] && word.end - current[0].start >= 2.4)
    ) {
      flush();
    }
  });

  flush();
  return groups;
}

function buildSrt(words: TimedWord[]) {
  return buildCaptionGroups(words)
    .map(
      (group, index) =>
        `${index + 1}\n${timestampForSrt(group.start)} --> ${timestampForSrt(group.end)}\n${
          group.text
        }\n`,
    )
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtmlTemplate(args: {
  brief: ExplainerVideoBrief;
  plan: ExplainerVideoRenderPlan;
  script: ExplainerScript;
  transcript: TimedWord[];
  durationSeconds: number;
  narrationSrc?: string | null;
}) {
  const dims = dimensionsForAspect(args.plan.aspectRatio);
  const palette =
    args.brief.interview.visualMode === "motion_social"
      ? {
          bgA: "#130f40",
          bgB: "#2b1055",
          accent: "#fb923c",
          accentAlt: "#f472b6",
          text: "#fff7ed",
          muted: "#fed7aa",
          panel: "rgba(20, 17, 52, 0.74)",
        }
      : args.brief.interview.visualMode === "documentary"
        ? {
            bgA: "#0f172a",
            bgB: "#1e293b",
            accent: "#f59e0b",
            accentAlt: "#fcd34d",
            text: "#f8fafc",
            muted: "#cbd5e1",
            panel: "rgba(15, 23, 42, 0.76)",
          }
        : args.brief.interview.visualMode === "captions_only"
          ? {
              bgA: "#020617",
              bgB: "#0f172a",
              accent: "#22c55e",
              accentAlt: "#34d399",
              text: "#f8fafc",
              muted: "#cbd5e1",
              panel: "rgba(2, 6, 23, 0.78)",
            }
          : {
              bgA: "#07111f",
              bgB: "#16324f",
              accent: "#7dd3fc",
              accentAlt: "#a78bfa",
              text: "#f8fafc",
              muted: "#cbd5e1",
              panel: "rgba(8, 19, 36, 0.74)",
            };

  const sceneMarkup = args.script.scenes
    .map((scene, index) => {
      const points =
        scene.supportingPoints && scene.supportingPoints.length
          ? `<div class="scene-points">${scene.supportingPoints
              .map(
                (point) =>
                  `<div class="scene-point scene-animate"><span class="scene-point-dot"></span>${escapeHtml(
                    point,
                  )}</div>`,
              )
              .join("")}</div>`
          : "";
      const authorImage =
        scene.layout === "author" && args.brief.article.primaryAuthor?.imageUrl
          ? `<img class="author-photo" src="${escapeHtml(
              args.brief.article.primaryAuthor.imageUrl,
            )}" alt="${escapeHtml(args.brief.article.primaryAuthor.name)}" />`
          : "";
      const meta = scene.meta
        ? `<div class="scene-meta scene-animate">${escapeHtml(scene.meta)}</div>`
        : "";
      const cta =
        scene.ctaLabel && args.plan.cta.url
          ? `<div class="scene-cta scene-animate">${escapeHtml(scene.ctaLabel)}</div>`
          : "";
      const highlight = scene.highlight
        ? `<div class="scene-highlight scene-animate">${escapeHtml(scene.highlight)}</div>`
        : "";
      const heroMarkup = `
        <div class="hero-copy">
          <div class="scene-eyebrow scene-animate">${escapeHtml(scene.eyebrow)}</div>
          <h1 class="scene-title scene-animate">${escapeHtml(scene.title)}</h1>
          <p class="scene-body scene-animate">${escapeHtml(scene.body)}</p>
          ${meta}
        </div>
        <div class="hero-rail scene-animate">
          ${points}
        </div>`;
      const splitMarkup = `
        <div class="accent-bar scene-animate"></div>
        <div class="scene-panel split-panel">
          <div class="scene-eyebrow scene-animate">${escapeHtml(scene.eyebrow)}</div>
          <h1 class="scene-title scene-animate">${escapeHtml(scene.title)}</h1>
          ${highlight}
          <p class="scene-body scene-animate">${escapeHtml(scene.body)}</p>
          ${meta}
        </div>
        <div class="scene-sidecar scene-animate">${points}</div>`;
      const quoteMarkup = `
        <div class="quote-frame scene-animate">
          <div class="quote-mark">“</div>
          <div class="scene-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <div class="quote-text">${escapeHtml(scene.highlight || scene.title)}</div>
          <div class="quote-support">${escapeHtml(scene.body)}</div>
          ${points}
        </div>`;
      const authorMarkup = `
        <div class="accent-bar scene-animate"></div>
        <div class="scene-panel author-panel">
          <div class="scene-eyebrow scene-animate">${escapeHtml(scene.eyebrow)}</div>
          <h1 class="scene-title scene-animate">${escapeHtml(scene.title)}</h1>
          <p class="scene-body scene-animate">${escapeHtml(scene.body)}</p>
          ${meta}
        </div>
        ${authorImage}`;
      const ctaMarkup = `
        <div class="cta-board scene-animate">
          <div class="scene-eyebrow">${escapeHtml(scene.eyebrow)}</div>
          <h1 class="scene-title">${escapeHtml(scene.title)}</h1>
          <p class="scene-body">${escapeHtml(scene.body)}</p>
          ${points}
          ${cta}
          ${meta}
        </div>`;

      const sceneInner =
        scene.layout === "hero"
          ? heroMarkup
          : scene.layout === "quote"
            ? quoteMarkup
            : scene.layout === "author"
              ? authorMarkup
              : scene.layout === "cta"
                ? ctaMarkup
                : splitMarkup;

      return `
        <section
          id="scene-${index}"
          class="scene clip align-${scene.alignment} kind-${scene.kind} layout-${scene.layout}"
          data-start="${scene.startSeconds}"
          data-duration="${scene.durationSeconds}"
          data-track-index="1"
          style="visibility:hidden;opacity:0"
        >
          <div class="scene-shell">
            <div class="scene-orb scene-orb-a"></div>
            <div class="scene-orb scene-orb-b"></div>
            ${sceneInner}
          </div>
        </section>`;
    })
    .join("\n");

  const coverImage =
    args.brief.article.coverImage && args.brief.article.coverImage.trim()
      ? `<img
          id="cover-image"
          class="clip cover-image"
          data-start="0"
          data-duration="${Math.max(args.script.scenes[0]?.durationSeconds || 8, 8)}"
          data-track-index="0"
          src="${escapeHtml(args.brief.article.coverImage)}"
          alt=""
        />`
      : "";
  const narrationTrack =
    args.narrationSrc && args.narrationSrc.trim()
      ? `<audio
          id="narration-track"
          src="${escapeHtml(args.narrationSrc)}"
          data-start="0"
          data-duration="${args.durationSeconds}"
          data-track-index="8"
        ></audio>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(args.brief.article.title)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        width: ${dims.width}px;
        height: ${dims.height}px;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, ${palette.bgB} 0%, ${palette.bgA} 55%, #020617 100%);
        color: ${palette.text};
        font-family: "Helvetica Neue", Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      [data-composition-id="amplifier-explainer"] {
        position: relative;
        width: ${dims.width}px;
        height: ${dims.height}px;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.08), transparent 38%),
          radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.05), transparent 32%);
      }

      .cover-image {
        position: absolute;
        inset: 0;
        width: ${dims.width}px;
        height: ${dims.height}px;
        object-fit: cover;
        filter: brightness(0.32) saturate(1.05);
      }

      .canvas-wash {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(135deg, rgba(2, 6, 23, 0.14), rgba(2, 6, 23, 0.58)),
          linear-gradient(0deg, rgba(2, 6, 23, 0.55), transparent 50%);
        pointer-events: none;
      }

      .grain {
        position: absolute;
        inset: 0;
        opacity: 0.14;
        mix-blend-mode: screen;
        background-image:
          radial-gradient(circle at 20% 20%, rgba(255,255,255,0.65) 0 1px, transparent 1px),
          radial-gradient(circle at 80% 65%, rgba(255,255,255,0.55) 0 1px, transparent 1px),
          radial-gradient(circle at 40% 80%, rgba(255,255,255,0.4) 0 1px, transparent 1px);
        background-size: 160px 160px;
      }

      .brand-lockup {
        position: absolute;
        top: 48px;
        left: 56px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 12;
      }

      .brand-kicker {
        display: inline-flex;
        width: fit-content;
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 15px;
        font-weight: 700;
        color: ${palette.muted};
      }

      .brand-title {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .scene {
        position: absolute;
        inset: 0;
        padding: 140px 72px 170px;
      }

      .scene-shell {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .scene-orb {
        position: absolute;
        border-radius: 999px;
        filter: blur(16px);
        opacity: 0.22;
        pointer-events: none;
      }

      .scene-orb-a {
        top: 80px;
        left: 120px;
        width: 340px;
        height: 340px;
        background: ${palette.accent};
      }

      .scene-orb-b {
        right: 120px;
        bottom: 80px;
        width: 420px;
        height: 420px;
        background: ${palette.accentAlt};
      }

      .accent-bar {
        position: absolute;
        top: 0;
        width: 220px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, ${palette.accent}, ${palette.accentAlt});
        transform-origin: left center;
        box-shadow: 0 12px 42px rgba(0, 0, 0, 0.32);
      }

      .scene.align-left .accent-bar,
      .scene.align-left .scene-panel {
        left: 0;
      }

      .scene.align-right .accent-bar,
      .scene.align-right .scene-panel {
        right: 0;
      }

      .scene-panel {
        position: absolute;
        top: 42px;
        width: 960px;
        padding: 42px 48px 38px;
        border-radius: 34px;
        background: ${palette.panel};
        border: 1px solid rgba(255, 255, 255, 0.14);
        backdrop-filter: blur(18px);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.3);
      }

      .split-panel {
        left: 0;
      }

      .scene.align-right .split-panel {
        left: auto;
        right: 0;
      }

      .scene-eyebrow {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: ${palette.muted};
      }

      .scene-title {
        margin: 18px 0 0;
        font-size: 68px;
        line-height: 1.02;
        letter-spacing: -0.04em;
        max-width: 10ch;
      }

      .layout-hero .scene-title {
        max-width: 12ch;
        font-size: 84px;
      }

      .scene-body {
        margin: 24px 0 0;
        font-size: 28px;
        line-height: 1.38;
        color: rgba(248, 250, 252, 0.92);
        max-width: 30ch;
      }

      .scene-highlight {
        margin-top: 22px;
        padding-left: 20px;
        border-left: 4px solid ${palette.accent};
        font-size: 24px;
        line-height: 1.35;
        color: ${palette.text};
        max-width: 32ch;
      }

      .scene-meta {
        margin-top: 24px;
        font-size: 18px;
        line-height: 1.5;
        color: ${palette.muted};
        max-width: 30ch;
      }

      .scene-cta {
        margin-top: 28px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 14px 22px;
        border-radius: 999px;
        font-size: 18px;
        font-weight: 700;
        color: #020617;
        background: linear-gradient(90deg, ${palette.accent}, ${palette.accentAlt});
      }

      .scene-points {
        display: grid;
        gap: 14px;
        margin-top: 24px;
      }

      .scene-point {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px 18px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 20px;
        line-height: 1.35;
        color: ${palette.text};
      }

      .scene-point-dot {
        width: 10px;
        height: 10px;
        margin-top: 8px;
        border-radius: 999px;
        flex: 0 0 auto;
        background: linear-gradient(180deg, ${palette.accent}, ${palette.accentAlt});
      }

      .hero-copy {
        position: absolute;
        left: 0;
        bottom: 100px;
        max-width: 980px;
      }

      .hero-rail {
        position: absolute;
        top: 40px;
        right: 0;
        width: 430px;
      }

      .layout-hero .scene-body {
        max-width: 22ch;
        font-size: 32px;
      }

      .layout-hero .scene-meta {
        font-size: 20px;
      }

      .scene-sidecar {
        position: absolute;
        top: 120px;
        right: 0;
        width: 460px;
      }

      .scene.align-right .scene-sidecar {
        left: 0;
        right: auto;
      }

      .quote-frame {
        position: absolute;
        inset: 80px 120px 110px;
        padding: 56px 64px;
        border-radius: 40px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03)),
          ${palette.panel};
        border: 1px solid rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(18px);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.3);
      }

      .quote-mark {
        font-size: 140px;
        line-height: 0.8;
        color: ${palette.accent};
        opacity: 0.9;
      }

      .quote-text {
        margin-top: 18px;
        max-width: 20ch;
        font-size: 72px;
        line-height: 1.05;
        letter-spacing: -0.04em;
      }

      .quote-support {
        margin-top: 24px;
        max-width: 34ch;
        font-size: 26px;
        line-height: 1.4;
        color: rgba(248, 250, 252, 0.92);
      }

      .quote-frame .scene-points {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 28px;
      }

      .author-panel {
        left: 0;
        width: 860px;
      }

      .author-photo {
        position: absolute;
        right: 96px;
        bottom: 40px;
        width: 320px;
        height: 400px;
        object-fit: cover;
        border-radius: 28px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
      }

      .scene.align-right .author-photo {
        left: 96px;
        right: auto;
      }

      .cta-board {
        position: absolute;
        left: 50%;
        top: 52%;
        width: 980px;
        padding: 56px 64px 48px;
        transform: translate(-50%, -50%);
        border-radius: 40px;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
          ${palette.panel};
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 30px 100px rgba(0, 0, 0, 0.34);
        text-align: center;
      }

      .cta-board .scene-title,
      .cta-board .scene-body,
      .cta-board .scene-meta {
        margin-left: auto;
        margin-right: auto;
      }

      .cta-board .scene-title {
        max-width: 12ch;
      }

      .cta-board .scene-points {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 28px;
      }

      .cta-board .scene-meta {
        margin-top: 22px;
        font-size: 16px;
        letter-spacing: 0.02em;
        text-transform: none;
        word-break: break-word;
      }

      #captions-overlay {
        position: absolute;
        left: 72px;
        right: 72px;
        bottom: 48px;
        min-height: 120px;
        z-index: 14;
        pointer-events: none;
      }

      .caption-chip {
        position: absolute;
        left: 50%;
        bottom: 0;
        transform: translateX(-50%);
        display: inline-flex;
        padding: 18px 28px;
        border-radius: 28px;
        background: rgba(2, 6, 23, 0.84);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 20px 56px rgba(0, 0, 0, 0.34);
        font-size: 30px;
        line-height: 1.28;
        font-weight: 700;
        text-align: center;
        color: ${palette.text};
        max-width: 1200px;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="amplifier-explainer"
      data-width="${dims.width}"
      data-height="${dims.height}"
      data-duration="${args.durationSeconds}"
    >
      ${coverImage}
      <div class="canvas-wash"></div>
      <div class="grain"></div>
      ${narrationTrack}
      <div class="brand-lockup">
        <div class="brand-kicker">${escapeHtml(
          args.brief.article.publication?.name || "Amplify explainer",
        )}</div>
        <div class="brand-title">${escapeHtml(
          args.brief.article.primaryAuthor?.name || args.brief.article.title,
        )}</div>
      </div>
      ${sceneMarkup}
      <div id="captions-overlay"></div>
    </div>

    <script>
      const SCENES = ${JSON.stringify(args.script.scenes)};
      const TRANSCRIPT = ${JSON.stringify(args.transcript)};
      const DURATION = ${JSON.stringify(args.durationSeconds)};
      window.__timelines = window.__timelines || {};

      const tl = gsap.timeline({ paused: true });
      tl.set(".scene", { autoAlpha: 0 }, 0);

      if (document.getElementById("cover-image")) {
        tl.to(
          "#cover-image",
          {
            scale: 1.06,
            duration: Math.max(SCENES[0]?.durationSeconds || 8, 8),
            ease: "none",
          },
          0,
        );
        tl.to(
          "#cover-image",
          {
            autoAlpha: 0.2,
            duration: 0.8,
            ease: "power2.out",
          },
          Math.max((SCENES[0]?.durationSeconds || 8) - 0.6, 0.2),
        );
      }

      SCENES.forEach((scene, index) => {
        const selector = "#scene-" + index;
        const panel = selector + " .scene-panel, " + selector + " .quote-frame, " + selector + " .cta-board";
        const accent = selector + " .accent-bar";
        const animateTargets = selector + " .scene-animate";
        const start = scene.startSeconds;
        const hold = Math.max(scene.durationSeconds - 0.85, 0.25);

        tl.set(selector, { autoAlpha: 1 }, start);
        tl.fromTo(accent, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.45, ease: "power2.out" }, start + 0.02);
        tl.fromTo(
          panel,
          { y: 40, opacity: 0, scale: 0.98 },
          { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: "power2.out" },
          start + 0.04,
        );
        tl.fromTo(
          animateTargets,
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.42, stagger: 0.06, ease: "power2.out" },
          start + 0.14,
        );
        tl.to(
          panel,
          { y: -10, duration: hold, ease: "sine.inOut" },
          start + 0.56,
        );
        tl.to(
          selector,
          { autoAlpha: 0, duration: 0.28, ease: "power2.in" },
          Math.max(start + scene.durationSeconds - 0.28, start + 0.8),
        );
      });

      function buildCaptionGroups(words) {
        const groups = [];
        let current = [];
        const flush = () => {
          if (!current.length) return;
          groups.push({
            text: current.map((word) => word.text).join(" "),
            start: current[0].start,
            end: current[current.length - 1].end,
          });
          current = [];
        };

        words.forEach((word) => {
          current.push(word);
          if (
            current.length >= 6 ||
            /[.!?]$/.test(word.text) ||
            word.end - current[0].start >= 2.4
          ) {
            flush();
          }
        });

        flush();
        return groups;
      }

      const captionRoot = document.getElementById("captions-overlay");
      const captionGroups = buildCaptionGroups(TRANSCRIPT);
      captionGroups.forEach((group, index) => {
        const node = document.createElement("div");
        node.className = "caption-chip";
        node.id = "caption-group-" + index;
        node.textContent = group.text;
        captionRoot.appendChild(node);
        tl.fromTo(
          node,
          { autoAlpha: 0, y: 18, scale: 0.98 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.16, ease: "power2.out" },
          group.start,
        );
        tl.to(
          node,
          { autoAlpha: 0, y: 10, duration: 0.16, ease: "power2.in" },
          group.end + 0.04,
        );
      });

      window.__timelines["amplifier-explainer"] = tl;
    </script>
  </body>
</html>`;
}

const __amp_filename = fileURLToPath(import.meta.url);
const __amp_dirname = dirname(__amp_filename);
const SKILLS_ROOT =
  process.env.AMPLIFIER_WORKER_SKILLS_ROOT?.trim() || joinPath(__amp_dirname, "..", "skills");

let __cachedSkillBundle: SkillBundle | null = null;
function getSkillBundleOnce(): SkillBundle {
  if (!__cachedSkillBundle) {
    __cachedSkillBundle = loadSkillBundle(SKILLS_ROOT);
  }
  return __cachedSkillBundle;
}

const COMPOSITION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["indexHtml", "narration", "notes"],
  properties: {
    indexHtml: { type: "string" },
    narration: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sceneId", "startSeconds", "narrationText"],
        properties: {
          sceneId: { type: "string" },
          startSeconds: { type: "number" },
          narrationText: { type: "string" },
        },
      },
    },
    notes: { type: ["string", "null"] },
  },
} as const;

const COMPOSITION_MAX_ATTEMPTS = Number.parseInt(
  process.env.AMPLIFIER_COMPOSITION_MAX_ATTEMPTS || "5",
  10,
);
const COMPOSITION_LLM_TIMEOUT_MS = Number.parseInt(
  process.env.AMPLIFIER_COMPOSITION_LLM_TIMEOUT_MS || "240000",
  10,
);

interface NarrationSegment {
  sceneId: string;
  startSeconds: number;
  narrationText: string;
}

interface VoiceoverResult {
  voiceoverArtifact: ArtifactRef | null;
  narrationSrc: string | null;
  transcriptWords: TimedWord[];
}

async function authorNarrationPlan(opts: {
  brief: ExplainerVideoBrief;
  plan: ExplainerVideoRenderPlan;
  source: ExplainerSourceArtifact;
  skillBundle: SkillBundle;
  ai: { baseUrl: string; apiKey: string; model: string };
  timeoutMs: number;
}): Promise<NarrationSegment[] | null> {
  try {
    const narrationMessages = buildNarrationOnlyMessages({
      brief: opts.brief,
      plan: opts.plan,
      source: opts.source,
      skillBundle: opts.skillBundle,
    });
    const result = await authorComposition<{
      narration: NarrationSegment[];
      notes: string | null;
    }>({
      conversation: narrationMessages,
      schema: NARRATION_JSON_SCHEMA as object,
      schemaName: "amplifier_explainer_narration",
      ai: opts.ai,
      timeoutMs: opts.timeoutMs,
    });
    return result.narration && result.narration.length > 0 ? result.narration : null;
  } catch (err) {
    console.warn(
      "[worker] narration authoring failed; will use deterministic fallback script",
      err,
    );
    return null;
  }
}

function scriptFromNarration(
  narration: NarrationSegment[],
  targetDurationSeconds: number,
): ExplainerScript {
  const segments = narration.map((n, idx) => {
    const next = narration[idx + 1];
    const duration = next
      ? Math.max(0.5, next.startSeconds - n.startSeconds)
      : Math.max(0.5, targetDurationSeconds - n.startSeconds);
    return {
      id: n.sceneId,
      title: n.sceneId,
      narration: n.narrationText,
      durationSeconds: duration,
    };
  });
  return {
    version: "2026-05-15",
    targetDurationSeconds,
    fullNarration: narration.map((n) => n.narrationText).join(" "),
    scenes: [],
    segments,
  } as unknown as ExplainerScript;
}

async function synthesizeVoiceoverIfEnabled(opts: {
  script: ExplainerScript;
  plan: ExplainerVideoRenderPlan;
  projectDir: string;
  message: AmplifierQueueMessage;
  jobId: string;
  existingVoiceover: ArtifactRef | null;
  onStart: () => Promise<unknown>;
}): Promise<VoiceoverResult> {
  if (opts.plan.voice.enabled) {
    await opts.onStart();
    const voiceStyle = opts.plan.voice.style || "documentary";
    const seed = Number.parseInt(
      createHash("sha256").update(opts.jobId).digest("hex").slice(0, 8),
      16,
    );
    const tts = await synthesizeSpeechWithTimestamps({
      text: opts.script.fullNarration,
      style: voiceStyle,
      seed,
    });
    writeFileSync(join(opts.projectDir, "narration.mp3"), tts.audio);
    const voiceoverArtifact = await uploadBufferArtifact(
      opts.message.assetsBucket,
      `${opts.message.baseKey}/voiceover.mp3`,
      tts.audio,
      tts.mimeType,
    );
    return { voiceoverArtifact, narrationSrc: "narration.mp3", transcriptWords: tts.words };
  }
  if (opts.plan.captions.enabled) {
    return {
      voiceoverArtifact: opts.existingVoiceover,
      narrationSrc: null,
      transcriptWords: buildSyntheticWordTimings(opts.script.segments),
    };
  }
  return {
    voiceoverArtifact: opts.existingVoiceover,
    narrationSrc: null,
    transcriptWords: [],
  };
}

async function measureCanonicalDuration(opts: {
  narrationSrc: string | null;
  projectDir: string;
  transcriptWords: TimedWord[];
  scriptTargetDuration: number;
}): Promise<number> {
  let audioDurationSeconds = 0;
  if (opts.narrationSrc) {
    try {
      audioDurationSeconds = await probeDurationWithFfprobe(
        join(opts.projectDir, opts.narrationSrc),
      );
    } catch (err) {
      console.warn(
        `[worker] ffprobe failed on ${opts.narrationSrc}; falling back to transcript last-word end`,
        err,
      );
    }
  }
  const lastWordEnd = opts.transcriptWords[opts.transcriptWords.length - 1]?.end ?? 0;
  if (opts.transcriptWords.length > 0 || audioDurationSeconds > 0) {
    return Math.max(opts.scriptTargetDuration, audioDurationSeconds, lastWordEnd);
  }
  return opts.scriptTargetDuration;
}

async function processRenderJob(message: AmplifierQueueMessage) {
  let job = await getExplainerVideoJob(message.jobId);
  const source = await readJsonArtifact<ExplainerSourceArtifact>(
    message.assetsBucket,
    message.sourceKey,
  );

  job = await mergeExplainerVideoJob(message.jobId, {
    status: "planning",
    stage: "loading_assets",
    progress: 0.18,
    workerStatus: "processing",
    message: "Worker claimed the job and is loading the render inputs.",
  });

  let workDir: string | null = null;

  try {
    const user = await getUser(message.ownerUserId);
    if (!user.aiBaseUrl || !user.aiApiKey || !user.aiModel) {
      throw new Error("User AI configuration missing — cannot author composition.");
    }

    const skillBundle = getSkillBundleOnce();
    const aiConfig = {
      baseUrl: user.aiBaseUrl!,
      apiKey: user.aiApiKey!,
      model: user.aiModel!,
    };

    // ── Step 1: LLM authors narration only ──────────────────────────────────
    // Splitting narration from HTML lets us TTS first and feed the actual audio
    // length back into the HTML authoring call. Without this, the LLM authors
    // visual scenes for plan.targetDurationSeconds while ElevenLabs produces
    // audio of a different length — the canvas freezes once scenes end but
    // audio keeps playing (bd-33q round 3).
    await mergeExplainerVideoJob(message.jobId, {
      status: "planning",
      stage: "authoring_narration",
      progress: 0.22,
      message: "Authoring narration script.",
    });
    const narrationFromLlm = await authorNarrationPlan({
      brief: job.videoBrief,
      plan: job.plan,
      source,
      skillBundle,
      ai: aiConfig,
      timeoutMs: COMPOSITION_LLM_TIMEOUT_MS,
    });

    // ── Step 2: Build initial script (from LLM narration or fallback) ───────
    workDir = mkdtempSync(join(tmpdir(), "amplifier-video-worker-"));
    const projectDir = join(workDir, "project");
    mkdirSync(projectDir, { recursive: true });

    // Pre-fetch the cover image so the LLM can reference it as a local path —
    // Chromium's CORS rules reject Substack-hosted images during canvas capture
    // (no Access-Control-Allow-Origin), so remote URLs render as alt text.
    const localCoverPath = await prefetchCoverImage(job.videoBrief, projectDir);
    const briefForLlm = localCoverPath
      ? briefWithLocalCover(job.videoBrief, localCoverPath)
      : job.videoBrief;

    const script: ExplainerScript = narrationFromLlm
      ? scriptFromNarration(narrationFromLlm, job.plan.targetDurationSeconds)
      : buildExplainerScript({ brief: job.videoBrief, plan: job.plan, source });

    // ── Step 3: TTS first (before HTML authoring) ───────────────────────────
    const voiceover = await synthesizeVoiceoverIfEnabled({
      script,
      plan: job.plan,
      projectDir,
      message,
      jobId: job.jobId,
      existingVoiceover: job.artifacts.voiceover ?? null,
      onStart: async () => {
        job = await mergeExplainerVideoJob(message.jobId, {
          status: "voiceover",
          stage: "synthesizing_voiceover",
          progress: 0.3,
          message: "Generating voiceover with ElevenLabs.",
          billingSurfaceId: "elevenlabs:text-to-speech",
          rawBillingSurfaceKey: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
        });
      },
    });
    const { transcriptWords, narrationSrc, voiceoverArtifact } = voiceover;

    // ── Step 4: Probe actual audio duration ─────────────────────────────────
    const durationSeconds = await measureCanonicalDuration({
      narrationSrc,
      projectDir,
      transcriptWords,
      scriptTargetDuration: script.targetDurationSeconds,
    });

    // ── Step 5: LLM authors HTML composition for actual audio duration ──────
    // Derived plan overrides targetDurationSeconds so the LLM sizes scenes to
    // match the audio it has not seen but whose duration we now know exactly.
    const derivedPlan: ExplainerVideoRenderPlan = {
      ...job.plan,
      targetDurationSeconds: durationSeconds,
    };
    const predeterminedNarration = narrationFromLlm
      ? {
          scenes: narrationFromLlm.map((n) => ({
            sceneId: n.sceneId,
            startSeconds: n.startSeconds,
            narrationText: n.narrationText,
          })),
          audioDurationSeconds: durationSeconds,
        }
      : null;

    let currentAttemptCounter = 0;
    const loopResult = await runCompositionLoop({
      brief: briefForLlm,
      plan: derivedPlan,
      source,
      skillBundle,
      maxAttempts: COMPOSITION_MAX_ATTEMPTS,
      llmTimeoutMs: COMPOSITION_LLM_TIMEOUT_MS,
      llm: async (conversation) => {
        currentAttemptCounter += 1;
        await mergeExplainerVideoJob(message.jobId, {
          status: "planning",
          stage: `composing_attempt_${currentAttemptCounter}`,
          progress: Math.min(0.55, 0.4 + currentAttemptCounter * 0.04),
          message: `Authoring composition HTML (attempt ${currentAttemptCounter}/${COMPOSITION_MAX_ATTEMPTS}).`,
        });
        return authorComposition({
          conversation,
          schema: COMPOSITION_JSON_SCHEMA as object,
          schemaName: "amplifier_explainer_composition",
          ai: {
            baseUrl: user.aiBaseUrl!,
            apiKey: user.aiApiKey!,
            model: user.aiModel!,
          },
          timeoutMs: COMPOSITION_LLM_TIMEOUT_MS,
        });
      },
      lint: lintCompositionHtml,
      predeterminedNarration,
    });

    let usingFallback = false;
    let scriptArtifact: ArtifactRef | null = null;
    let authoredIndexHtml: string | null = null;

    if (loopResult.ok) {
      authoredIndexHtml = loopResult.indexHtml;
      scriptArtifact = await uploadBufferArtifact(
        message.assetsBucket,
        `${message.baseKey}/composition.html`,
        Buffer.from(loopResult.indexHtml, "utf-8"),
        "text/html",
      );
    } else {
      usingFallback = true;
      for (const err of loopResult.errors) {
        const detail = err.detail ? `\n\n${err.detail}` : "";
        await uploadBufferArtifact(
          message.assetsBucket,
          `${message.baseKey}/attempts/attempt-${err.attempt}-error.txt`,
          Buffer.from(`${err.kind}\n\n${err.message}${detail}`, "utf-8"),
          "text/plain",
        );
      }
      await mergeExplainerVideoJob(message.jobId, {
        status: "planning",
        stage: "fallback_template_render",
        progress: 0.58,
        message: `LLM HTML authoring failed after ${COMPOSITION_MAX_ATTEMPTS} attempts — using template renderer.`,
      });
      scriptArtifact = await uploadJsonArtifact(
        message.assetsBucket,
        `${message.baseKey}/script.json`,
        script,
      );
    }

    const transcriptArtifact =
      transcriptWords.length > 0
        ? await uploadJsonArtifact(
            message.assetsBucket,
            `${message.baseKey}/transcript.json`,
            transcriptWords,
          )
        : null;
    const captionsArtifact =
      transcriptWords.length > 0 && job.plan.captions.exportSrt
        ? await uploadBufferArtifact(
            message.assetsBucket,
            `${message.baseKey}/captions.srt`,
            Buffer.from(buildSrt(transcriptWords), "utf-8"),
            "application/x-subrip",
          )
        : null;

    job = await mergeExplainerVideoJob(message.jobId, {
      status: "rendering",
      stage: "building_composition",
      progress: 0.62,
      artifacts: {
        ...job.artifacts,
        script: scriptArtifact,
        transcript: transcriptArtifact,
        captions: captionsArtifact,
        voiceover: voiceoverArtifact,
      },
      message: usingFallback
        ? "Template script ready (fallback). Rendering explainer video with Hyperframes."
        : "LLM-authored composition accepted. Rendering explainer video with Hyperframes.",
    });
    if (!usingFallback && authoredIndexHtml) {
      // The LLM bakes data-duration to script.targetDurationSeconds (per
      // amplifier-constraints.md) but ElevenLabs narration is unbounded.
      // Extend the root, narration track, and last scene so audio plays
      // to completion instead of cutting off mid-sentence.
      const extended = extendCompositionDuration(authoredIndexHtml, durationSeconds);
      const withoutCrossorigin = stripCrossoriginOnLocalImages(extended.html);
      const qr = await injectQrCode(withoutCrossorigin, job.plan.cta.url);
      writeFileSync(join(projectDir, "index.html"), qr.html, "utf-8");
      if (extended.extended) {
        console.log(
          `[worker] extended LLM composition: ${extended.originalRootDurationSeconds}s → ${extended.newRootDurationSeconds}s`,
          extended.modifications,
        );
      }
      if (qr.injected) {
        console.log(
          `[worker] injected qr-code for ${job.plan.cta.url} (fallback=${qr.fallbackAppended})`,
        );
      }
    } else {
      writeFileSync(
        join(projectDir, "index.html"),
        buildHtmlTemplate({
          brief: job.videoBrief,
          plan: derivedPlan,
          script,
          transcript: transcriptWords,
          durationSeconds,
          narrationSrc,
        }),
        "utf-8",
      );
    }

    const outputPath = join(workDir, "output.mp4");
    const renderJob = createRenderJob({
      fps: { num: 30, den: 1 },
      quality: "high",
      format: "mp4",
      workers: renderWorkers,
      debug: false,
    });

    await executeRenderJob(renderJob, projectDir, outputPath);

    const sanity = await postRenderSanityCheck(outputPath, job.plan.targetDurationSeconds);
    if (!sanity.ok) {
      throw new Error(`Post-render sanity check failed: ${sanity.reason}`);
    }

    job = await mergeExplainerVideoJob(message.jobId, {
      status: "uploading",
      stage: "uploading_artifacts",
      progress: 0.9,
      message: "Uploading the finished MP4 and final artifacts.",
    });

    const videoArtifact = await uploadFileArtifact(
      message.assetsBucket,
      `${message.baseKey}/video.mp4`,
      outputPath,
      "video/mp4",
    );

    await mergeExplainerVideoJob(message.jobId, {
      status: "completed",
      stage: "complete",
      progress: 1,
      workerStatus: "completed",
      message: usingFallback
        ? `LLM authoring failed after ${COMPOSITION_MAX_ATTEMPTS} attempts — fell back to the template renderer.`
        : "Explainer video rendered successfully.",
      artifacts: {
        ...job.artifacts,
        script: scriptArtifact,
        transcript: transcriptArtifact,
        captions: captionsArtifact,
        voiceover: voiceoverArtifact,
        video: videoArtifact,
      },
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await mergeExplainerVideoJob(message.jobId, {
      status: "failed",
      stage: "worker_failed",
      progress: 0,
      workerStatus: "failed",
      failureCode: "worker_render_failed",
      message: messageText,
    });
    throw error;
  } finally {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function deleteMessage(receiptHandle: string) {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

async function pollOnce() {
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: pollWaitSeconds,
      VisibilityTimeout: visibilityTimeout,
    }),
  );

  const message = response.Messages?.[0];
  if (!message?.ReceiptHandle || !message.Body) {
    return;
  }

  let parsed: AmplifierQueueMessage;
  try {
    parsed = JSON.parse(message.Body) as AmplifierQueueMessage;
  } catch (error) {
    console.error("Invalid queue message body", error);
    await deleteMessage(message.ReceiptHandle);
    return;
  }

  currentJobId = parsed.jobId;
  try {
    await processRenderJob(parsed);
    processedJobs += 1;
    await deleteMessage(message.ReceiptHandle);
  } catch (error) {
    failedJobs += 1;
    console.error("Failed to process Amplifier explainer job", {
      jobId: parsed.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    await deleteMessage(message.ReceiptHandle);
  } finally {
    currentJobId = null;
  }
}

async function runLoop() {
  if (!queueUrl) {
    throw new Error("Missing AMPLIFIER_VIDEO_QUEUE_URL");
  }

  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (error) {
      console.error("Worker poll failure", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function startHealthServer() {
  const server = createServer((req, res) => {
    if (!req.url || req.url === "/health") {
      const body = JSON.stringify({
        ok: true,
        queueUrlConfigured: Boolean(queueUrl),
        currentJobId,
        processedJobs,
        failedJobs,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(healthPort, () => {
    console.log(`Amplifier video worker health server listening on ${healthPort}`);
  });
  return server;
}

export async function startWorker() {
  const server = startHealthServer();

  const stop = () => {
    shuttingDown = true;
    server.close();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await runLoop();
}

export type AmplifierWorkerHealthServer = Server;
