#!/usr/bin/env bash
# `sam deploy` validates the template before it calls AWS. With fake credentials it must get past that
# validation and fail at the first upload, with and without a video image (an image function at the
# top level of template.yaml, for one, fails validation for every deploy).
set -uo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/examples/aws-lambda" "$work/packages/aws-lambda/dist"
cp template.yaml video-function.yaml "$work/examples/aws-lambda/"
echo zip > "$work/packages/aws-lambda/dist/handler.zip"
cd "$work/examples/aws-lambda"
sam validate --lint --region us-east-1 -t template.yaml || exit 1
sam validate --lint --region us-east-1 -t video-function.yaml || exit 1
digest=sha256:$(printf '%064d' 0)
for uri in '""' "123456789012.dkr.ecr.us-east-1.amazonaws.com/hf-video@$digest"; do
  # The CLI's argv (sam.ts), with --s3-bucket in place of --resolve-s3 so nothing calls AWS before the upload.
  out=$(env -u AWS_PROFILE AWS_ACCESS_KEY_ID=AKIAFAKEFAKEFAKEFAKE AWS_SECRET_ACCESS_KEY=fake \
    sam deploy --stack-name hf-sam-check --region us-east-1 --s3-bucket hf-sam-check-none \
    --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset \
    --parameter-overrides ChromeSource=sparticuz "VideoImageUri=$uri" </dev/null 2>&1)
  if ! grep -q "Unable to upload artifact" <<<"$out"; then
    echo "sam deploy stopped before reaching AWS (VideoImageUri=$uri):"
    echo "$out" | tail -5
    exit 1
  fi
  echo "VideoImageUri=$uri: past validation, stopped at the upload"
done
