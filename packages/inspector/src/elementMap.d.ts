import type { Page } from "puppeteer-core";

export interface ElementNode {
  index: number;
  parent: number | null;
  selector: string;
  tag: string;
  id: string;
  hfId: string | null;
  classes: string[];
  composition: string | null;
  compositionSrc: string | null;
  text: string;
  media: string | null;
  relative: string;
  position: number;
  groupSelector: string;
  siblingMatchCount: number;
  generated?: boolean;
  children: number[];
}
export interface ElementDom {
  generation: string | null;
  nodes: ElementNode[];
  limitations: { canvas: number; iframes: number; shadowRoots: number };
}
export interface ElementMap {
  text: string;
  entries: { line: number; selectors: string[]; nodeIndices: number[] }[];
  elementCount: number;
  coveredCount: number;
}
export function collectElementDom(): ElementDom;
export function formatElementMap(snapshot: ElementDom, options?: { file?: string }): ElementMap;
export function createElementMap(page: Page, options?: { file?: string }): Promise<ElementMap>;
