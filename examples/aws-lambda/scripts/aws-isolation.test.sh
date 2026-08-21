#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_aws-isolation.sh
source "$SCRIPT_DIR/_aws-isolation.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

cat > "$WORK/bin/aws" <<'MOCK_AWS'
#!/usr/bin/env bash
set -euo pipefail
operation="${1:-} ${2:-}"

case "$MOCK_MODE:$operation" in
  absent:"cloudformation describe-stacks")
    echo "ValidationError: Stack with id smoke does not exist" >&2
    exit 255
    ;;
  absent:"lambda get-function")
    echo "ResourceNotFoundException: Function not found" >&2
    exit 254
    ;;
  absent:"stepfunctions list-state-machines"|absent:"logs describe-log-groups")
    exit 0
    ;;
  collision:"cloudformation describe-stacks")
    echo "ValidationError: Stack with id smoke does not exist" >&2
    exit 255
    ;;
  collision:"lambda get-function")
    printf '{"Configuration":{"FunctionName":"collision"}}\n'
    ;;
  auth:"cloudformation describe-stacks")
    echo "AccessDenied: credentials expired" >&2
    exit 253
    ;;
  owned:"cloudformation describe-stacks")
    printf 'run-a\n'
    ;;
  foreign:"cloudformation describe-stacks")
    printf 'run-b\n'
    ;;
  ownership-missing:"cloudformation describe-stacks")
    echo "ValidationError: Stack with id smoke does not exist" >&2
    exit 255
    ;;
  reserve:"cloudformation create-stack"|reserve:"cloudformation wait")
    exit 0
    ;;
  discovery:"cloudformation list-stack-resources")
    cat <<'JSON'
{"StackResourceSummaries":[
  {"LogicalResourceId":"RenderBucket","PhysicalResourceId":"physical-render-bucket"},
  {"LogicalResourceId":"RenderStateMachine","PhysicalResourceId":"arn:aws:states:us-east-2:1:stateMachine:physical"}
]}
JSON
    ;;
  missing:"cloudformation list-stack-resources")
    echo "ValidationError: Stack with id smoke does not exist" >&2
    exit 255
    ;;
  *)
    echo "unexpected mock request: $MOCK_MODE $operation" >&2
    exit 2
    ;;
esac
MOCK_AWS
chmod 755 "$WORK/bin/aws"

name_a=$(hf_derive_project_name "hyperframes-lambda-smoke-a-very-long-shared-prefix-111")
name_b=$(hf_derive_project_name "hyperframes-lambda-smoke-a-very-long-shared-prefix-222")
[ "$name_a" != "$name_b" ]
[ "${#name_a}" -le 49 ]
[ "${#name_b}" -le 49 ]
run_a=$(hf_new_smoke_run_id)
run_b=$(hf_new_smoke_run_id)
[ "$run_a" != "$run_b" ]
bucket_a=$(hf_sam_deploy_bucket_name "767398024897" "us-east-2" "$run_a")
bucket_b=$(hf_sam_deploy_bucket_name "767398024897" "us-east-2" "$run_b")
[ "$bucket_a" != "$bucket_b" ]
[ "${#bucket_a}" -le 63 ]
[ "${#bucket_b}" -le 63 ]

MOCK_MODE=absent PATH="$WORK/bin:$PATH" \
  hf_assert_deploy_isolation "smoke" "$name_a"
if MOCK_MODE=collision PATH="$WORK/bin:$PATH" \
  hf_assert_deploy_isolation "smoke" "$name_a" 2>"$WORK/collision-error"; then
  echo "expected exact-name collision to fail closed" >&2
  exit 1
fi
grep -q "collision" "$WORK/collision-error"

if MOCK_MODE=auth PATH="$WORK/bin:$PATH" \
  hf_assert_deploy_isolation "smoke" "$name_a" 2>"$WORK/auth-error"; then
  echo "expected verification API error to fail closed" >&2
  exit 1
fi
grep -q "could not prove" "$WORK/auth-error"

[ "$(MOCK_MODE=owned PATH="$WORK/bin:$PATH" \
  hf_stack_ownership_status "smoke" "run-a")" = "owned" ]
[ "$(MOCK_MODE=ownership-missing PATH="$WORK/bin:$PATH" \
  hf_stack_ownership_status "smoke" "run-a")" = "absent" ]
if MOCK_MODE=foreign PATH="$WORK/bin:$PATH" \
  hf_stack_ownership_status "smoke" "run-a" 2>"$WORK/foreign-error"; then
  echo "expected foreign stack ownership to fail closed" >&2
  exit 1
fi
grep -q "refusing cleanup" "$WORK/foreign-error"
MOCK_MODE=reserve PATH="$WORK/bin:$PATH" \
  hf_reserve_smoke_stack "smoke" "run-a"

discovered=$(MOCK_MODE=discovery PATH="$WORK/bin:$PATH" \
  hf_discover_stack_resources "smoke")
[ "$(jq -r .renderBucket <<<"$discovered")" = "physical-render-bucket" ]
[ "$(jq -r .stateMachineArn <<<"$discovered")" = \
  "arn:aws:states:us-east-2:1:stateMachine:physical" ]

missing=$(MOCK_MODE=missing PATH="$WORK/bin:$PATH" \
  hf_discover_stack_resources "smoke")
[ "$(jq -r .renderBucket <<<"$missing")" = "" ]
[ "$(jq -r .stateMachineArn <<<"$missing")" = "" ]

echo "aws isolation shell test passed"
