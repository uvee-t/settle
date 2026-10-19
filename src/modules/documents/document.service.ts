import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { ExternalServiceError } from "../../lib/errors.js";

function client() {
  if (!env.AWS_S3_BUCKET || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new ExternalServiceError("S3_NOT_CONFIGURED", "S3 storage is not configured.", 503);
  }
  return new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export async function createUploadUrl(input: {
  workspaceId: string;
  filename: string;
  contentType: string;
  sha256: string;
}) {
  const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `workspaces/${input.workspaceId}/documents/${randomUUID()}-${safeFilename}`;
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: input.contentType,
    ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
    ServerSideEncryption: "AES256",
  });
  return {
    key,
    url: await getSignedUrl(client(), command, { expiresIn: 900 }),
    required_headers: {
      "content-type": input.contentType,
      "x-amz-checksum-sha256": Buffer.from(input.sha256, "hex").toString("base64"),
    },
  };
}

export async function createDownloadUrl(key: string, workspaceId: string) {
  if (!key.startsWith(`workspaces/${workspaceId}/documents/`)) {
    throw new ExternalServiceError("STORAGE_KEY_FORBIDDEN", "Document does not belong to this workspace.", 403);
  }
  const command = new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key });
  return { url: await getSignedUrl(client(), command, { expiresIn: 900 }) };
}

export async function headObject(key: string, workspaceId: string) {
  if (!key.startsWith(`workspaces/${workspaceId}/documents/`)) return null;
  try {
    return await client().send(new HeadObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key, ChecksumMode: "ENABLED" }));
  } catch {
    return null;
  }
}
