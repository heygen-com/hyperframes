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

// A rule is a pure function: receives parsed context, returns zero or more findings.
// Rule modules should receive a LintContext (defined in ./context) as the type parameter.
export type LintRule<TContext> = (ctx: TContext) => HyperframeLintFinding[];
