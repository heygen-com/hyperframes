#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-prod-aicoe-admin}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT="${AWS_ACCOUNT:-913524910742}"
ECR_REPO="${ECR_REPO:-$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/amplifier/dev/video-worker}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"

echo "Building $ECR_REPO:$IMAGE_TAG"

aws --profile "$AWS_PROFILE" ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

docker buildx build \
  --platform linux/amd64 \
  -f Dockerfile.amplifier-worker \
  -t "$ECR_REPO:latest" \
  -t "$ECR_REPO:$IMAGE_TAG" \
  --push \
  .

echo "Pushed:"
echo "  $ECR_REPO:latest"
echo "  $ECR_REPO:$IMAGE_TAG"
