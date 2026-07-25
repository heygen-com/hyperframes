import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const smokePath = join(import.meta.dir, "../../../examples/gcp-cloud-run/scripts/smoke.sh");
const smoke = readFileSync(smokePath, "utf-8");
const dockerfile = readFileSync(join(import.meta.dir, "../Dockerfile"), "utf-8");

describe("GCP smoke ownership and protocol safety", () => {
  it("defaults to v1 and requires an explicit v2 protocol argument", () => {
    expect(smoke).toContain('PROTOCOLS="${PROTOCOLS:-v1}"');
    expect(smoke).toContain("--protocols)");
    expect(smoke).toContain("PlanProtocol: $protocol");
    expect(smoke).toContain("decodedFramesEqual");
    expect(smoke).toContain("decodedAudioEqual");
    expect(smoke).toContain("normalizedMetadataEqual");
  });

  it("derives a length-safe owner prefix and isolates Terraform state", () => {
    expect(smoke).toContain('OWNER_HASH="$(printf');
    expect(smoke).toContain("RUN_NONCE=");
    expect(smoke).toContain('STACK_NAME="hf-smoke-$OWNER_HASH"');
    expect(smoke).toContain('TF_WORK_DIR="$ARTIFACT_DIR/terraform"');
    expect(smoke).toContain('TF_DATA_DIR="$ARTIFACT_DIR/terraform-data"');
    expect(smoke).toContain("export TF_DATA_DIR");
    expect(smoke).toContain('-var "project_name=$STACK_NAME"');
    expect(smoke).toContain('[ "$STACK_NAME" != "hyperframes" ]');
  });

  it("tracks owned registry resources and verifies stack deletion", () => {
    expect(smoke).toContain("CREATED_IMAGE=0");
    expect(smoke).toContain("CREATED_REPO=0");
    expect(smoke).toContain('if [ "$CREATED_REPO" -eq 1 ]');
    expect(smoke).toContain('if [ "$CREATED_IMAGE" -eq 1 ]');

    for (const resource of [
      "cloud-run-service",
      "workflow",
      "render-bucket",
      "artifact-image",
      "artifact-repository",
      "cloud-build-staging-bucket",
    ]) {
      expect(smoke).toContain(`verify_absent "${resource}"`);
    }
    expect(smoke).toContain('verify_service_account_absent "run-service-account"');
    expect(smoke).toContain('verify_service_account_absent "workflow-service-account"');
    expect(smoke).toContain('verify_absent "preflight-cloud-run-service"');
    expect(smoke).toContain('verify_absent "preflight-artifact-image"');
    expect(smoke).toContain("$STACK_NAME-render");
    expect(smoke).toContain("--ignore-file");
    expect(smoke).toContain("--gcs-source-staging-dir");
    expect(smoke).toContain("!scripts/package-subpaths.mjs");
    expect(dockerfile).toContain("COPY scripts/package-subpaths.mjs scripts/package-subpaths.mjs");
    expect(smoke).not.toContain("gcloud services enable");
    expect(smoke).toContain("gcloud services list");
    expect(smoke).toContain("--enabled");
    expect(smoke).not.toContain("gcloud services describe");
    expect(smoke).toContain("cannot find");
    expect(smoke).toContain("gcloud iam service-accounts list");
    expect(smoke).toContain('--filter "email:$email"');
  });

  it("does not swallow Terraform cleanup failures", () => {
    const cleanupStart = smoke.indexOf("cleanup() {");
    const cleanupEnd = smoke.indexOf("\ntrap cleanup EXIT", cleanupStart);
    const cleanup = smoke.slice(cleanupStart, cleanupEnd);
    expect(cleanup).not.toContain("|| true");
    expect(cleanup).toContain("exit 7");
  });
});
