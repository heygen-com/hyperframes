/**
 * `hyperframes lambda destroy` — tear the CloudFormation stack down and
 * drop the locally-cached stack outputs. Wraps `sam delete`.
 *
 * The render bucket is created with `Retain` deletion policy in the SAM
 * template, so the underlying S3 bucket survives destruction. Adopters
 * who want to fully delete it must do so via the AWS console / CLI
 * after this command completes; we document that in the deploy guide
 * rather than re-implementing the empty-and-delete dance here.
 */

import { c } from "../../ui/colors.js";
import { deleteStackOutputs, requireStack } from "./state.js";
import { samDelete } from "./sam.js";
import { repoRoot } from "./repoRoot.js";

export interface DestroyArgs {
  stackName: string;
  awsProfile?: string;
}

export async function runDestroy(args: DestroyArgs): Promise<void> {
  const stack = requireStack(args.stackName);
  console.log(c.dim(`→ sam delete (stack=${stack.stackName} region=${stack.region})`));
  // Mirror deploy.ts's AWS_PROFILE env fallback — `AWS_PROFILE=prod
  // hyperframes lambda destroy` should hit the same account `deploy`
  // did, not the default credentials chain.
  samDelete({
    repoRoot: repoRoot(),
    stackName: stack.stackName,
    region: stack.region,
    awsProfile: args.awsProfile ?? process.env.AWS_PROFILE,
  });
  deleteStackOutputs(args.stackName);
  console.log();
  console.log(c.success("Stack torn down."));
  console.log(
    c.dim(
      `Note: the render bucket "${stack.bucketName}" was deployed with Retain — empty + delete it via the AWS console or CLI if you want to fully reclaim storage.`,
    ),
  );
}
