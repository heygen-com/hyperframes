import { realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  isWithinProjectRoot,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";
import { readLinkedProjectFile } from "./linkedFile";
import { shaderDomainOffsets } from "./shaderDomains";
import { shaderDomainWarning } from "./rules/shaders";
import { sourcePosition } from "./sourceCoordinates";
import type { HyperframeLintFinding } from "./types";
import { parseHtmlStructure, readDecodedAttr } from "./utils";

interface HtmlSource {
  html: string;
  compSrcPath?: string;
}

function isAuthoredScript(path: string): boolean {
  return (
    /\.(?:js|mjs|cjs)$/i.test(path) &&
    !/(?:\.min\.js$|(?:^|[/\\])(?:vendor|node_modules)[/\\])/i.test(path)
  );
}

function localScript(projectDir: string, src: string, compSrcPath?: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return;
  const besideFile = src.startsWith("/") ? src : join(dirname(compSrcPath ?? "index.html"), src);
  const asset = resolveExistingLocalAsset(projectDir, besideFile);
  if (!asset) return;
  try {
    const file = realpathSync(asset.resolved);
    if (!isWithinProjectRoot(realpathSync(projectDir), file)) return;
    if (!isAuthoredScript(relative(projectDir, file))) return;
    return file;
  } catch {
    return;
  }
}

function linkedScripts(projectDir: string, { html, compSrcPath }: HtmlSource): string[] {
  const files: string[] = [];
  for (const script of parseHtmlStructure(html).scripts) {
    const tag = `<script ${script.attrs}>`;
    const type = readDecodedAttr(tag, "type") ?? "";
    if (type && !/^(?:module|(?:text|application)\/javascript)$/i.test(type)) continue;
    const src = readDecodedAttr(tag, "src");
    if (!src) continue;
    const file = localScript(projectDir, src, compSrcPath);
    if (file) files.push(file);
  }
  return files;
}

/** Follow directly linked authored scripts once; never fetch URLs or traverse dependencies. */
export function lintProjectShaderScripts(
  projectDir: string,
  sources: ReadonlyArray<HtmlSource>,
): HyperframeLintFinding[] {
  const files = new Set(sources.flatMap((source) => linkedScripts(projectDir, source)));
  const findings: HyperframeLintFinding[] = [];
  for (const file of files) {
    const read = readLinkedProjectFile(projectDir, file);
    if (read.kind !== "file") continue;
    for (const offset of shaderDomainOffsets(read.text)) {
      findings.push({
        ...shaderDomainWarning(),
        ...(offset === undefined ? { file } : sourcePosition(read.text, offset, file)),
      });
    }
  }
  return findings;
}
