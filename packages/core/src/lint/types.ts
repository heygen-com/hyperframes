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
};
