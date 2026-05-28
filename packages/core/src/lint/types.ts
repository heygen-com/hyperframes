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
};

// A rule is a function: receives parsed context, returns zero or more findings.
// Rules may be async (e.g. when lazy-loading heavy dependencies like recast).
export type LintRule<TContext> = (
  ctx: TContext,
) => HyperframeLintFinding[] | Promise<HyperframeLintFinding[]>;
