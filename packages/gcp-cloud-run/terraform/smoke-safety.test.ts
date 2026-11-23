import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const smokePath = join(import.meta.dir, "../../../examples/gcp-cloud-run/scripts/smoke.sh");
const smoke = readFileSync(smokePath, "utf-8");
const dockerfile = readFileSync(join(import.meta.dir, "../Dockerfile"), "utf-8");

describe("GCP smoke ownership and protocol safety", () => {
  it("runs only the Plan v2 protocol", () => {
    expect(smoke).toContain('PROTOCOL="v2"');
    expect(smoke).not.toContain("--protocols)");
    expect(smoke).toContain("PlanProtocol: $protocol");
    expect(smoke).not.toContain("PlanProtocol: v1");
    expect(smoke).toContain('.CaptureMode == "beginframe"');
    expect(smoke).toContain("expected every chunk to use beginframe");
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
    expect(smoke).toContain("!packages/aws-lambda/scripts/probe-beginframe.ts");
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

describe("GCP render image", () => {
  it("holds render pages to their project server and public addresses", () => {
    expect(dockerfile).toMatch(/^ENV PRODUCER_RESTRICT_PAGE_NETWORK=true$/m);
  });

  it("lets a deployment turn the restriction off through Terraform, on by default", () => {
    const main = readFileSync(join(import.meta.dir, "main.tf"), "utf-8");
    const variables = readFileSync(join(import.meta.dir, "variables.tf"), "utf-8");
    expect(main).toContain('name  = "PRODUCER_RESTRICT_PAGE_NETWORK"');
    expect(main).toContain('value = var.restrict_page_network ? "true" : "false"');
    expect(variables).toMatch(
      /variable "restrict_page_network" \{\s*type\s*= bool[\s\S]*?default\s*= true\s*\}/,
    );
  });
});
