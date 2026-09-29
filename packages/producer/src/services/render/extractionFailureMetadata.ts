import type {
  VideoExtractionFailureKind,
  VideoExtractionFailureRetry,
  VideoExtractionFailureStatusClass,
} from "@hyperframes/engine";

export interface ExtractionFailureKindCount {
  kind: VideoExtractionFailureKind;
  affectedElementCount: number;
}

export interface ExtractionFailureGroup {
  kind: VideoExtractionFailureKind;
  affectedElementCount: number;
  sourceFingerprint?: string;
  host?: string;
  statusClass?: VideoExtractionFailureStatusClass;
  retry?: VideoExtractionFailureRetry;
}

export interface ExtractionFailureMetadataV1 {
  schemaVersion: 1;
  kindCounts: ExtractionFailureKindCount[];
  groups: ExtractionFailureGroup[];
  omittedGroupCount: number;
}

type ExtractionFailureGroupSortTuple = readonly [
  string,
  string,
  string,
  string,
  string,
  number,
  number,
];

function stringOrEmpty(value: string | undefined): string {
  return value === undefined ? "" : value;
}

function retrySortTuple(
  retry: VideoExtractionFailureRetry | undefined,
): readonly [string, number, number] {
  return retry === undefined ? ["", -1, -1] : [retry.phase, retry.used, retry.budget];
}

function extractionFailureGroupSortTuple(
  group: ExtractionFailureGroup,
): ExtractionFailureGroupSortTuple {
  const retry = retrySortTuple(group.retry);
  return [
    group.kind,
    stringOrEmpty(group.sourceFingerprint),
    stringOrEmpty(group.host),
    stringOrEmpty(group.statusClass),
    retry[0],
    retry[1],
    retry[2],
  ];
}

export function compareExtractionFailureGroups(
  left: ExtractionFailureGroup,
  right: ExtractionFailureGroup,
): number {
  const leftTuple = extractionFailureGroupSortTuple(left);
  const rightTuple = extractionFailureGroupSortTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    const leftValue = leftTuple[index]!;
    const rightValue = rightTuple[index]!;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

export function extractionFailureGroupIdentityKey(group: ExtractionFailureGroup): string {
  return JSON.stringify(extractionFailureGroupSortTuple(group));
}
