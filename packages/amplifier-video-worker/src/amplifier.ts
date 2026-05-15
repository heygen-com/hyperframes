import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ArtifactRef, ExplainerVideoJobRecord } from "./types.js";

const region = process.env.AWS_REGION || "us-east-1";
const tableName = process.env.DYNAMODB_TABLE_NAME || "amplifier-dev-users";

const s3 = new S3Client({ region });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function jobRecordPk(jobId: string) {
  return `explainerJob#${jobId}`;
}

function getArtifactUrl(key: string) {
  return `/api/infographic/${encodeURIComponent(key)}`;
}

async function readStreamAsString(body: unknown): Promise<string> {
  if (!body) throw new Error("S3 object body missing");
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return await body.transformToString();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function buildArtifact(key: string, mimeType: string): ArtifactRef {
  return {
    key,
    url: getArtifactUrl(key),
    mimeType,
  };
}

export async function readJsonArtifact<T>(bucket: string, key: string): Promise<T> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const raw = await readStreamAsString(response.Body);
  return JSON.parse(raw) as T;
}

export async function uploadJsonArtifact(
  bucket: string,
  key: string,
  payload: unknown,
): Promise<ArtifactRef> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(JSON.stringify(payload, null, 2)),
      ContentType: "application/json",
    }),
  );
  return buildArtifact(key, "application/json");
}

export async function uploadBufferArtifact(
  bucket: string,
  key: string,
  body: Buffer,
  mimeType: string,
): Promise<ArtifactRef> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );
  return buildArtifact(key, mimeType);
}

export async function uploadFileArtifact(
  bucket: string,
  key: string,
  filePath: string,
  mimeType: string,
): Promise<ArtifactRef> {
  const body = await import("node:fs/promises").then((fs) => fs.readFile(filePath));
  return uploadBufferArtifact(bucket, key, body, mimeType);
}

export async function getExplainerVideoJob(jobId: string): Promise<ExplainerVideoJobRecord> {
  const response = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId: jobRecordPk(jobId) },
    }),
  );

  if (!response.Item) {
    throw new Error(`Explainer-video job not found: ${jobId}`);
  }

  return response.Item as ExplainerVideoJobRecord;
}

export async function mergeExplainerVideoJob(
  jobId: string,
  updates: Partial<
    Omit<ExplainerVideoJobRecord, "userId" | "itemType" | "ownerUserId" | "jobId" | "createdAt">
  >,
): Promise<ExplainerVideoJobRecord> {
  const existing = await getExplainerVideoJob(jobId);
  const next: ExplainerVideoJobRecord = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: next,
    }),
  );

  return next;
}
