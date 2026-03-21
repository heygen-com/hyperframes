export type HyperframeLintSeverity = "error" | "warning";

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
  findings: HyperframeLintFinding[];
};

export type HyperframeLinterOptions = {
  filePath?: string;
};
