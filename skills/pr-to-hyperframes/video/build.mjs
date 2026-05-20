// build.mjs — Generate index.html for a PR walkthrough video from a manifest
// JSON file. Reads slide definitions and branding config, then emits one HTML
// composition with timed clips + a single GSAP timeline driving slide
// transitions, code-focus pans, and captions sourced from whisper word-level
// transcripts of each audio file.
//
// Usage:
//   node build.mjs <path-to-manifest.json>
//
// Expects:
//   - audio-NN.wav files alongside the manifest (referenced by slide.audio)
//   - copies of those files in ./assets/audio-NN.wav (done by render.sh)
//   - whisper transcripts in ./transcripts/audio-NN.json (done by render.sh)
//   - manifest.branding for project-specific colors, fonts, and name
//
// Output: ./index.html (the hyperframes composition)

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// --- Args --------------------------------------------------------------------

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: node build.mjs <path-to-manifest.json>");
  process.exit(1);
}
const manifestAbs = path.resolve(manifestPath);
if (!fs.existsSync(manifestAbs)) {
  console.error(`Manifest not found: ${manifestAbs}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestAbs, "utf8"));

// --- Branding ----------------------------------------------------------------

const DEFAULT_BRANDING = {
  name: "Project",
  org: "",
  repo: "",
  logo: null,
  colors: {
    text: "#09090b",
    background: "#ffffff",
    accent: "#3b82f6",
    caption: "#ffd800",
    captionBg: "#09090b",
  },
  fonts: {
    body: "Geist",
    mono: "Geist Mono",
  },
};

const brand = { ...DEFAULT_BRANDING, ...manifest.branding };
brand.colors = { ...DEFAULT_BRANDING.colors, ...(manifest.branding?.colors || {}) };
brand.fonts = { ...DEFAULT_BRANDING.fonts, ...(manifest.branding?.fonts || {}) };

const repoSlug = brand.repo || `${brand.org}/${brand.name}`;

// --- Whisper transcripts -----------------------------------------------------

const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");
const transcripts = new Map();
if (fs.existsSync(TRANSCRIPTS_DIR)) {
  for (const f of fs.readdirSync(TRANSCRIPTS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const audioName = f.replace(/\.json$/, ".wav");
    transcripts.set(audioName, JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, f), "utf8")));
  }
}

function chunkTranscript(words, { maxWords = 7, gapThreshold = 0.45 } = {}) {
  const chunks = [];
  let current = [];
  for (const w of words) {
    if (current.length === 0) {
      current.push(w);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = w.start - prev.end;
    if (gap > gapThreshold || current.length >= maxWords) {
      chunks.push(current);
      current = [w];
    } else {
      current.push(w);
    }
  }
  if (current.length) chunks.push(current);
  return chunks.map((group) => ({
    text: group.map((g) => g.text).join(" "),
    start: group[0].start,
    end: group[group.length - 1].end,
  }));
}

function makeCaptions(audioFile, audioStart) {
  const words = transcripts.get(audioFile);
  if (!words) return [];
  const chunks = chunkTranscript(words);
  return chunks.map((c) => ({
    text: c.text,
    start: audioStart + c.start,
    duration: Math.max(0.4, c.end - c.start),
  }));
}

// --- Cumulative timing -------------------------------------------------------

let cursor = 0;
const timed = manifest.slides.map((slide, i) => {
  const start = cursor;
  const duration = slide.durationInSeconds;
  cursor += duration;
  return { slide, start, duration, i };
});
const totalDuration = cursor;

// --- HTML escape -------------------------------------------------------------

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Light syntax highlighting -----------------------------------------------

const KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "is",
  "let",
  "new",
  "null",
  "number",
  "of",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "void",
  "while",
  "yield",
  "any",
  "never",
  "unknown",
]);

function highlightLine(line) {
  const re =
    /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*')|("(?:\\.|[^"\\])*")|(`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|(@\w+)/g;
  let out = "";
  let last = 0;
  for (const m of line.matchAll(re)) {
    out += esc(line.slice(last, m.index));
    const [tok, comment, block, sq, dq, bt, num, ident, decorator] = m;
    if (comment || block) out += `<span class="t-c">${esc(tok)}</span>`;
    else if (sq || dq || bt) out += `<span class="t-s">${esc(tok)}</span>`;
    else if (num) out += `<span class="t-n">${esc(tok)}</span>`;
    else if (decorator) out += `<span class="t-d">${esc(tok)}</span>`;
    else if (ident) {
      if (KEYWORDS.has(ident)) out += `<span class="t-k">${esc(ident)}</span>`;
      else if (/^[A-Z]/.test(ident)) out += `<span class="t-t">${esc(ident)}</span>`;
      else out += esc(ident);
    }
    last = m.index + tok.length;
  }
  out += esc(line.slice(last));
  return out || "&nbsp;";
}

// --- Logo --------------------------------------------------------------------

function renderLogo() {
  if (brand.logo) {
    const ext = path.extname(brand.logo).toLowerCase();
    if (ext === ".svg") {
      const svgPath = path.resolve(brand.logo);
      if (fs.existsSync(svgPath)) {
        return fs.readFileSync(svgPath, "utf8");
      }
    }
    return `<img src="assets/${path.basename(brand.logo)}" class="project-logo" alt="${esc(brand.name)}" />`;
  }
  return `<span class="project-name-text">${esc(brand.name)}</span>`;
}

// --- Slide renderers ---------------------------------------------------------

function slideAttrs({ start, duration, i }, extra = "") {
  const initialStyle = i === 0 ? ` style="opacity: 1"` : "";
  return `class="clip slide" data-start="${start}" data-duration="${duration}" data-track-index="2" id="slide-${i}"${initialStyle} ${extra}`;
}

function renderIntro({ slide, start, duration, i }) {
  const title = slide.title || `PR #${manifest.pr}`;
  const cleanTitle = title.replace(/\s*#\d+\s*$/, "").trim();
  const words = cleanTitle.split(/\s+/);
  const highlightIndex = Math.max(0, words.length - 2);
  const highlighted = words
    .map((w, n) => (n === highlightIndex ? `<span class="special">${esc(w)}</span>` : esc(w)))
    .join(" ");

  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--intro">
		<div class="eyebrow">
			<span class="pill">Pull Request</span>
			<span>${esc(repoSlug)} &middot; #${manifest.pr}</span>
		</div>
		<h1 class="title-xl">${highlighted}</h1>
		${slide.subtitle ? `<p class="subtitle-lg">${esc(slide.subtitle)}</p>` : ""}
		<div class="meta-row">
			${slide.date ? `<span>${esc(slide.date)}</span><span class="dot"></span>` : ""}
			<span>Walkthrough</span>
		</div>
	</div>
</div>`;
}

function renderSegment({ slide, start, duration, i }) {
  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--segment">
		<div class="seg-rule"></div>
		<h2 class="title-segment">${esc(slide.title || "")}</h2>
		<div class="seg-rule"></div>
	</div>
</div>`;
}

function renderCode({ slide, start, duration, i }) {
  const lines = (slide.code || "").split("\n");
  const focus = slide.focus || [{ line: 0, at: 0 }];
  const codeLines = lines
    .map(
      (l, n) =>
        `<div class="cl" data-line="${n}"><span class="ln">${String(n + 1).padStart(2, " ")}</span><span class="lc">${highlightLine(l)}</span></div>`,
    )
    .join("");
  const focusJson = JSON.stringify(focus);
  return `
<div ${slideAttrs({ start, duration, i }, `data-focus='${focusJson}' data-kind="code"`)}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--code">
		<div class="file-bar">
			<span class="lang-badge">${esc(slide.language || "ts")}</span>
			<span class="file-name">${esc(slide.filename || "")}</span>
			<span class="slide-title">${esc(slide.title || "")}</span>
		</div>
		<div class="code-viewport">
			<div class="code-scroller" id="code-scroll-${i}">
				${codeLines}
			</div>
			<div class="code-fade code-fade--top"></div>
			<div class="code-fade code-fade--bottom"></div>
		</div>
	</div>
</div>`;
}

function renderDiffLines(diff) {
  const lines = diff.split("\n");
  return lines
    .map((l) => {
      let cls = "dl";
      let mark = "";
      if (l.startsWith("@@")) {
        cls += " dl-hunk";
        mark = "⋯";
      } else if (l.startsWith("+++") || l.startsWith("---")) {
        cls += " dl-meta";
      } else if (l.startsWith("+")) {
        cls += " dl-add";
        mark = "+";
      } else if (l.startsWith("-")) {
        cls += " dl-del";
        mark = "−";
      } else {
        mark = " ";
      }
      const body = l.startsWith("+") || l.startsWith("-") ? l.slice(1) : l;
      return `<div class="${cls}"><span class="dm">${esc(mark)}</span><span class="dc">${highlightLine(body)}</span></div>`;
    })
    .join("");
}

function renderDiff({ slide, start, duration, i }) {
  return `
<div ${slideAttrs({ start, duration, i }, `data-kind="diff"`)}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--code">
		<div class="file-bar">
			<span class="lang-badge">${esc(slide.language || "ts")}</span>
			<span class="file-name">${esc(slide.filename || "")}</span>
			<span class="slide-title">${esc(slide.title || "")}</span>
		</div>
		<div class="code-viewport">
			<div class="code-scroller" id="code-scroll-${i}">
				${renderDiffLines(slide.diff || "")}
			</div>
			<div class="code-fade code-fade--top"></div>
			<div class="code-fade code-fade--bottom"></div>
		</div>
	</div>
</div>`;
}

function renderText({ slide, start, duration, i }) {
  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--intro">
		<div class="eyebrow">
			<span class="pill">Summary</span>
			<span>${esc(repoSlug)} &middot; #${manifest.pr}</span>
		</div>
		<h1 class="title-xl">${esc(slide.title || "")}</h1>
		${slide.subtitle ? `<p class="subtitle-lg">${esc(slide.subtitle)}</p>` : ""}
	</div>
</div>`;
}

function renderList({ slide, start, duration, i }) {
  const items = (slide.items || [])
    .map(
      (it, n) =>
        `<li class="list-item"><span class="list-num">${n + 1}.</span><span>${esc(it)}</span></li>`,
    )
    .join("");
  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--list">
		<h2 class="title-list">${esc(slide.title || "")}</h2>
		<ol class="list-items">${items}</ol>
	</div>
</div>`;
}

function renderImage({ slide, start, duration, i }) {
  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--image">
		<img class="image-fill" src="assets/${esc(slide.src || "")}" alt=""/>
	</div>
</div>`;
}

function renderOutro({ start, duration, i }) {
  return `
<div ${slideAttrs({ start, duration, i })}>
	<div class="slide-bg"></div>
	<div class="slide-stage stage--outro">
		<div class="brand-big">${renderLogo()}</div>
		<div class="outro-meta">PR Walkthrough &middot; #${manifest.pr}</div>
		<div class="outro-attribution">Made with HyperFrames</div>
	</div>
</div>`;
}

const RENDERERS = {
  intro: renderIntro,
  segment: renderSegment,
  code: renderCode,
  diff: renderDiff,
  text: renderText,
  list: renderList,
  image: renderImage,
  outro: renderOutro,
};

const slidesHtml = timed
  .map((t) => {
    const r = RENDERERS[t.slide.type];
    if (!r) throw new Error(`Unknown slide type: ${t.slide.type}`);
    return r(t);
  })
  .join("");

// --- Audio elements ----------------------------------------------------------

const audioHtml = timed
  .filter(({ slide }) => slide.audio)
  .map(
    ({ slide, start, i }) =>
      `<audio class="clip" data-start="${start}" data-duration="${slide.durationInSeconds}" data-track-index="100" data-volume="1" src="assets/${slide.audio}" id="audio-${i}"></audio>`,
  )
  .join("\n");

// --- Captions ---------------------------------------------------------------

const allCaptions = [];
for (const { slide, start } of timed) {
  if (!slide.audio) continue;
  const caps = makeCaptions(slide.audio, start);
  allCaptions.push(...caps);
}

const CAPTION_GAP = 0.002;
const captionsHtml = allCaptions
  .map((c, k) => {
    const dur = Math.max(0.05, c.duration - CAPTION_GAP);
    return `<div class="clip caption" data-start="${c.start.toFixed(3)}" data-duration="${dur.toFixed(3)}" data-track-index="${60 + (k % 4)}" id="cap-${k}">${esc(c.text)}</div>`;
  })
  .join("\n");

// --- Timeline JS -------------------------------------------------------------

const timelineJs = [];

for (const { slide, start, duration, i } of timed) {
  const fadeIn = 0.4;
  const fadeOut = 0.4;
  if (i === 0) {
    timelineJs.push(`tl.set("#slide-${i}", { opacity: 1 }, ${start});`);
  } else {
    timelineJs.push(
      `tl.fromTo("#slide-${i}", { opacity: 0 }, { opacity: 1, duration: ${fadeIn}, ease: "power2.out" }, ${start});`,
    );
  }
  timelineJs.push(
    `tl.to("#slide-${i}", { opacity: 0, duration: ${fadeOut}, ease: "power2.in" }, ${start + duration - fadeOut});`,
  );
  timelineJs.push(`tl.set("#slide-${i}", { opacity: 0 }, ${start + duration});`);

  if ((slide.type === "code" || slide.type === "diff") && slide.focus && slide.focus.length) {
    const lineHeight = 36;
    const focus = slide.focus;
    const targets = focus.map((f) => ({
      t: start + (f.at || 0) * duration,
      y: -Math.max(0, f.line - 4) * lineHeight,
    }));
    timelineJs.push(`tl.set("#code-scroll-${i}", { y: ${targets[0].y} }, ${start});`);
    for (let k = 1; k < targets.length; k++) {
      const prev = targets[k - 1];
      const cur = targets[k];
      const dur = Math.max(0.5, cur.t - prev.t);
      timelineJs.push(
        `tl.to("#code-scroll-${i}", { y: ${cur.y}, duration: ${dur}, ease: "power1.inOut" }, ${prev.t});`,
      );
    }
  }
}

// --- Font imports ------------------------------------------------------------

const fontFamilies = [brand.fonts.body, brand.fonts.mono].filter(Boolean);
const fontImport = fontFamilies
  .map((f) => {
    const encoded = f.replace(/\s+/g, "+");
    return `${encoded}:wght@400;500;600;700`;
  })
  .join("&family=");

// --- Final HTML --------------------------------------------------------------

const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=1920, height=1080" />
		<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
		<link rel="preconnect" href="https://fonts.googleapis.com">
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
		<link href="https://fonts.googleapis.com/css2?family=${fontImport}&display=swap" rel="stylesheet">
		<style>
			* { margin: 0; padding: 0; box-sizing: border-box; }
			html, body {
				width: 1920px; height: 1080px; overflow: hidden;
				background: ${brand.colors.background};
				font-family: "${brand.fonts.body}", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
				font-feature-settings: "ss01", "ss02";
				color: ${brand.colors.text};
				-webkit-font-smoothing: antialiased;
			}

			.slide { position: absolute; inset: 0; opacity: 0; }
			.slide-bg { position: absolute; inset: 0; background: ${brand.colors.background}; }
			.slide-stage { position: absolute; inset: 0; }

			/* Hero / intro / text */
			.stage--intro {
				display: flex; flex-direction: column;
				justify-content: center; padding: 0 160px;
			}
			.eyebrow {
				display: inline-flex; align-items: center; gap: 16px;
				font-size: 22px; font-weight: 500;
				color: #71717a; margin-bottom: 40px;
			}
			.eyebrow .pill {
				background: ${brand.colors.accent}1a;
				border: 1px solid ${brand.colors.accent}59;
				padding: 6px 14px; border-radius: 6px;
				color: ${brand.colors.accent}; letter-spacing: 0.04em;
				font-weight: 600; font-size: 18px;
			}
			.title-xl {
				font-size: 132px; font-weight: 700; line-height: 1.02;
				letter-spacing: -0.035em; max-width: 1600px;
				color: ${brand.colors.text};
			}
			.special {
				background: ${brand.colors.accent}47;
				padding: 0 0.08em;
				border-radius: 6px;
				box-decoration-break: clone;
				-webkit-box-decoration-break: clone;
			}
			.subtitle-lg {
				margin-top: 48px; font-size: 34px; font-weight: 400;
				color: #52525b; max-width: 1500px; line-height: 1.4;
				letter-spacing: -0.005em;
			}
			.meta-row {
				margin-top: 72px; display: flex; align-items: center; gap: 28px;
				font-size: 22px; color: #71717a;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
				letter-spacing: 0.02em;
			}
			.meta-row .dot { width: 4px; height: 4px; background: #d4d4d8; border-radius: 50%; }

			/* Segment slide */
			.stage--segment {
				display: flex; flex-direction: column;
				justify-content: center; align-items: center;
				padding: 0 160px; gap: 56px;
			}
			.seg-rule {
				width: 96px; height: 2px;
				background: ${brand.colors.accent};
				border-radius: 1px;
			}
			.title-segment {
				font-size: 88px; font-weight: 600; letter-spacing: -0.03em;
				text-align: center; max-width: 1600px; line-height: 1.08;
				color: ${brand.colors.text};
			}

			/* Code / diff slide */
			.stage--code {
				display: flex; flex-direction: column;
				padding: 72px 96px 120px;
			}
			.file-bar {
				display: flex; align-items: center; gap: 20px;
				font-size: 22px; color: #71717a; margin-bottom: 28px;
				padding-bottom: 24px;
				border-bottom: 1px solid #e4e4e7;
			}
			.lang-badge {
				background: #f4f4f5;
				border: 1px solid #e4e4e7;
				color: #52525b; font-weight: 600;
				padding: 5px 10px; border-radius: 4px;
				font-size: 14px; text-transform: uppercase; letter-spacing: 0.10em;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
			}
			.file-name {
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
				color: ${brand.colors.text}; font-size: 22px; font-weight: 500;
			}
			.slide-title {
				margin-left: auto; color: #71717a;
				font-size: 22px; font-weight: 500;
				letter-spacing: -0.005em;
			}
			.code-viewport {
				position: relative; flex: 1;
				overflow: hidden;
				border-radius: 12px;
				background: #f6f8fa;
				border: 1px solid #d0d7de;
			}
			.code-scroller {
				will-change: transform;
				padding: 28px 0;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
				font-size: 22px; line-height: 36px;
				color: #24292f; font-weight: 500;
			}
			.code-fade { position: absolute; left: 0; right: 0; height: 64px; pointer-events: none; }
			.code-fade--top    { top: 0;    background: linear-gradient(180deg, #f6f8fa 0%, rgba(246,248,250,0) 100%); }
			.code-fade--bottom { bottom: 0; background: linear-gradient(0deg,   #f6f8fa 0%, rgba(246,248,250,0) 100%); }

			.cl { display: flex; padding: 0 32px; white-space: pre; }
			.cl .ln { color: #afb8c1; width: 56px; flex-shrink: 0; text-align: right; padding-right: 24px; user-select: none; }
			.cl .lc { flex: 1; }

			.dl { display: flex; padding: 0 32px; white-space: pre; }
			.dl .dm { width: 28px; flex-shrink: 0; color: #afb8c1; text-align: center; user-select: none; font-weight: 700; }
			.dl .dc { flex: 1; }
			.dl-add  { background: #dafbe1; }
			.dl-add  .dm { color: #1a7f37; }
			.dl-add  .dc { color: #1f2328; }
			.dl-del  { background: #ffebe9; }
			.dl-del  .dm { color: #cf222e; }
			.dl-del  .dc { color: #1f2328; }
			.dl-hunk { color: #57606a; background: #ddf4ff; }
			.dl-meta { color: #6e7781; opacity: 0.7; }

			/* GitHub Light syntax tokens */
			.t-c { color: #6e7781; font-style: italic; }
			.t-s { color: #0a3069; }
			.t-n { color: #0550ae; }
			.t-k { color: #cf222e; }
			.t-t { color: #1f883d; }
			.t-d { color: #8250df; }

			/* List slide */
			.stage--list {
				display: flex; flex-direction: column;
				justify-content: center; align-items: center;
				padding: 0 160px; gap: 64px;
			}
			.title-list {
				font-size: 72px; font-weight: 600; letter-spacing: -0.025em;
				color: ${brand.colors.text};
			}
			.list-items {
				list-style: none; display: flex; flex-direction: column;
				gap: 28px; font-size: 44px; color: ${brand.colors.text};
			}
			.list-item { display: flex; gap: 24px; align-items: baseline; }
			.list-num { color: ${brand.colors.accent}; font-weight: 700; min-width: 64px; text-align: right; }

			/* Image slide */
			.stage--image {
				display: flex; align-items: center; justify-content: center;
				padding: 64px 96px;
			}
			.image-fill {
				width: 100%; height: 100%;
				object-fit: contain;
			}

			/* Outro */
			.stage--outro {
				display: flex; flex-direction: column;
				justify-content: center; align-items: center; gap: 56px;
			}
			.brand-big {
				display: flex; align-items: center; justify-content: center;
				color: ${brand.colors.text};
			}
			.brand-big .project-logo { max-width: 720px; max-height: 200px; }
			.project-name-text {
				font-size: 120px; font-weight: 700; letter-spacing: -0.03em;
			}
			.outro-meta {
				font-size: 18px; color: #71717a;
				letter-spacing: 0.16em; text-transform: uppercase;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
			}
			.outro-attribution {
				font-size: 14px; color: #a1a1aa;
				letter-spacing: 0.12em; text-transform: uppercase;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
			}

			/* Footer */
			.footer-bar {
				position: absolute; bottom: 32px; left: 96px; right: 96px;
				display: flex;
				justify-content: space-between;
				align-items: center;
				font-size: 14px; color: #a1a1aa;
				letter-spacing: 0.10em; text-transform: uppercase;
				font-family: "${brand.fonts.mono}", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
				z-index: 10;
			}
			.brand {
				display: flex; align-items: center; gap: 12px;
				color: ${brand.colors.text}; font-weight: 600;
				font-family: "${brand.fonts.body}", sans-serif;
				letter-spacing: -0.01em; text-transform: none;
				font-size: 18px;
			}
			.footer-meta { color: #a1a1aa; }

			/* Captions */
			.caption-stage {
				position: absolute;
				bottom: 32px;
				left: 50%;
				transform: translateX(-50%);
				width: 100%;
				max-width: 1700px;
				z-index: 9;
				text-align: center;
				pointer-events: none;
			}
			.caption {
				position: absolute;
				bottom: 0;
				left: 50%;
				transform: translateX(-50%);
				width: max-content;
				max-width: 1700px;
				background: ${brand.colors.captionBg};
				color: ${brand.colors.caption};
				padding: 14px 24px;
				border-radius: 10px;
				font-family: "${brand.fonts.body}", sans-serif;
				font-size: 44px;
				font-weight: 700;
				letter-spacing: -0.02em;
				text-transform: none;
				text-align: center;
				line-height: 1.15;
				white-space: normal;
				text-wrap: balance;
				-webkit-text-wrap: balance;
			}

			/* Pie progress indicator */
			.progress-pie {
				position: absolute;
				top: 40px; right: 96px;
				width: 22px; height: 22px;
				z-index: 11;
				opacity: 0.85;
			}
			.progress-pie svg { width: 100%; height: 100%; display: block; }
		</style>
	</head>
	<body>
		<div id="root"
			data-composition-id="main"
			data-start="0"
			data-duration="${totalDuration}"
			data-width="1920"
			data-height="1080">

${slidesHtml}

			<div class="caption-stage clip" data-start="0" data-duration="${totalDuration}" data-track-index="49" id="caption-stage">
${captionsHtml}
			</div>

			<div class="footer-bar clip" data-start="0" data-duration="${totalDuration}" data-track-index="50" id="footer">
				<div class="brand"><span>${esc(brand.name)}</span></div>
				<div class="footer-meta">PR #${manifest.pr}</div>
			</div>

			<div class="progress-pie clip" data-start="0" data-duration="${totalDuration}" data-track-index="51" id="pie">
				<svg viewBox="0 0 64 64">
					<circle cx="32" cy="32" r="24" fill="none" stroke="#e4e4e7" stroke-width="8"/>
					<circle id="pie-fill" cx="32" cy="32" r="24" fill="none" stroke="${brand.colors.accent}" stroke-width="8"
						stroke-dasharray="150.796" stroke-dashoffset="150.796" stroke-linecap="butt"
						transform="rotate(-90 32 32)"/>
				</svg>
			</div>

${audioHtml}

		</div>

		<script>
			window.__timelines = window.__timelines || {};
			const tl = gsap.timeline({ paused: true });

${timelineJs.map((s) => "\t\t\t" + s).join("\n")}

			// Pie indicator
			tl.fromTo("#pie-fill",
				{ attr: { "stroke-dashoffset": 150.796 } },
				{ attr: { "stroke-dashoffset": 0 }, duration: ${totalDuration}, ease: "none" },
				0);

			tl.set("#footer", { opacity: 1 }, 0);
			tl.to("#footer", { opacity: 0, duration: 0.6 }, ${totalDuration - 0.6});

			window.__timelines["main"] = tl;
		</script>
	</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "index.html"), html);

console.log(`Wrote ${path.relative(process.cwd(), path.join(__dirname, "index.html"))}`);
console.log(`  ${timed.length} slides, ${totalDuration.toFixed(2)}s total`);
console.log(
  `  ${timed.filter((t) => t.slide.audio).length} audio tracks, ${allCaptions.length} captions`,
);
console.log(`  Branding: ${brand.name} (${repoSlug})`);
