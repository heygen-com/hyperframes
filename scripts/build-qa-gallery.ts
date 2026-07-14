import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const JOBS = [
  "demonstrate",
  "emphasize",
  "reveal",
  "agitate",
  "prove",
  "compare",
  "exhibit",
  "payoff",
  "bridge",
  "ask",
] as const;

// Display names for the groups (coverage-map rows keep the internal keys above).
const GROUP_NAMES: Record<string, string> = {
  demonstrate: "Product demo",
  emphasize: "Text effects",
  reveal: "Intros & reveals",
  agitate: "Problem setup",
  prove: "Proof & stats",
  compare: "Before / after",
  exhibit: "Feature tour",
  payoff: "Celebrations",
  bridge: "Transitions",
  ask: "Call to action",
};

function groupName(job: string): string {
  return GROUP_NAMES[job] ?? job;
}

// Trimmed 2026-07-14: PARTIAL stand-ins whose displayed comp is materially a
// different mechanic than the candidate (misleads taste QA). The candidates
// stay in the coverage map as the to-build backlog; only the preview card goes.
const TRIMMED_STANDINS = new Set([]);

type Status = "EXISTS" | "PARTIAL" | "BUILT" | "GAP";

export interface Candidate {
  candidate: string;
  job: string;
  status: Status;
  registryPath: string | undefined;
  note: string;
}

interface VariableDefinition {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  default?: unknown;
  options?: unknown;
}

export interface Knob {
  name: string;
  value: string | number;
  options?: string[];
}

interface LocalAsset {
  source: string;
  target: string;
}

interface LocalAssetPlan {
  html: string;
  assets: LocalAsset[];
}

interface StageResult {
  candidate: Candidate;
  compiled: boolean;
  knobs: Knob[];
  error?: string;
}

function stripMarkdown(value: string): string {
  return value.replaceAll("`", "").replaceAll("**", "").trim();
}

function normalizeDashes(value: string): string {
  return value.replaceAll("\u2014", "-").replaceAll("\u2013", "-");
}

export function planLocalAssets(html: string, candidate: string): LocalAssetPlan {
  const assets: LocalAsset[] = [];
  const targets = new Map<string, string>();
  const stagedHtml = html.replace(
    /(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/g,
    (full: string, prefix: string, quote: string, source: string) => {
      if (source.startsWith("/") || source.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(source)) {
        return full;
      }

      let target = targets.get(source);
      if (!target) {
        const sourcePath = source.split(/[?#]/, 1)[0];
        target = `${candidate}-assets/${assets.length}-${basename(sourcePath)}`;
        targets.set(source, target);
        assets.push({ source: sourcePath, target });
      }
      return `${prefix}${quote}./${target}${quote}`;
    },
  );
  return { html: stagedHtml, assets };
}

function cleanNote(value: string, registryPath: string | undefined): string {
  let note = normalizeDashes(stripMarkdown(value));
  if (registryPath && note.startsWith(registryPath)) note = note.slice(registryPath.length);
  note = note
    .replace(/^\s*[-:;]\s*/, "")
    .replace(/^(contract-shaped|needs adapting)(?:\s*\([^)]*\))?\s*;\s*/i, "");

  const difference = note.match(/\bbut\s+(.+)$/i);
  if (difference?.[1]) note = difference[1];
  note = note.replace(/^it\s+/i, "").trim();
  if (note.length <= 180) return note;
  return `${note.slice(0, 177).replace(/\s+\S*$/, "")}...`;
}

function parseStatus(value: string): Status | undefined {
  const status = stripMarkdown(value);
  if (status === "EXISTS" || status === "PARTIAL" || status === "BUILT" || status === "GAP") {
    return status;
  }
  return undefined;
}

export function parseCoverageMap(markdown: string): Candidate[] {
  const candidates: Candidate[] = [];

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 5) continue;

    const [candidateCell, jobCell, , statusCell, pathOrNote] = cells;
    const status = parseStatus(statusCell);
    if (!status) continue;

    const registryPath = status === "GAP" ? undefined : pathOrNote.match(/`([^`]+)`/)?.[1];
    candidates.push({
      candidate: stripMarkdown(candidateCell),
      job: stripMarkdown(jobCell).replace(/\s*\(ambient cross-shelf\)$/, ""),
      status,
      registryPath,
      note: cleanNote(pathOrNote, registryPath),
    });
  }

  return candidates;
}

function isVariableDefinition(value: unknown): value is VariableDefinition {
  return typeof value === "object" && value !== null;
}

function optionValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((option) => {
    if (typeof option === "string" || typeof option === "number") return [String(option)];
    if (typeof option !== "object" || option === null || !("value" in option)) return [];
    const optionValue = option.value;
    return typeof optionValue === "string" || typeof optionValue === "number"
      ? [String(optionValue)]
      : [];
  });
  return options.length > 0 ? options : undefined;
}

export function buildKnobs(variables: unknown[]): Knob[] {
  return variables.flatMap((variable) => {
    if (!isVariableDefinition(variable)) return [];
    const name =
      typeof variable.id === "string"
        ? variable.id
        : typeof variable.name === "string"
          ? variable.name
          : undefined;
    const value = variable.default;
    if (!name || (typeof value !== "string" && typeof value !== "number")) return [];

    const options = optionValues(variable.options);
    return [{ name, value, ...(options ? { options } : {}) }];
  });
}

function decodeAttribute(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

function declaredVariables(html: string): unknown[] {
  const match = html.match(/data-composition-variables\s*=\s*(['"])([\s\S]*?)\1/);
  if (!match?.[2]) return [];

  try {
    const parsed: unknown = JSON.parse(decodeAttribute(match[2]));
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed !== "object" || parsed === null) return [];
    return Object.entries(parsed).map(([name, definition]) =>
      typeof definition === "object" && definition !== null
        ? { name, ...definition }
        : { name, default: definition },
    );
  } catch {
    return [];
  }
}

async function variablesFor(componentDir: string, sourcePath: string): Promise<Knob[]> {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(componentDir, "registry-item.json"), "utf8"),
    );
    if (typeof manifest === "object" && manifest !== null && "variables" in manifest) {
      const variables = manifest.variables;
      if (Array.isArray(variables)) {
        const knobs = buildKnobs(variables);
        if (knobs.length > 0) return knobs;
      }
    }
  } catch {
    // The HTML declaration remains the source of truth when metadata is absent.
  }

  const htmlFiles = (await readdir(componentDir))
    .filter((file) => file.endsWith(".html"))
    .map((file) => join(componentDir, file));
  const orderedFiles = [sourcePath, ...htmlFiles.filter((file) => file !== sourcePath)];
  for (const file of orderedFiles) {
    const knobs = buildKnobs(declaredVariables(await readFile(file, "utf8")));
    if (knobs.length > 0) return knobs;
  }
  return [];
}

async function sourceFor(componentDir: string): Promise<string> {
  const demo = join(componentDir, "demo.html");
  try {
    await readFile(demo, "utf8");
    return demo;
  } catch {
    const primitive = join(componentDir, `${basename(componentDir)}.html`);
    try {
      await readFile(primitive, "utf8");
      return primitive;
    } catch {
      const htmlFiles = (await readdir(componentDir)).filter((file) => file.endsWith(".html"));
      if (htmlFiles.length === 1) return join(componentDir, htmlFiles[0]);
      throw new Error("no unambiguous demo or primitive HTML found");
    }
  }
}

async function compileMounted(componentDir: string, sourcePath: string): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "hyperframes-qa-"));
  try {
    await cp(componentDir, projectDir, { recursive: true });
    await copyFile(join(projectDir, basename(sourcePath)), join(projectDir, "index.html"));
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    return await bundleToSingleHtml(projectDir);
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function playerCard(candidate: Candidate, knobs: Knob[]): string {
  const knobsAttribute =
    knobs.length > 0 ? ` data-knobs='${escapeHtml(JSON.stringify(knobs))}'` : "";
  const note = candidate.status === "PARTIAL" ? ` - differs: ${escapeHtml(candidate.note)}` : "";
  return `
        <article class="card">
          <div data-hf-player="true" data-src="/public/qa/${encodeURIComponent(candidate.candidate)}.html" data-width="1920" data-height="1080"${knobsAttribute} style="aspect-ratio: 16/9; background: #0b0c0e;"></div>
          <div class="label">${escapeHtml(candidate.candidate)} - ${escapeHtml(groupName(candidate.job))} - ${candidate.status}${note}</div>
        </article>`;
}

function placeholderCard(candidate: Candidate, failed: boolean): string {
  const status = failed ? `${candidate.status} (staging failed)` : "GAP (to build)";
  const note = candidate.status === "PARTIAL" ? ` - differs: ${escapeHtml(candidate.note)}` : "";
  return `
        <article class="card placeholder">
          <div class="empty"><span>${failed ? "Preview unavailable" : "Primitive to build"}</span></div>
          <div class="label">${escapeHtml(candidate.candidate)} - ${escapeHtml(groupName(candidate.job))} - ${status}${note}</div>
        </article>`;
}

export function renderGallery(candidates: Candidate[], stagedKnobs: Map<string, Knob[]>): string {
  const trimmed = candidates.filter((candidate) => TRIMMED_STANDINS.has(candidate.candidate));
  const shown = candidates.filter((candidate) => !TRIMMED_STANDINS.has(candidate.candidate));
  const trimmedList = trimmed
    .map(
      (candidate) =>
        `<li><b>${escapeHtml(candidate.candidate)}</b> (${escapeHtml(groupName(candidate.job))}) - ${escapeHtml(candidate.note)}</li>`,
    )
    .join("\n");
  const sections = JOBS.map((job) => {
    const cards = shown
      .filter((candidate) => candidate.job === job)
      .map((candidate) =>
        candidate.status === "GAP"
          ? placeholderCard(candidate, false)
          : stagedKnobs.has(candidate.candidate)
            ? playerCard(candidate, stagedKnobs.get(candidate.candidate) ?? [])
            : placeholderCard(candidate, true),
      )
      .join("\n");
    return `
      <section>
        <h2>${escapeHtml(groupName(job))}</h2>
        <div class="grid">${cards}
        </div>
      </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Video primitive QA gallery</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; background: #0a0a0b; color: #f2f2f4; font-family: system-ui, sans-serif; }
      header { max-width: 1480px; margin: 0 auto 36px; }
      h1 { margin: 0 0 8px; font-size: clamp(24px, 4vw, 42px); letter-spacing: -0.03em; }
      header p { margin: 0; color: #8a8a92; }
      section { max-width: 1480px; margin: 0 auto 40px; }
      h2 { margin: 0 0 14px; color: #e5484d; font: 600 14px ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px; }
      .card { overflow: hidden; background: #141416; border: 1px solid #26262b; border-radius: 10px; }
      .label { min-height: 46px; padding: 10px 12px; border-top: 1px solid #26262b; color: #8a8a92; font: 12px/1.45 ui-monospace, monospace; }
      .empty { display: grid; aspect-ratio: 16/9; place-items: center; background: #101012; color: #8a8a92; }
      .empty span { padding: 8px 12px; border: 1px dashed #26262b; border-radius: 999px; }
      .placeholder { border-style: dashed; }
      @media (max-width: 520px) { body { padding: 20px; } .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Video primitive QA gallery</h1>
      <p>${shown.length} candidate cards, organized into groups. Scrub live previews and adjust available variables.${trimmed.length > 0 ? ` ${trimmed.length} stand-in cards trimmed (listed at the bottom): their mechanic is not built yet and the nearest existing comp misrepresented it.` : ""}</p>
    </header>${sections}${
      trimmed.length > 0
        ? `
    <section>
      <h2>Trimmed stand-ins (mechanic not built yet)</h2>
      <ul style="color:#8a8a92; font: 13px/1.7 ui-monospace, monospace; padding-left: 18px;">
${trimmedList}
      </ul>
    </section>`
        : ""
    }
    <script src="/hyperframes-player.global.js"></script>
    <script src="/hyperframes-player-embed.js"></script>
    <script src="/qa-autoplay.js"></script>
  </body>
</html>
`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const coveragePath =
    process.argv[2] ?? resolve(repoRoot, "../../../..", "candidates-registry-coverage.md");
  const outputDir = join(repoRoot, "docs/public/qa");
  const galleryPath = join(repoRoot, "docs/qa-gallery.html");
  const candidates = parseCoverageMap(await readFile(coveragePath, "utf8"));
  if (candidates.length < 50) {
    throw new Error(`coverage map yielded only ${candidates.length} cards; parse likely broken`);
  }

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const compiledCache = new Map<string, Promise<string>>();
  const results: StageResult[] = [];
  for (const candidate of candidates) {
    if (candidate.status === "GAP" || TRIMMED_STANDINS.has(candidate.candidate)) continue;
    try {
      // Prefer the component dir whose name is the candidate's own slug when it
      // exists (correct for every built primitive); fall back to the coverage
      // row's path only for EXISTS components whose registry dir differs from
      // the candidate slug. The coverage parser can scrape a bogus backtick
      // token from the note column, so a truthy registryPath is not trusted
      // over an actually-present slug dir.
      const slugPath = `components/${candidate.candidate
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[\s_]+/g, "-")
        .toLowerCase()}`;
      const slugDir = join(repoRoot, "registry", slugPath);
      const componentDir = existsSync(slugDir)
        ? slugDir
        : join(repoRoot, "registry", candidate.registryPath ?? slugPath);
      const sourcePath = await sourceFor(componentDir);
      const html = await readFile(sourcePath, "utf8");
      const compiled = html.includes("data-composition-src");
      const outputPath = join(outputDir, `${candidate.candidate}.html`);

      if (compiled) {
        let bundled = compiledCache.get(sourcePath);
        if (!bundled) {
          bundled = compileMounted(componentDir, sourcePath);
          compiledCache.set(sourcePath, bundled);
        }
        await writeFile(outputPath, normalizeDashes(await bundled));
      } else {
        const plan = planLocalAssets(normalizeDashes(html), candidate.candidate);
        for (const asset of plan.assets) {
          const target = join(outputDir, asset.target);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(resolve(dirname(sourcePath), asset.source), target);
        }
        await writeFile(outputPath, plan.html);
      }

      const knobs = await variablesFor(componentDir, sourcePath);
      results.push({ candidate, compiled, knobs });
      console.log(
        `SUCCESS ${candidate.candidate}: ${compiled ? "compiled" : "copied"}${knobs.length > 0 ? `, ${knobs.length} knobs` : ""}`,
      );
    } catch (error) {
      const message = errorMessage(error);
      results.push({ candidate, compiled: false, knobs: [], error: message });
      console.error(`FAIL ${candidate.candidate}: ${message}`);
    }
  }

  const stagedKnobs = new Map(
    results
      .filter((result) => !result.error)
      .map((result) => [result.candidate.candidate, result.knobs]),
  );
  await writeFile(galleryPath, renderGallery(candidates, stagedKnobs));

  const successful = results.filter((result) => !result.error);
  const failed = results.filter((result) => result.error);
  const gapCards = candidates.filter((candidate) => candidate.status === "GAP");
  console.log("\nSUMMARY");
  console.log(`Staged OK: ${successful.length}`);
  console.log(`Compiled: ${successful.filter((result) => result.compiled).length}`);
  console.log(
    `Failed: ${failed.length}${failed.length > 0 ? ` (${failed.map((result) => result.candidate.candidate).join(", ")})` : ""}`,
  );
  console.log(
    `GAP placeholders: ${gapCards.length} cards (${new Set(gapCards.map((row) => row.candidate)).size} unique names)`,
  );
}

if (import.meta.main) {
  await main();
}
