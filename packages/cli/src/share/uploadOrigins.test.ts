import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliReviewUploadOrigins } from "./uploadOrigins.js";
import { assertReviewUploadStorage, bindCliShareProject } from "./host.js";
import { trustedUploadUrl } from "@hyperframes/share/reviewUpload.mjs";

let dir: string;
beforeEach(() => {
  for (const key of [
    "HYPERFRAMES_REVIEW_UPLOAD_ORIGINS",
    "HYPERFRAMES_ENV",
    "HEYGEN_API_URL",
    "HYPERFRAMES_OAUTH_TOKEN_URL",
    "HYPERFRAMES_OAUTH_CLIENT_ID",
  ])
    vi.stubEnv(key, undefined);
  dir = mkdtempSync(join(tmpdir(), "share-upload-origins-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it("trusts only the production video and source storage origins by default", () => {
  expect(cliReviewUploadOrigins()).toEqual([
    "https://heygen-hyperframes-reviews-prod-767398024897-us-east-2.s3.amazonaws.com",
    "https://heygen-hyperframes-reviews-prod-767398024897-us-east-2.s3.us-east-2.amazonaws.com",
    "https://hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com",
  ]);
  bindCliShareProject(dir);
  expect(() => assertReviewUploadStorage()).not.toThrow();
  for (const origin of cliReviewUploadOrigins())
    expect(trustedUploadUrl(`${origin}/object?signature=fixture`)).not.toBeNull();
});
it.each([
  ["HYPERFRAMES_ENV", "dev"],
  ["HEYGEN_API_URL", "https://custom.example"],
  ["HYPERFRAMES_OAUTH_TOKEN_URL", "https://custom.example/token"],
  ["HYPERFRAMES_OAUTH_CLIENT_ID", "custom-client"],
])("does not inherit production trust when %s changes", (key, value) => {
  bindCliShareProject(dir);
  const production = cliReviewUploadOrigins()[0];
  vi.stubEnv(key, value);
  bindCliShareProject(dir);
  expect(cliReviewUploadOrigins()).toEqual([]);
  expect(() => assertReviewUploadStorage()).toThrow();
  expect(trustedUploadUrl(`${production}/object`)).toBeNull();
});
it("replaces defaults with an explicit exact-origin override for custom deployments", () => {
  vi.stubEnv("HYPERFRAMES_ENV", "dev");
  vi.stubEnv(
    "HYPERFRAMES_REVIEW_UPLOAD_ORIGINS",
    " https://storage.example , https://sources.example ",
  );
  bindCliShareProject(dir);
  expect(cliReviewUploadOrigins()).toEqual(["https://storage.example", "https://sources.example"]);
  expect(() => assertReviewUploadStorage()).not.toThrow();
  expect(trustedUploadUrl("https://storage.example/object")).not.toBeNull();
  expect(
    trustedUploadUrl("https://hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com/object"),
  ).toBeNull();
});
it.each(["", " , "])("keeps explicit empty overrides fail-closed (%j)", (override) => {
  vi.stubEnv("HYPERFRAMES_REVIEW_UPLOAD_ORIGINS", override);
  bindCliShareProject(dir);
  expect(cliReviewUploadOrigins()).toEqual([]);
  expect(() => assertReviewUploadStorage()).toThrow();
});
it("rejects sibling buckets, userinfo, non-HTTPS and accelerated hosts", () => {
  bindCliShareProject(dir);
  for (const url of [
    "https://other-bucket.s3.us-east-2.amazonaws.com/object",
    "https://hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com.evil.example/object",
    "https://user:password@hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com/object",
    "http://hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com/object",
    "https://heygen-hyperframes-reviews-prod-767398024897-us-east-2.s3-accelerate.amazonaws.com/object",
  ])
    expect(trustedUploadUrl(url)).toBeNull();
});

it.each(["https://storage.example/path", "https://*.example", "http://storage.example"])(
  "does not accept invalid override %s",
  (override) => {
    vi.stubEnv("HYPERFRAMES_REVIEW_UPLOAD_ORIGINS", override);
    bindCliShareProject(dir);
    expect(() => assertReviewUploadStorage()).toThrow();
  },
);
