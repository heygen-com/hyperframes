import type { S3Client } from "@aws-sdk/client-s3";

const STATE_MACHINE_ARN =
  /^arn:aws(?:-cn|-us-gov)?:states:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):stateMachine:[\w-]{1,80}$/;

/** The region and account of a state machine ARN; throws for anything that is not one. */
export function parseStateMachineArn(arn: string): { region: string; account: string } {
  const match = STATE_MACHINE_ARN.exec(arn);
  if (!match) {
    const error = new Error(`[renderToLambda] INVALID_STATE_MACHINE_ARN: ${JSON.stringify(arn)}`);
    error.name = "INVALID_STATE_MACHINE_ARN";
    throw error;
  }
  return { region: match[1]!, account: match[2]! };
}

const PIN = "hyperframesExpectedBucketOwner";

/**
 * Makes every request `s3` sends name `owner` as the bucket's owner (and the copy source's), so S3 answers
 * 403 for a bucket another account owns instead of storing the project there. Applied again, it replaces the pin.
 */
export function pinBucketOwner(s3: S3Client, owner: string): S3Client {
  s3.middlewareStack.remove(PIN);
  s3.middlewareStack.add(
    (next) => (args) => {
      const copies = "CopySource" in args.input;
      return next({
        ...args,
        input: {
          ...args.input,
          ExpectedBucketOwner: owner,
          ...(copies && { ExpectedSourceBucketOwner: owner }),
        },
      });
    },
    { step: "initialize", name: PIN },
  );
  return s3;
}
