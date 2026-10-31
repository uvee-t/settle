import { api } from "../services/api.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.txt,.csv,.json,application/pdf,image/png,image/jpeg,image/gif,text/plain,text/csv,application/json";
const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/json",
]);
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Validates, hashes and uploads through the signed-URL flow, then registers the document. Returns the created document. */
export async function uploadDocument(file, metadata, onStage = () => {}) {
  const type =
    file.type ||
    (file.name.toLowerCase().endsWith(".docx")
      ? DOCX
      : "application/octet-stream");
  if (!ALLOWED.has(type))
    throw new Error(
      "Unsupported file type. Allowed types: PDF, PNG, JPG, GIF, TXT, CSV and JSON.",
    );
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("This file is larger than 25 MB.");
  if (file.size === 0) throw new Error("This file is empty.");

  onStage("Checking file");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  onStage("Requesting upload");
  const signed = await api("/v1/documents/upload-url", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: type,
      sha256,
      size_bytes: file.size,
    }),
  });
  const headers = { ...(signed.required_headers || { "content-type": type }) };
  delete headers["content-length"];
  delete headers["Content-Length"];

  onStage("Uploading");
  const put = await fetch(signed.url, { method: "PUT", headers, body: file });
  if (!put.ok)
    throw new Error(
      `Storage upload failed (${put.status}). Check the Backblaze B2 bucket CORS policy and credentials.`,
    );

  onStage("Saving");
  return api("/v1/documents", {
    method: "POST",
    body: JSON.stringify({
      object_key: signed.key,
      filename: file.name,
      content_type: type,
      size_bytes: String(file.size),
      sha256,
      ...(metadata ? { metadata } : {}),
    }),
  });
}
