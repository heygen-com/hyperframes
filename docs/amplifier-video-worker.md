# Amplifier Video Worker

This worker is the render backend for Amplifier explainer-video jobs.

It runs as a dedicated ECS Fargate service and pulls jobs from SQS, then:

- reads the Amplifier `source.json`, `brief.json`, and `plan.json` artifacts
- generates narration/script cards
- synthesizes voiceover with ElevenLabs when enabled
- renders the MP4 through Hyperframes
- uploads artifacts back to the Amplifier assets bucket
- updates the Amplifier DynamoDB job record

## AWS targets

- Account: `913524910742`
- Region: `us-east-1`
- ECS cluster: `amplifier-dev-cluster`
- ECS service: `amplifier-dev-video-worker`
- Task definition family: `amplifier-dev-video-worker`
- Queue: `amplifier-dev-explainer-video-jobs`
- DLQ: `amplifier-dev-explainer-video-jobs-dlq`
- ECR repo: `amplifier/dev/video-worker`
- CloudWatch log group: `/ecs/amplifier-dev-video-worker`

## Runtime config

- `AMPLIFIER_VIDEO_QUEUE_URL`
- `DYNAMODB_TABLE_NAME`
- `AWS_REGION`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- optional: `ELEVENLABS_MODEL_ID`
- optional: `WORKER_POLL_WAIT_SECONDS`
- optional: `WORKER_VISIBILITY_TIMEOUT_SECONDS`
- optional: `HYPERFRAMES_RENDER_WORKERS`

## Deploy

Use:

```bash
scripts/deploy-amplifier-worker.sh
```

That script builds `Dockerfile.amplifier-worker` for `linux/amd64` and pushes both
`latest` and the current git-sha tag to the Amplifier ECR repo.
