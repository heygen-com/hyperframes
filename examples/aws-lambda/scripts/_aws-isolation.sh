#!/usr/bin/env bash
# AWS resource-name isolation and failed-deploy discovery helpers.

hf_derive_project_name() {
  local stack_name="$1" prefix digest
  prefix=$(printf '%s' "$stack_name" |
    tr -c '[:alnum:]-' '-' |
    sed -E 's/^-+//; s/-+$//' |
    cut -c1-36)
  [ -n "$prefix" ] || prefix="hf-smoke"
  digest=$(printf '%s' "$stack_name" | sha256sum | awk '{print substr($1,1,12)}')
  printf '%s-%s\n' "$prefix" "$digest"
}

hf_known_absent() {
  local pattern="$1" output_file="$2"
  grep -Eiq "$pattern" "$output_file"
}

hf_assert_command_absent() {
  local label="$1" absent_pattern="$2"
  shift 2
  local output_file status detail
  output_file=$(mktemp)
  if "$@" >"$output_file" 2>&1; then
    echo "ERROR: destructive-isolation collision: $label already exists" >&2
    rm -f "$output_file"
    return 1
  else
    status=$?
  fi
  if ! hf_known_absent "$absent_pattern" "$output_file"; then
    detail=$(tr '\n' ' ' < "$output_file" | cut -c1-240)
    echo "ERROR: could not prove $label absent (exit=$status): $detail" >&2
    rm -f "$output_file"
    return 2
  fi
  rm -f "$output_file"
}

hf_assert_named_list_absent() {
  local label="$1"
  shift
  local output_file output status detail
  output_file=$(mktemp)
  if output=$("$@" 2>"$output_file"); then
    if [ -n "$output" ]; then
      echo "ERROR: destructive-isolation collision: $label already exists ($output)" >&2
      rm -f "$output_file"
      return 1
    fi
  else
    status=$?
    detail=$(tr '\n' ' ' < "$output_file" | cut -c1-240)
    echo "ERROR: could not verify $label absence (exit=$status): $detail" >&2
    rm -f "$output_file"
    return 2
  fi
  rm -f "$output_file"
}

# Fail closed unless every exact name this smoke run can destructively clean
# is absent. Call before arming cleanup or creating any AWS resource.
hf_assert_deploy_isolation() {
  local stack_name="$1" project_name="$2"
  local function_name="${project_name}-render"
  local lambda_log="/aws/lambda/${function_name}"
  local states_log="/aws/states/${function_name}"

  hf_assert_command_absent "CloudFormation stack $stack_name" "does not exist" \
    aws cloudformation describe-stacks --stack-name "$stack_name" &&
    hf_assert_command_absent "Lambda function $function_name" \
      "ResourceNotFoundException|Function not found" \
      aws lambda get-function --function-name "$function_name" &&
    hf_assert_named_list_absent "Step Functions state machine $function_name" \
      aws stepfunctions list-state-machines \
      --query "stateMachines[?name=='$function_name'].stateMachineArn" --output text &&
    hf_assert_named_list_absent "log group $lambda_log" \
      aws logs describe-log-groups --log-group-name-prefix "$lambda_log" \
      --query "logGroups[?logGroupName=='$lambda_log'].logGroupName" --output text &&
    hf_assert_named_list_absent "log group $states_log" \
      aws logs describe-log-groups --log-group-name-prefix "$states_log" \
      --query "logGroups[?logGroupName=='$states_log'].logGroupName" --output text
}

# Return a JSON object with any physical resources CloudFormation managed to
# create, even when stack outputs were never populated. A genuinely absent
# stack is an empty result; auth/network/query failures are errors.
hf_discover_stack_resources() {
  local stack_name="$1" output_file error_file status detail
  output_file=$(mktemp)
  error_file=$(mktemp)
  if aws cloudformation list-stack-resources \
    --stack-name "$stack_name" --output json >"$output_file" 2>"$error_file"; then
    jq '{
      renderBucket: (
        [.StackResourceSummaries[]?
          | select(.LogicalResourceId == "RenderBucket")
          | .PhysicalResourceId][0] // ""
      ),
      stateMachineArn: (
        [.StackResourceSummaries[]?
          | select(.LogicalResourceId == "RenderStateMachine")
          | .PhysicalResourceId][0] // ""
      )
    }' "$output_file"
    rm -f "$output_file" "$error_file"
    return
  else
    status=$?
  fi
  if hf_known_absent "does not exist" "$error_file"; then
    printf '{"renderBucket":"","stateMachineArn":""}\n'
    rm -f "$output_file" "$error_file"
    return
  fi
  detail=$(tr '\n' ' ' < "$error_file" | cut -c1-240)
  echo "ERROR: failed to discover physical stack resources (exit=$status): $detail" >&2
  rm -f "$output_file" "$error_file"
  return 2
}
