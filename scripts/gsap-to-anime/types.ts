import type { ParsedGsap } from "@hyperframes/parsers";

export type CodemodStatus = "converted" | "converted-with-warnings" | "manual";

export interface ClassificationNote {
  code: string;
  message: string;
}

export interface CodemodClassification {
  status: CodemodStatus;
  reasons: ClassificationNote[];
  warnings: ClassificationNote[];
  parsed?: ParsedGsap;
}

export interface TransformResult {
  html: string;
  changed: boolean;
  classification: CodemodClassification;
}

export interface ScriptBlock {
  scriptText: string;
  start: number;
  end: number;
}

export interface RegistrationInfo {
  id: string;
  trailing: string;
}

export interface RegistryFileReport {
  path: string;
  status: CodemodStatus;
  changed: boolean;
  reasons: ClassificationNote[];
  warnings: ClassificationNote[];
}

export interface RegistryItemReport {
  kind: string;
  name: string;
  path: string;
  status: CodemodStatus;
  changed: boolean;
  reasons: ClassificationNote[];
  warnings: ClassificationNote[];
  files: RegistryFileReport[];
}

export interface RegistryReport {
  root: string;
  totals: Record<CodemodStatus, number>;
  items: RegistryItemReport[];
}
