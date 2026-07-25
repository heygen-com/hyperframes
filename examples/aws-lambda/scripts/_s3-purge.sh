#!/usr/bin/env bash
# S3 bucket cleanup helpers. Sourcing this file has no side effects.

# Delete every concrete object version and delete marker from a bucket.
#
# We intentionally re-list the first 1,000 entries after every delete batch
# instead of advancing markers through a mutating result set. This handles
# arbitrary pagination depth while avoiding skipped keys when the page being
# used as a cursor has just been removed. It is also required for buckets with
# versioning Suspended: `aws s3 rm` only creates null-version delete markers
# and leaves the historical/null versions behind.
hf_purge_s3_bucket_versions() {
  local bucket="$1" work page delete_request delete_response count errors rounds=0
  work=$(mktemp -d)
  page="$work/page.json"
  delete_request="$work/delete.json"
  delete_response="$work/delete-response.json"

  while true; do
    rounds=$((rounds + 1))
    if [ "$rounds" -gt 100000 ]; then
      echo "ERROR: S3 purge exceeded 100000 batches for s3://$bucket" >&2
      rm -rf "$work"
      return 1
    fi

    if ! aws s3api list-object-versions \
      --bucket "$bucket" \
      --max-keys 1000 \
      --no-paginate \
      --output json > "$page"; then
      echo "ERROR: failed to list object versions for s3://$bucket" >&2
      rm -rf "$work"
      return 1
    fi

    jq '{
      Objects: [
        (.Versions // [])[],
        (.DeleteMarkers // [])[]
      ] | map({Key, VersionId}),
      Quiet: true
    }' "$page" > "$delete_request"
    count=$(jq '.Objects | length' "$delete_request")
    if [ "$count" -eq 0 ]; then
      break
    fi

    if ! aws s3api delete-objects \
      --bucket "$bucket" \
      --delete "file://$delete_request" \
      --output json > "$delete_response"; then
      echo "ERROR: failed to delete a version batch from s3://$bucket" >&2
      rm -rf "$work"
      return 1
    fi
    # Successful Quiet=true deletes may produce a zero-byte response body.
    # Slurp mode treats that as an empty input set and therefore zero errors,
    # while still counting per-object Errors when AWS returns a JSON object.
    errors=$(jq -s '[.[] | (.Errors // [])[]] | length' "$delete_response")
    if [ "$errors" -ne 0 ]; then
      echo "ERROR: S3 returned per-object deletion errors for s3://$bucket:" >&2
      jq -c '.Errors[]' "$delete_response" >&2
      rm -rf "$work"
      return 1
    fi
    echo "  purged $count object versions/delete markers from s3://$bucket"
  done

  rm -rf "$work"
}

hf_delete_s3_bucket_completely() {
  local bucket="$1"
  hf_purge_s3_bucket_versions "$bucket" &&
    aws s3api delete-bucket --bucket "$bucket"
}
