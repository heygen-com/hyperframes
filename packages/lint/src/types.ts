export type HyperframeLintSeverity = "error" | "warning" | "info";

export type HyperframeLintFinding = {
  code: string;
  severity: HyperframeLintSeverity;
  message: string;
  file?: string;
  selector?: string;
  elementId?: string;
  fixHint?: string;
  snippet?: string;
};

export type HyperframeLintResult = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: HyperframeLintFinding[];
};

export type HyperframeLinterOptions = {
  filePath?: string;
  isSubComposition?: boolean;
  externalStyles?: Array<{ href: string; content: string }>;
  /**
   * Set to `true` when linting compositions destined for distributed / Lambda
   * rendering, where system-font capture (`allowSystemFontCapture`) is
   * disabled.  When `true`, the `system_font_will_alias` rule is elevated from
   * `"info"` to `"warning"` because the alias substitution will NOT happen at
   * render time — the font will silently fall back to whatever the OS provides.
   */
  distributed?: boolean;
};

// A rule is a function: receives parsed context, returns zero or more findings.
// Rules may be async (e.g. when lazy-loading heavy dependencies like recast).
export type LintRule<TContext> = (
  ctx: TContext,
) => HyperframeLintFinding[] | Promise<HyperframeLintFinding[]>;
