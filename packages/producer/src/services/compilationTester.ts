/**
 * Compilation Testing Service
 *
 * Validates that HTML compilation produces correct timing attributes.
 * Compares compiled HTML against golden files using semantic attribute matching.
 */

import { parseHTML } from "linkedom";

export interface CompiledElement {
  id: string;
  tagName: "video" | "audio" | "div";
  src?: string;
  dataStart: number;
  dataEnd: number | null;
  dataDuration: number | null;
  dataHasAudio?: boolean;
  dataMediaStart?: number;
  compositionSrc?: string;
}

export interface CompilationValidationResult {
  passed: boolean;
  actualElements: CompiledElement[];
  goldenElements: CompiledElement[];
  errors: string[];
  warnings: string[];
}

type CompositionStructure = {
  id: string;
  selfCompositionId: string | null;
  descendantCompositionIds: string[];
};

const EPSILON = 0.001; // Tolerance for floating-point timing comparisons

/**
 * Parse HTML and extract all elements with timing attributes.
 * Includes <video>, <audio>, and <div data-composition-src>.
 */
export function extractTimedElements(html: string): CompiledElement[] {
  const elements: CompiledElement[] = [];

  // Extract video elements
  const videoRegex = /<video[^>]*>/gi;
  let match;

  while ((match = videoRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const idMatch = fullTag.match(/id=["']([^"']+)["']/);
    if (!idMatch) continue;

    const srcMatch = fullTag.match(/src=["']([^"']+)["']/);
    const startMatch = fullTag.match(/data-start=["']([^"']+)["']/);
    const endMatch = fullTag.match(/data-end=["']([^"']+)["']/);
    const durationMatch = fullTag.match(/data-duration=["']([^"']+)["']/);
    const mediaStartMatch = fullTag.match(/data-media-start=["']([^"']+)["']/);
    const hasAudioMatch = fullTag.match(/data-has-audio=["']([^"']+)["']/);

    elements.push({
      id: idMatch[1] ?? "",
      tagName: "video",
      src: srcMatch?.[1],
      dataStart: startMatch ? parseFloat(startMatch[1] ?? "") : 0,
      dataEnd: endMatch ? parseFloat(endMatch[1] ?? "") : null,
      dataDuration: durationMatch ? parseFloat(durationMatch[1] ?? "") : null,
      dataMediaStart: mediaStartMatch ? parseFloat(mediaStartMatch[1] ?? "") : undefined,
      dataHasAudio: hasAudioMatch ? hasAudioMatch[1] === "true" : undefined,
    });
  }

  // Extract audio elements
  const audioRegex = /<audio[^>]*>/gi;
  while ((match = audioRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const idMatch = fullTag.match(/id=["']([^"']+)["']/);
    if (!idMatch) continue;

    const srcMatch = fullTag.match(/src=["']([^"']+)["']/);
    const startMatch = fullTag.match(/data-start=["']([^"']+)["']/);
    const endMatch = fullTag.match(/data-end=["']([^"']+)["']/);
    const durationMatch = fullTag.match(/data-duration=["']([^"']+)["']/);
    const mediaStartMatch = fullTag.match(/data-media-start=["']([^"']+)["']/);

    elements.push({
      id: idMatch[1] ?? "",
      tagName: "audio",
      src: srcMatch?.[1],
      dataStart: startMatch ? parseFloat(startMatch[1] ?? "") : 0,
      dataEnd: endMatch ? parseFloat(endMatch[1] ?? "") : null,
      dataDuration: durationMatch ? parseFloat(durationMatch[1] ?? "") : null,
      dataMediaStart: mediaStartMatch ? parseFloat(mediaStartMatch[1] ?? "") : undefined,
    });
  }

  // Extract composition elements (div with data-composition-src)
  const compRegex = /<div[^>]*data-composition-src[^>]*>/gi;
  while ((match = compRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const idMatch = fullTag.match(/id=["']([^"']+)["']/);
    if (!idMatch) continue;

    const compositionSrcMatch = fullTag.match(/data-composition-src=["']([^"']+)["']/);
    const startMatch = fullTag.match(/data-start=["']([^"']+)["']/);
    const endMatch = fullTag.match(/data-end=["']([^"']+)["']/);
    const durationMatch = fullTag.match(/data-duration=["']([^"']+)["']/);

    elements.push({
      id: idMatch[1] ?? "",
      tagName: "div",
      compositionSrc: compositionSrcMatch?.[1],
      dataStart: startMatch ? parseFloat(startMatch[1] ?? "") : 0,
      dataEnd: endMatch ? parseFloat(endMatch[1] ?? "") : null,
      dataDuration: durationMatch ? parseFloat(durationMatch[1] ?? "") : null,
    });
  }

  return elements;
}

function extractCompositionStructures(html: string): CompositionStructure[] {
  const { document } = parseHTML(html);
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[id]"));

  return elements.map((element) => {
    const descendantCompositionIds = Array.from(
      element.querySelectorAll<HTMLElement>("[data-composition-id]"),
    )
      .filter((candidate) => candidate !== element)
      .map((candidate) => candidate.getAttribute("data-composition-id") || "")
      .filter(Boolean)
      .sort();

    return {
      id: element.id,
      selfCompositionId: element.getAttribute("data-composition-id"),
      descendantCompositionIds,
    };
  });
}

/**
 * Validate a single element's timing attributes.
 * Returns array of error messages (empty if valid).
 */
function validateElementTiming(element: CompiledElement, label: string): string[] {
  const errors: string[] = [];

  // For video and audio, require data-end and data-duration
  if (element.tagName === "video" || element.tagName === "audio") {
    if (element.dataEnd === null) {
      errors.push(`${label} [${element.id}]: missing data-end attribute`);
    }
    if (element.dataDuration === null) {
      errors.push(`${label} [${element.id}]: missing data-duration attribute`);
    }

    // Check timing math: data-end should equal data-start + data-duration
    if (element.dataEnd !== null && element.dataDuration !== null) {
      const computed = element.dataStart + element.dataDuration;
      if (Math.abs(element.dataEnd - computed) > EPSILON) {
        errors.push(
          `${label} [${element.id}]: data-end (${element.dataEnd}) != data-start (${element.dataStart}) + data-duration (${element.dataDuration}) = ${computed}`
        );
      }
    }
  }

  // Video-specific: require data-has-audio
  if (element.tagName === "video" && element.dataHasAudio === undefined) {
    errors.push(`${label} [${element.id}]: missing data-has-audio attribute`);
  }

  return errors;
}

/**
 * Compare two elements and return differences.
 * Compares timing attributes with epsilon tolerance.
 */
function compareElements(
  actual: CompiledElement,
  golden: CompiledElement
): string[] {
  const errors: string[] = [];

  // Compare tag names
  if (actual.tagName !== golden.tagName) {
    errors.push(
      `[${actual.id}]: tagName mismatch (actual: ${actual.tagName}, golden: ${golden.tagName})`
    );
    return errors; // Don't continue if tag mismatch
  }

  // Compare data-start (should be exact)
  if (Math.abs(actual.dataStart - golden.dataStart) > EPSILON) {
    errors.push(
      `[${actual.id}]: data-start mismatch (actual: ${actual.dataStart}, golden: ${golden.dataStart})`
    );
  }

  // Compare data-end with epsilon tolerance
  if (golden.dataEnd !== null) {
    if (actual.dataEnd === null) {
      errors.push(`[${actual.id}]: missing data-end (golden has: ${golden.dataEnd})`);
    } else if (Math.abs(actual.dataEnd - golden.dataEnd) > EPSILON) {
      errors.push(
        `[${actual.id}]: data-end mismatch (actual: ${actual.dataEnd}, golden: ${golden.dataEnd})`
      );
    }
  }

  // Compare data-duration with epsilon tolerance
  if (golden.dataDuration !== null) {
    if (actual.dataDuration === null) {
      errors.push(
        `[${actual.id}]: missing data-duration (golden has: ${golden.dataDuration})`
      );
    } else if (Math.abs(actual.dataDuration - golden.dataDuration) > EPSILON) {
      errors.push(
        `[${actual.id}]: data-duration mismatch (actual: ${actual.dataDuration}, golden: ${golden.dataDuration})`
      );
    }
  }

  // Compare data-has-audio (video only)
  if (actual.tagName === "video") {
    if (actual.dataHasAudio !== golden.dataHasAudio) {
      errors.push(
        `[${actual.id}]: data-has-audio mismatch (actual: ${actual.dataHasAudio}, golden: ${golden.dataHasAudio})`
      );
    }
  }

  // Compare composition-src (composition only)
  if (actual.tagName === "div" && actual.compositionSrc !== golden.compositionSrc) {
    errors.push(
      `[${actual.id}]: data-composition-src mismatch (actual: ${actual.compositionSrc}, golden: ${golden.compositionSrc})`
    );
  }

  return errors;
}

/**
 * Validate compiled HTML against golden HTML.
 * Returns detailed validation result with errors and warnings.
 */
export function validateCompilation(
  actualHtml: string,
  goldenHtml: string
): CompilationValidationResult {
  const actualElements = extractTimedElements(actualHtml);
  const goldenElements = extractTimedElements(goldenHtml);
  const actualStructures = extractCompositionStructures(actualHtml);
  const goldenStructures = extractCompositionStructures(goldenHtml);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate actual element timings
  for (const element of actualElements) {
    const timingErrors = validateElementTiming(element, "actual");
    errors.push(...timingErrors);
  }

  // Validate golden element timings (sanity check)
  for (const element of goldenElements) {
    const timingErrors = validateElementTiming(element, "golden");
    if (timingErrors.length > 0) {
      warnings.push(
        `Golden file has invalid timing: ${timingErrors.join(", ")}`
      );
    }
  }

  // Create maps for comparison
  const actualMap = new Map<string, CompiledElement>();
  const goldenMap = new Map<string, CompiledElement>();
  const actualStructureMap = new Map<string, CompositionStructure>();
  const goldenStructureMap = new Map<string, CompositionStructure>();

  for (const el of actualElements) {
    actualMap.set(el.id, el);
  }

  for (const el of goldenElements) {
    goldenMap.set(el.id, el);
  }

  for (const structure of actualStructures) {
    actualStructureMap.set(structure.id, structure);
  }

  for (const structure of goldenStructures) {
    goldenStructureMap.set(structure.id, structure);
  }

  // Check for missing elements (in golden but not in actual)
  for (const [id] of goldenMap) {
    if (!actualMap.has(id)) {
      errors.push(
        `Missing element [${id}] (present in golden, not in actual)`
      );
    }
  }

  // Check for extra elements (in actual but not in golden)
  for (const [id, actualEl] of actualMap) {
    if (!goldenMap.has(id)) {
      warnings.push(
        `Extra element [${id}] <${actualEl.tagName}> (present in actual, not in golden)`
      );
    }
  }

  // Compare matching elements
  for (const [id, actualEl] of actualMap) {
    const goldenEl = goldenMap.get(id);
    if (!goldenEl) continue;

    const compareErrors = compareElements(actualEl, goldenEl);
    errors.push(...compareErrors);
  }

  for (const [id, goldenStructure] of goldenStructureMap) {
    const actualStructure = actualStructureMap.get(id);
    if (!actualStructure) continue;

    if (actualStructure.selfCompositionId !== goldenStructure.selfCompositionId) {
      errors.push(
        `[${id}]: data-composition-id mismatch (actual: ${actualStructure.selfCompositionId ?? "null"}, golden: ${goldenStructure.selfCompositionId ?? "null"})`,
      );
    }

    const actualDescendants = actualStructure.descendantCompositionIds.join(",");
    const goldenDescendants = goldenStructure.descendantCompositionIds.join(",");
    if (actualDescendants !== goldenDescendants) {
      errors.push(
        `[${id}]: descendant composition ids mismatch (actual: ${actualDescendants || "none"}, golden: ${goldenDescendants || "none"})`,
      );
    }
  }

  const passed = errors.length === 0;

  return {
    passed,
    actualElements,
    goldenElements,
    errors,
    warnings,
  };
}
