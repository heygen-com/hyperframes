import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { transformHtml } from "./index.ts";
import { mergeNotes } from "./notes.ts";
import type {
  CodemodStatus,
  RegistryFileReport,
  RegistryItemReport,
  RegistryReport,
} from "./types.ts";

interface RegistryFileEntry {
  path: string;
  type: string;
}

interface RegistryManifest {
  name: string;
  type: string;
  files: RegistryFileEntry[];
}

const STATUSES: CodemodStatus[] = ["converted", "converted-with-warnings", "manual"];

export function scanRegistryTree(root: string): RegistryReport {
  const items = discoverRegistryItems(root).map((item) => scanRegistryItem(root, item));
  const totals = createTotals();
  for (const item of items) totals[item.status] += 1;
  return { root, totals, items };
}

export function renderMarkdownReport(report: RegistryReport): string {
  const manualBreakdown = manualReasonCounts(report);
  const lines = [
    "# GSAP to anime.js dry-run report",
    "",
    "## Totals",
    "",
    `- converted: ${report.totals.converted}`,
    `- converted-with-warnings: ${report.totals["converted-with-warnings"]}`,
    `- manual: ${report.totals.manual}`,
    `- total: ${report.items.length}`,
    "",
    "## Manual reason breakdown",
    "",
    ...renderReasonLines(manualBreakdown),
    "",
    "## Items",
    "",
    ...report.items.map(renderItemLine),
    "",
  ];
  return `${lines.join("\n")}`;
}

function discoverRegistryItems(root: string): RegistryManifest[] {
  const manifests: RegistryManifest[] = [];
  for (const kind of ["blocks", "components", "examples"]) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const itemDir = join(dir, entry.name);
      const manifest = readManifest(join(itemDir, "registry-item.json"));
      manifests.push(manifest ?? fallbackManifest(kind, entry.name, itemDir));
    }
  }
  return manifests.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function readManifest(path: string): RegistryManifest | null {
  if (!existsSync(path)) return null;
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const type = typeof raw.type === "string" ? raw.type : null;
  const files = Array.isArray(raw.files) ? readFiles(raw.files) : [];
  return name && type ? { name, type, files } : null;
}

function fallbackManifest(kind: string, name: string, itemDir: string): RegistryManifest {
  return {
    name,
    type: `hyperframes:${kind.slice(0, -1)}`,
    files: discoverHtmlFiles(itemDir, itemDir).map((path) => ({
      path,
      type: "hyperframes:composition",
    })),
  };
}

function discoverHtmlFiles(root: string, dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverHtmlFiles(root, path));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relative(root, path));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readFiles(files: unknown[]): RegistryFileEntry[] {
  const entries: RegistryFileEntry[] = [];
  for (const file of files) {
    if (!isRecord(file)) continue;
    if (typeof file.path !== "string" || typeof file.type !== "string") continue;
    entries.push({ path: file.path, type: file.type });
  }
  return entries;
}

function scanRegistryItem(root: string, manifest: RegistryManifest): RegistryItemReport {
  const kindDir = kindDirectory(manifest.type);
  const itemDir = join(root, kindDir, manifest.name);
  const files = compositionFiles(itemDir, manifest)
    .map((file) => scanRegistryFile(root, itemDir, file))
    .sort((a, b) => a.path.localeCompare(b.path));
  const status = combineStatus(files);
  return {
    kind: kindDir.slice(0, -1),
    name: manifest.name,
    path: relative(root, itemDir),
    status,
    changed: files.some((file) => file.changed),
    reasons: mergeNotes(files.map((file) => file.reasons)),
    warnings: mergeNotes(files.map((file) => file.warnings)),
    files,
  };
}

function compositionFiles(itemDir: string, manifest: RegistryManifest): RegistryFileEntry[] {
  const htmlFiles = manifest.files.filter(
    (file) =>
      file.path.endsWith(".html") &&
      existsSync(join(itemDir, file.path)) &&
      (file.type === "hyperframes:composition" || file.type === "hyperframes:snippet"),
  );
  if (htmlFiles.length > 0) return htmlFiles;
  const present = manifest.files.filter(
    (file) => file.path.endsWith(".html") && existsSync(join(itemDir, file.path)),
  );
  if (present.length > 0) return present;
  return readdirSync(itemDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => ({ path: entry.name, type: "hyperframes:composition" }));
}

function scanRegistryFile(
  root: string,
  itemDir: string,
  file: RegistryFileEntry,
): RegistryFileReport {
  const path = join(itemDir, file.path);
  const result = transformHtml(readFileSync(path, "utf-8"));
  return {
    path: relative(root, path),
    status: result.classification.status,
    changed: result.changed,
    reasons: result.classification.reasons,
    warnings: result.classification.warnings,
  };
}

function combineStatus(files: RegistryFileReport[]): CodemodStatus {
  if (files.some((file) => file.status === "manual")) return "manual";
  if (files.some((file) => file.status === "converted-with-warnings"))
    return "converted-with-warnings";
  return "converted";
}

function kindDirectory(type: string): string {
  if (type.endsWith(":component")) return "components";
  if (type.endsWith(":example")) return "examples";
  return "blocks";
}

function createTotals(): Record<CodemodStatus, number> {
  return {
    converted: 0,
    "converted-with-warnings": 0,
    manual: 0,
  };
}

function manualReasonCounts(report: RegistryReport): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of report.items) {
    if (item.status !== "manual") continue;
    for (const reason of item.reasons) counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function renderReasonLines(counts: Map<string, number>): string[] {
  if (counts.size === 0) return ["- none"];
  return [...counts.entries()].map(([reason, count]) => `- ${reason}: ${count}`);
}

function renderItemLine(item: RegistryItemReport): string {
  const notes =
    item.reasons.length > 0 ? ` (${item.reasons.map((reason) => reason.code).join(", ")})` : "";
  return `- ${item.status}: ${item.path}${notes}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function assertTotalsReconcile(report: RegistryReport): void {
  const total = STATUSES.reduce((sum, status) => sum + report.totals[status], 0);
  if (total !== report.items.length) {
    throw new Error(
      `Dry-run totals do not reconcile: ${total} totals for ${report.items.length} items`,
    );
  }
}
