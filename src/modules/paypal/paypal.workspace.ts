import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { paypalAccounts } from "../../db/schema/paypal.js";
import { env } from "../../config/env.js";
import { AppError, ExternalServiceError } from "../../lib/errors.js";
import { PayPalClient } from "./paypal.client.js";

function encryptionKey(): Buffer {
  const value = env.PAYPAL_CREDENTIALS_ENCRYPTION_KEY;
  if (!value || Buffer.byteLength(value, "utf8") !== 32) {
    throw new AppError("PAYPAL_ENCRYPTION_NOT_CONFIGURED", "Workspace PayPal credential encryption is not configured. Set a 32-byte PAYPAL_CREDENTIALS_ENCRYPTION_KEY.", 503);
  }
  return Buffer.from(value, "utf8");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  try {
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted value");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("PAYPAL_CREDENTIAL_DECRYPTION_FAILED", "Stored PayPal credentials cannot be decrypted. Check the encryption key.", 500);
  }
}

export async function getWorkspacePayPalClient(workspaceId: string): Promise<PayPalClient> {
  const account = await db.query.paypalAccounts.findFirst({ where: eq(paypalAccounts.workspaceId, workspaceId) });
  if (!account || account.connectionStatus !== "CONNECTED" || !account.clientIdEncrypted || !account.clientSecretEncrypted) {
    throw new ExternalServiceError("PAYPAL_WORKSPACE_NOT_CONNECTED", "Connect a PayPal app in this workspace's Settings first.", 409);
  }
  const baseUrl = account.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  return new PayPalClient(decryptSecret(account.clientIdEncrypted), decryptSecret(account.clientSecretEncrypted), baseUrl);
}
