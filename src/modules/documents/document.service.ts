import { createHash } from "node:crypto";
import {
    S3Client,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { env } from "../../config/env.js";
import { ExternalServiceError, ValidationError } from "../../lib/errors.js";

function storageConfig() {
    const bucket = env.B2_BUCKET ?? env.AWS_S3_BUCKET;
    const accessKeyId = env.B2_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.B2_APPLICATION_KEY ?? env.AWS_SECRET_ACCESS_KEY;
    if (!bucket || !accessKeyId || !secretAccessKey) {
        throw new ExternalServiceError(
            "STORAGE_NOT_CONFIGURED",
            "Object storage is not configured. Set B2_BUCKET, B2_KEY_ID and B2_APPLICATION_KEY.",
            503,
        );
    }
    const useBackblaze = Boolean(env.B2_BUCKET || env.B2_KEY_ID || env.B2_APPLICATION_KEY);
    return {
        bucket,
        accessKeyId,
        secretAccessKey,
        region: useBackblaze ? env.B2_REGION : env.AWS_REGION,
        endpoint: useBackblaze ? env.B2_ENDPOINT : undefined,
        forcePathStyle: useBackblaze,
    };
}

function client() {
    const config = storageConfig();
    return new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
}

function bucketName() {
    return storageConfig().bucket;
}

function allowedContentTypes() {
    return new Set(
        env.DOCUMENT_ALLOWED_CONTENT_TYPES.split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
    );
}

export function assertAllowedContentType(contentType: string) {
    if (!allowedContentTypes().has(contentType.toLowerCase())) {
        throw new ValidationError("Unsupported document content type.", {
            allowed_content_types: [...allowedContentTypes()],
        });
    }
}

export function assertDocumentSize(sizeBytes: number) {
    if (
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes <= 0 ||
        sizeBytes > env.DOCUMENT_MAX_SIZE_BYTES
    ) {
        throw new ValidationError(
            "Document size is invalid or exceeds the configured limit.",
            {
                max_size_bytes: env.DOCUMENT_MAX_SIZE_BYTES,
            },
        );
    }
}

export async function createUploadUrl(input: {
    workspaceId: string;
    filename: string;
    contentType: string;
    sha256: string;
    sizeBytes: number;
}) {
    assertAllowedContentType(input.contentType);
    assertDocumentSize(input.sizeBytes);

    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `workspaces/${input.workspaceId}/documents/${randomUUID()}-${safeFilename}`;

    const command = new PutObjectCommand({
        Bucket: bucketName(),
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
    });
    return {
        key,
        url: await getSignedUrl(client(), command, { expiresIn: 900 }),
        expires_in_seconds: 900,
        required_headers: {
            "content-type": input.contentType,
        },
    };
}

export async function downloadStoredObject(key: string, workspaceId: string): Promise<Buffer> {
  if (!key.startsWith(`workspaces/${workspaceId}/documents/`)) {
    throw new ValidationError("Document storage key does not belong to this workspace.");
  }
  const response = await client().send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
  if (!response.Body) throw new ValidationError("Document object has no readable body.");
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function createDownloadUrl(key: string, workspaceId: string) {
    if (!key.startsWith(`workspaces/${workspaceId}/documents/`)) {
        throw new ExternalServiceError(
            "STORAGE_KEY_FORBIDDEN",
            "Document does not belong to this workspace.",
            403,
        );
    }
    const command = new GetObjectCommand({
        Bucket: bucketName(),
        Key: key,
    });
    return { url: await getSignedUrl(client(), command, { expiresIn: 900 }) };
}

export async function headObject(key: string, workspaceId: string) {
    if (!key.startsWith(`workspaces/${workspaceId}/documents/`)) return null;
    try {
        return await client().send(
            new HeadObjectCommand({
                Bucket: bucketName(),
                Key: key,
                ChecksumMode: "ENABLED",
            }),
        );
    } catch {
        return null;
    }
}

function detectContentType(prefix: Buffer): string | undefined {
    if (prefix.subarray(0, 5).toString("ascii") === "%PDF-")
        return "application/pdf";
    if (
        prefix
            .subarray(0, 8)
            .equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            )
    )
        return "image/png";
    if (prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
        return "image/jpeg";
    if (
        prefix.subarray(0, 6).toString("ascii") === "GIF87a" ||
        prefix.subarray(0, 6).toString("ascii") === "GIF89a"
    )
        return "image/gif";
    if (prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
        return "application/zip";
    return undefined;
}

function extensionFor(filename: string): string | undefined {
    const extension = filename.toLowerCase().split(".").pop();
    if (!extension || extension === filename.toLowerCase()) return undefined;
    return extension;
}

const extensionTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
};

async function scanBufferWithClamAV(buffer: Buffer) {
    if (!env.DOCUMENT_MALWARE_SCAN_ENABLED)
        return { clean: true, skipped: true };
    return await new Promise<{ clean: boolean; skipped: boolean }>(
        (resolve, reject) => {
            const socket = net.createConnection({
                host: env.CLAMAV_HOST,
                port: env.CLAMAV_PORT,
            });
            socket.setTimeout(30_000);
            let response = "";
            let connected = false;
            socket.on("connect", () => {
                connected = true;
                socket.write(Buffer.from("zINSTREAM\0", "binary"));
                const length = Buffer.allocUnsafe(4);
                length.writeUInt32BE(buffer.length, 0);
                socket.write(length);
                socket.write(buffer);
                socket.write(Buffer.alloc(4));
            });
            socket.on("data", (data) => {
                response += data.toString("utf8");
            });
            socket.on("error", (error) =>
                reject(
                    new ExternalServiceError(
                        "MALWARE_SCANNER_UNAVAILABLE",
                        error.message,
                        503,
                    ),
                ),
            );
            socket.on("timeout", () =>
                reject(
                    new ExternalServiceError(
                        "MALWARE_SCANNER_UNAVAILABLE",
                        "Malware scanner timed out.",
                        503,
                    ),
                ),
            );
            socket.on("close", () => {
                const normalized = response.trim();
                if (!connected || !normalized)
                    return reject(
                        new ExternalServiceError(
                            "MALWARE_SCANNER_UNAVAILABLE",
                            "Malware scanner returned no result.",
                            503,
                        ),
                    );
                if (!normalized.endsWith("OK"))
                    return reject(
                        new ValidationError(
                            "Malware scanner rejected the document.",
                            { scanner_response: normalized.slice(0, 500) },
                        ),
                    );
                resolve({ clean: true, skipped: false });
            });
        },
    );
}

export async function verifyStoredDocument(input: {
    workspaceId: string;
    objectKey: string;
    filename: string;
    contentType: string;
    expectedSizeBytes: number;
    expectedSha256: string;
}) {
    if (
        !input.objectKey.startsWith(
            `workspaces/${input.workspaceId}/documents/`,
        )
    ) {
        throw new ValidationError(
            "Document storage key does not belong to this workspace.",
        );
    }
    assertAllowedContentType(input.contentType);
    assertDocumentSize(input.expectedSizeBytes);

    const response = await client().send(
        new GetObjectCommand({
            Bucket: bucketName(),
            Key: input.objectKey,
        }),
    );
    if (!response.Body)
        throw new ValidationError("Document object has no readable body.");

    const hash = createHash("sha256");
    let size = 0;
    let prefix = Buffer.alloc(0);
    const chunks: Buffer[] = [];

    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > env.DOCUMENT_MAX_SIZE_BYTES) {
            throw new ValidationError(
                "Document exceeds the configured maximum size.",
            );
        }
        chunks.push(buffer);
        hash.update(buffer);
        if (prefix.length < 16)
            prefix = Buffer.concat([prefix, buffer]).subarray(0, 16);
    }

    const content = Buffer.concat(chunks);
    await scanBufferWithClamAV(content);
    const actualSha256 = hash.digest("hex");
    if (size !== input.expectedSizeBytes)
        throw new ValidationError("Document size verification failed.");
    if (actualSha256 !== input.expectedSha256.toLowerCase())
        throw new ValidationError("Document SHA-256 verification failed.");

    const detectedContentType = detectContentType(prefix);
    const extensionType = extensionTypes[extensionFor(input.filename) ?? ""];

    if (detectedContentType && detectedContentType !== input.contentType) {
        throw new ValidationError(
            "Document content does not match the declared content type.",
            {
                declared_content_type: input.contentType,
                detected_content_type: detectedContentType,
            },
        );
    }

    if (extensionType && extensionType !== input.contentType) {
        throw new ValidationError(
            "Document filename extension does not match the declared content type.",
            {
                filename: input.filename,
                declared_content_type: input.contentType,
            },
        );
    }

    if (response.ContentType && response.ContentType !== input.contentType) {
        throw new ValidationError(
            "Stored document content type does not match the declared content type.",
        );
    }

    return {
        sizeBytes: size,
        sha256: actualSha256,
        detectedContentType: detectedContentType ?? input.contentType,
    };
}
