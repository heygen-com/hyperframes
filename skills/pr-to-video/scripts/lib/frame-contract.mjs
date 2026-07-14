function fail(message) {
  throw new Error(`frame contract: ${message}`);
}

function attrValue(attrs, name) {
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i"),
  );
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

export function validateFrameHtml(html, { expectedId, expectedDuration } = {}) {
  const source = String(html ?? "");
  const trimmed = source.trim();
  if (/<!doctype|<\/?(?:html|head|body)\b/i.test(trimmed)) {
    fail("worker output must be one bare <template> fragment, not a full HTML document");
  }
  const opens = trimmed.match(/<template\b/gi) ?? [];
  const closes = trimmed.match(/<\/template\s*>/gi) ?? [];
  if (opens.length !== 1 || closes.length !== 1 || !/^<template\b/i.test(trimmed)) {
    fail("worker output must contain exactly one bare <template> fragment");
  }
  if (!/<\/template\s*>$/i.test(trimmed)) {
    fail("markup outside the closing </template> is not allowed");
  }

  const templateOpen = trimmed.match(/^<template\b[^>]*>/i)?.[0];
  if (!templateOpen) fail("template opening tag is malformed");
  const inner = trimmed.slice(
    templateOpen.length,
    trimmed.toLowerCase().lastIndexOf("</template>"),
  );
  const root = inner.match(/^\s*<([A-Za-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/);
  if (!root) fail("template must begin with one composition root element");
  const attrs = root[2];
  const compositionId = attrValue(attrs, "data-composition-id");
  if (!compositionId) fail("composition id is missing on the template root");
  if (expectedId && compositionId !== expectedId) {
    fail(`composition id ${JSON.stringify(compositionId)} does not match expected ${expectedId}`);
  }

  const durationRaw = attrValue(attrs, "data-duration");
  const decimalDuration = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(durationRaw ?? "");
  const duration = Number(durationRaw);
  if (!decimalDuration || !Number.isFinite(duration) || duration <= 0) {
    fail("root must declare a positive data-duration");
  }
  // Transition injection may extend an outgoing frame beyond its storyboard duration.
  // A shorter root is always invalid; a longer root remains safe to reassemble.
  if (Number.isFinite(expectedDuration) && duration < Number(expectedDuration) - 0.001) {
    fail(`root duration ${duration}s is shorter than expected ${expectedDuration}s`);
  }
  return { compositionId, duration };
}
