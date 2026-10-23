import { parseHTML } from "linkedom";
import {
  readCompositionSizeFromDocument,
  type CompositionViewport,
} from "../compositionViewport.js";

export type FontMediaContext = {
  viewport: CompositionViewport;
  deviceScaleFactor: number;
};

export function resolveFontMediaContext(
  html: string,
  context: Partial<FontMediaContext> = {},
): FontMediaContext {
  const viewport = context.viewport ??
    readCompositionSizeFromDocument(parseHTML(html).document as unknown as Document) ?? {
      width: 1080,
      height: 1920,
    };
  return { viewport, deviceScaleFactor: context.deviceScaleFactor ?? 1 };
}
