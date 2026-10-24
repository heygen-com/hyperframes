// Shared by every render: project files and plan-v2 artifacts by SHA-256. Dependency-free for CDK.

export const CONTENT_STORE_PREFIX = "cas/sha256";
export const CONTENT_STORE_RETENTION_DAYS = 30;
/** Reusing an object at least this old rewrites it, so a plan's objects outlive it by 23+ days. */
export const CONTENT_STORE_REFRESH_AFTER_DAYS = 7;

export function contentStoreUri(bucket: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(
      `[contentStore] expected lowercase SHA-256 digest, got ${JSON.stringify(sha256)}`,
    );
  }
  return `s3://${bucket}/${CONTENT_STORE_PREFIX}/${sha256.slice(0, 2)}/${sha256}`;
}

export function audioSidecarUri(bucket: string, sha256: string): string {
  return `${contentStoreUri(bucket, sha256)}.audio.m4a`;
}
