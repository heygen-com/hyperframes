import { describe, expect, it } from "bun:test";
import { CopyObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseStateMachineArn, pinBucketOwner } from "./bucketOwner.js";

const STOP = new Error("captured");

/** The input `command` reaches S3's serializer with, read before any request is sent. */
async function sentInput(s3: S3Client, command: PutObjectCommand | CopyObjectCommand) {
  let input: Record<string, unknown> = {};
  s3.middlewareStack.add(
    () => async (args) => {
      input = { ...args.input };
      throw STOP;
    },
    { step: "serialize", name: "capture", override: true },
  );
  await expect(s3.send(command)).rejects.toBe(STOP);
  return input;
}

const client = () =>
  new S3Client({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" } });

describe("parseStateMachineArn", () => {
  it("reads the region and account of a state machine ARN", () => {
    expect(
      parseStateMachineArn("arn:aws:states:us-east-2:123456789012:stateMachine:hyperframes-render"),
    ).toEqual({ region: "us-east-2", account: "123456789012" });
    expect(
      parseStateMachineArn("arn:aws-cn:states:cn-north-1:123456789012:stateMachine:hf").account,
    ).toBe("123456789012");
  });

  it.each([
    "arn:aws:states:us-east-1:1234:stateMachine:hf",
    "arn:aws:states:us-east-1:123456789012:execution:hf:run",
    "arn:aws:s3:::bucket",
    "arn:aws:states:us-east-1:123456789012:stateMachine:hf\nx",
  ])("refuses %p", (arn) => {
    expect(() => parseStateMachineArn(arn)).toThrow("INVALID_STATE_MACHINE_ARN");
  });
});

describe("pinBucketOwner", () => {
  it("names the owner on every request, over any owner the caller set", async () => {
    const s3 = pinBucketOwner(client(), "123456789012");
    const put = new PutObjectCommand({
      Bucket: "b",
      Key: "k",
      Body: "x",
      ExpectedBucketOwner: "999999999999",
    });
    expect(await sentInput(s3, put)).toMatchObject({ ExpectedBucketOwner: "123456789012" });
  });

  it("names the owner of a copy's source too, and a second pin replaces the first", async () => {
    const s3 = pinBucketOwner(pinBucketOwner(client(), "111111111111"), "123456789012");
    const copy = new CopyObjectCommand({ Bucket: "b", Key: "k", CopySource: "b/old" });
    expect(await sentInput(s3, copy)).toMatchObject({
      ExpectedBucketOwner: "123456789012",
      ExpectedSourceBucketOwner: "123456789012",
    });
  });
});
