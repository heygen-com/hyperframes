export interface PageLoadEvidence {
  httpStatus: number | null;
  title: string;
  textLength: number;
  bodyChildCount: number;
  hasChallengeElement: boolean;
}

/**
 * Returns an actionable failure only for strong protection-page signals.
 * Low text by itself is intentionally not fatal because image-led sites and
 * client-rendered applications can legitimately have very little body copy.
 */
export function detectBlockedPage(evidence: PageLoadEvidence): string | undefined {
  const isMinimalDom = evidence.bodyChildCount <= 5 && evidence.textLength < 500;
  const hasBlockedStatus =
    evidence.httpStatus === 401 || evidence.httpStatus === 403 || evidence.httpStatus === 429;
  const hasBlockedTitle =
    /^(?:(?:error\s*)?(?:401|403|429)(?:\s*(?:[-:—]\s*)?(?:forbidden|unauthorized|access denied|too many requests))?|forbidden|access denied|attention required!?|just a moment(?:\.{3})?)(?:\s*[|—-]\s*(?:cloudflare|sucuri website firewall))?$/i.test(
      evidence.title.trim(),
    );

  if (!isMinimalDom || (!evidence.hasChallengeElement && !hasBlockedStatus && !hasBlockedTitle)) {
    return undefined;
  }

  const statusDetail =
    evidence.httpStatus === null ? "no HTTP status" : `HTTP ${evidence.httpStatus}`;
  return (
    `Website capture blocked: the loaded page matched an access-protection response ` +
    `(${statusDetail}, title ${JSON.stringify(evidence.title)}, ${evidence.textLength} text chars). ` +
    "The site may reject automated or data-center traffic; retry from an allowed network or provide source assets directly."
  );
}
