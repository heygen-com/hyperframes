#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_s3-purge.sh
source "$SCRIPT_DIR/_s3-purge.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
printf '1001\n' > "$WORK/remaining"
: > "$WORK/delete-batches"

cat > "$WORK/bin/aws" <<'MOCK_AWS'
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-} ${2:-}"
shift 2
bucket=""
delete_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bucket) bucket="$2"; shift 2 ;;
    --delete) delete_file="${2#file://}"; shift 2 ;;
    *) shift ;;
  esac
done
[ "$bucket" = "mock-bucket" ]

case "$operation" in
  "s3api list-object-versions")
    remaining=$(cat "$MOCK_WORK/remaining")
    if [ "$remaining" -gt 1000 ]; then
      jq -n '{
        IsTruncated: true,
        Versions: [range(0;999) | {Key:("version-" + tostring),VersionId:("v-" + tostring)}],
        DeleteMarkers: [{Key:"deleted-null-object",VersionId:"null"}]
      }'
    elif [ "$remaining" -gt 0 ]; then
      jq -n --argjson remaining "$remaining" '{
        IsTruncated: false,
        Versions: [range(0;$remaining) | {Key:("tail-" + tostring),VersionId:"null"}],
        DeleteMarkers: []
      }'
    else
      jq -n '{IsTruncated:false,Versions:[],DeleteMarkers:[]}'
    fi
    ;;
  "s3api delete-objects")
    count=$(jq '.Objects | length' "$delete_file")
    jq -e '
      if (.Objects | length) == 1000
      then any(.Objects[]; .Key == "deleted-null-object" and .VersionId == "null")
      else true
      end
    ' "$delete_file" >/dev/null
    remaining=$(cat "$MOCK_WORK/remaining")
    printf '%s\n' "$((remaining - count))" > "$MOCK_WORK/remaining"
    printf '%s\n' "$count" >> "$MOCK_WORK/delete-batches"
    # Real AWS returns a blank body for a successful Quiet=true delete.
    :
    ;;
  "s3api delete-bucket")
    [ "$(cat "$MOCK_WORK/remaining")" -eq 0 ]
    touch "$MOCK_WORK/bucket-deleted"
    ;;
  *)
    echo "unexpected mock operation: $operation" >&2
    exit 2
    ;;
esac
MOCK_AWS
chmod 755 "$WORK/bin/aws"

MOCK_WORK="$WORK" PATH="$WORK/bin:$PATH" \
  hf_delete_s3_bucket_completely "mock-bucket" 2>"$WORK/stderr"

[ "$(cat "$WORK/remaining")" -eq 0 ]
[ "$(paste -sd, "$WORK/delete-batches")" = "1000,1" ]
[ -f "$WORK/bucket-deleted" ]
[ ! -s "$WORK/stderr" ]
echo "s3 purge shell test passed"
