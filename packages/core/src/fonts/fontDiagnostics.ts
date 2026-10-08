export type FontDiagPath = "bundled_supplement" | "direct_google";

export interface FontAssetDiag {
  total: number;
  diskCacheHit: number;
  fetchedOk: number;
  nonOk: Record<string, number>;
}

export interface FontAttemptDiag {
  path: FontDiagPath;
  urlSource: "authored" | "default";
  textParam: "present" | "absent";
  cssCache: "hit" | "fresh";
  /** The real HTTP status of the CSS lookup; null when no HTTP response was recorded for that attempt. */
  cssStatus: number | null;
  /** blocksTotal > 0 with regexMatches 0 is a coarse stage: no block had a woff2 url in the expected shape. */
  blocksTotal: number;
  regexMatches: number;
  assets: FontAssetDiag;
}

export interface FontFamilyDiag {
  required: boolean;
  resolved: boolean;
  attempts: FontAttemptDiag[];
}

/** Resolver stage record, in resolver family order. Enums, counts and HTTP statuses only: no names, URLs or text. */
export interface FontDiagnostics {
  families: FontFamilyDiag[];
}

export class FontDiagCollector {
  private readonly families: FontFamilyDiag[] = [];
  private current: FontFamilyDiag | undefined;

  beginFamily(required: boolean): void {
    this.current = { required, resolved: false, attempts: [] };
    this.families.push(this.current);
  }

  endFamily(resolved: boolean): void {
    if (this.current) this.current.resolved = resolved;
    this.current = undefined;
  }

  startAttempt(
    path: FontDiagPath,
    urlSource: FontAttemptDiag["urlSource"],
    textParam: FontAttemptDiag["textParam"],
  ): FontAttemptDiag {
    const attempt: FontAttemptDiag = {
      path,
      urlSource,
      textParam,
      cssCache: "fresh",
      cssStatus: null,
      blocksTotal: 0,
      regexMatches: 0,
      assets: { total: 0, diskCacheHit: 0, fetchedOk: 0, nonOk: {} },
    };
    this.current?.attempts.push(attempt);
    return attempt;
  }

  snapshot(): FontDiagnostics {
    return { families: this.families };
  }
}
