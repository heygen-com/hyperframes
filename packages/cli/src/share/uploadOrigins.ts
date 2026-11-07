import { apiBaseUrl } from "../auth/client.js";
import {
  defaultClientId,
  oauthEnvironment,
  resolveClientId,
  tokenEndpoint,
} from "../auth/config.js";

const PRODUCTION_UPLOAD_ORIGINS = [
  "https://heygen-hyperframes-reviews-prod-767398024897-us-east-2.s3.amazonaws.com",
  "https://heygen-hyperframes-reviews-prod-767398024897-us-east-2.s3.us-east-2.amazonaws.com",
  "https://hyperframes-composition-sync-prod.s3.us-east-2.amazonaws.com",
] as const;

export function cliReviewUploadOrigins(): readonly string[] {
  const override = process.env.HYPERFRAMES_REVIEW_UPLOAD_ORIGINS;
  if (override !== undefined)
    return override
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  const standardProduction =
    oauthEnvironment() === "prod" &&
    apiBaseUrl() === "https://api.heygen.com" &&
    tokenEndpoint() === "https://api2.heygen.com/v1/oauth/token" &&
    resolveClientId() === defaultClientId();
  return standardProduction ? PRODUCTION_UPLOAD_ORIGINS : [];
}
