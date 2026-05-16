/**
 * `hyperframes lambda sites create <projectDir>` — tar + upload a project
 * to the deployed render bucket at a content-addressed S3 prefix. Used
 * by adopters who want to pre-stage a project so multiple subsequent
 * renders share the upload.
 *
 * Without this verb, every `render` call re-tars the same tree on every
 * invocation. With it, the same `siteId` resolves to a `HeadObject`-204
 * short-circuit inside `deploySite`.
 */

import { resolve as resolvePath } from "node:path";
import { deploySite } from "@hyperframes/aws-lambda/sdk";
import { c } from "../../ui/colors.js";
import { DEFAULT_STACK_NAME, requireStack } from "./state.js";

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

  const handle = await deploySite({
    projectDir,
    bucketName: stack.bucketName,
    region: stack.region,
    siteId: args.siteId,
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
        (args.stackName === `hyperframes-${DEFAULT_STACK_NAME}`
          ? ""
          : ` --stack-name=${args.stackName}`),
    ),
  );
}
