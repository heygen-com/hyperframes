/**
 * `hyperframes lambda sites create <projectDir>` — upload a project's files
 * to the deployed render bucket's shared content store. Used by adopters
 * who want to pre-stage a project so multiple subsequent renders share the
 * upload; files already in the bucket are skipped.
 */

import { resolve as resolvePath } from "node:path";
import { c } from "../../ui/colors.js";
import { DEFAULT_STACK_NAME, requireStack } from "./state.js";

// `@hyperframes/aws-lambda` is a workspace devDependency in `packages/cli`
// so the published CLI install stays small for users who don't deploy to
// Lambda. The lambda subverbs dynamic-import it on call. The dispatcher in
// `commands/lambda.ts` checks the import resolves before any subverb runs
// and prints a friendly install hint on `ERR_MODULE_NOT_FOUND`.
async function loadSDK(): Promise<typeof import("@hyperframes/aws-lambda/sdk")> {
  return import("@hyperframes/aws-lambda/sdk");
}

export interface SitesCreateArgs {
  projectDir: string;
  stackName: string;
  siteId?: string;
  /** Print machine-readable JSON instead of the human-friendly summary. */
  json: boolean;
}

export async function runSitesCreate(args: SitesCreateArgs): Promise<void> {
  const stack = requireStack(args.stackName);
  const projectDir = resolvePath(args.projectDir);

  const { assertStackReadsSites, deploySite } = await loadSDK();
  await assertStackReadsSites({ stateMachineArn: stack.stateMachineArn, region: stack.region });
  const handle = await deploySite({
    projectDir,
    bucketName: stack.bucketName,
    region: stack.region,
    siteId: args.siteId,
    onNotice: (message) => console.error(c.dim(message)),
  });

  if (args.json) {
    console.log(JSON.stringify(handle, null, 2));
    return;
  }

  console.log(
    c.success(handle.uploaded ? "Site uploaded." : "Site already up to date (skipped upload)."),
  );
  console.log(`  ${c.dim("Site ID:")}       ${handle.siteId}`);
  console.log(`  ${c.dim("S3 URI:")}        ${handle.projectS3Uri}`);
  console.log(`  ${c.dim("Bytes:")}         ${handle.bytes}`);
  console.log(`  ${c.dim("Uploaded at:")}   ${handle.uploadedAt}`);
  console.log();
  console.log(
    c.dim(
      `Render with: hyperframes lambda render ${args.projectDir} --site-id=${handle.siteId}` +
        (args.stackName === DEFAULT_STACK_NAME ? "" : ` --stack-name=${args.stackName}`),
    ),
  );
}
