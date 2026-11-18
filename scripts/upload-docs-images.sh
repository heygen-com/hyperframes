#!/usr/bin/env bash
#
# Upload docs/images/ to the HeyGen public CDN.
#
# Docs previews (mp4/png/gif) are served from https://static.heygen.ai/hyperframes-oss/docs/images/
# rather than committed to the repo. After regenerating previews with
# `scripts/generate-catalog-previews.ts` or `scripts/generate-template-previews.ts`,
# run this script to publish the new files.
#
# Requires AWS credentials for the heygen engineering account (profile: engineering-767398024897)
# with both s3:PutObject and cloudfront:CreateInvalidation — the sync alone does
# not reach a reader, see the invalidation step below.
# Contributors without AWS access: open a PR with the HTML/MDX changes and a
# maintainer will run the generators + this upload before merging.
#
# Run it from a checkout you trust: only regular files inside docs/images/ are
# published, and the script refuses to start if anything there is a symbolic
# link, since a link would publish whatever it points to on this machine.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/docs/images/"
DEST="s3://heygen-public/hyperframes-oss/docs/images/"
PROFILE="${AWS_PROFILE:-engineering-767398024897}"

if [ ! -d "$SRC" ]; then
  echo "No docs/images/ directory to upload — nothing to do."
  exit 0
fi

# docs/images itself (or docs) must be the real folder in this checkout, not a link to elsewhere.
if [ "$(cd "$SRC" && pwd -P)" != "$(cd "$REPO_ROOT" && pwd -P)/docs/images" ]; then
  echo "docs/images/ is not a folder inside this checkout; refusing to upload." >&2
  exit 1
fi

# Only regular files and folders go up. find does not follow links, so a link
# (or anything else that is not a plain file) is listed rather than read.
UNSAFE="$(find "$SRC" ! -type f ! -type d)"
if [ -n "$UNSAFE" ]; then
  echo "Refusing to upload: these are not regular files (symbolic links are never published):" >&2
  printf '%s\n' "$UNSAFE" >&2
  exit 1
fi

echo "Uploading $SRC → $DEST (profile: $PROFILE)"
aws --profile "$PROFILE" s3 sync "$SRC" "$DEST" \
  --no-follow-symlinks \
  --cache-control "public, max-age=31536000, immutable" \
  --metadata-directive REPLACE

# Preview URLs are stable, and the objects go up `immutable` with a one-year
# max-age, so a re-upload alone changes nothing a reader sees: the edge keeps
# serving the old file until the TTL expires. Republishing a corrected preview
# is not done until the cache is dropped.
DISTRIBUTION="${DOCS_CDN_DISTRIBUTION_ID:-E2BSLVSZ7FG3U0}"
echo "Invalidating $DISTRIBUTION"
aws --profile "$PROFILE" cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION" \
  --paths "/hyperframes-oss/docs/images/*" \
  --query "Invalidation.Id" --output text

echo "Done. Files are live at https://static.heygen.ai/hyperframes-oss/docs/images/"
