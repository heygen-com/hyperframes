#!/usr/bin/env bash
#
# Upload docs/images/ to the HeyGen public CDN.
#
# Docs previews (mp4/png/gif) are served from https://static.heygen.ai/hyperframes-oss/docs/images/
# rather than committed to the repo. After regenerating previews with
# `scripts/generate-catalog-previews.ts` or `scripts/generate-template-previews.ts`,
# run this script to publish the new files.
#
# Requires AWS credentials for the heygen engineering account (profile: engineering-767398024897).
# Contributors without AWS access: open a PR with the HTML/MDX changes and a
# maintainer will run the generators + this upload before merging.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/docs/images/"
DEST="s3://heygen-public/hyperframes-oss/docs/images/"
PROFILE="${AWS_PROFILE:-engineering-767398024897}"

if [ ! -d "$SRC" ]; then
  echo "No docs/images/ directory to upload — nothing to do."
  exit 0
fi

echo "Uploading $SRC → $DEST (profile: $PROFILE)"
aws --profile "$PROFILE" s3 sync "$SRC" "$DEST" \
  --cache-control "public, max-age=31536000, immutable" \
  --metadata-directive REPLACE

echo "Done. Files are live at https://static.heygen.ai/hyperframes-oss/docs/images/"
