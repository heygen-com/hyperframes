function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

export const caseIds = Object.freeze([
  "valid-round-trip",
  "late-bad-sha",
  "font-expansion",
  "corrupt-png",
  "hung-decoder",
]);

export function assertEvidence(caseId, evidence) {
  expectEqual(evidence.caseId, caseId, "case id");

  if (caseId === "valid-round-trip") {
    expectEqual(evidence.result.ok, true, "round-trip result");
    expectEqual(evidence.result.version, "2.0", "contract version");
    expectEqual(evidence.result.artifactKind, "editable-dom", "artifact kind");
    expectEqual(evidence.result.canonicalUtf8Bytes, 853, "canonical byte count");
    expectEqual(evidence.materializerCalls, 2, "round-trip decoder calls");
    expectEqual(evidence.decoder, "createImageBitmap", "round-trip decoder");
    return;
  }

  if (caseId === "late-bad-sha") {
    expectEqual(evidence.result.code, "resource.hash-mismatch", "bad SHA result");
    expectEqual(evidence.result.resourceId, "image-2", "bad SHA resource");
    expectEqual(evidence.materializerCalls, 0, "bad SHA decoder calls");
    return;
  }

  if (caseId === "font-expansion") {
    expectEqual(evidence.result.code, "budget.decoded-font-bytes", "font budget result");
    expectEqual(evidence.result.actual, 0xffffffff, "font expanded bytes");
    expectEqual(evidence.result.limit, 16_000_000, "font budget limit");
    expectEqual(evidence.materializerCalls, 0, "font budget decoder calls");
    return;
  }

  if (caseId === "corrupt-png") {
    expectEqual(evidence.result.code, "resource.invalid-data", "corrupt PNG result");
    expectEqual(evidence.result.resourceId, "image-1", "corrupt PNG resource");
    expectEqual(evidence.materializerCalls, 1, "corrupt PNG decoder calls");
    expectEqual(evidence.decoder, "createImageBitmap", "corrupt PNG decoder");
    return;
  }

  if (caseId === "hung-decoder") {
    expectEqual(
      evidence.result.code,
      "resource.materialization-aborted",
      "hung decoder result",
    );
    expectEqual(evidence.result.resourceId, "image-1", "hung decoder resource");
    expectEqual(evidence.materializerCalls, 1, "hung decoder calls");
    expectEqual(evidence.abortObserved, true, "hung decoder abort signal");
    return;
  }

  throw new Error(`Unknown hard case: ${caseId}`);
}
