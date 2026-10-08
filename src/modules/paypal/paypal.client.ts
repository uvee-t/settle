import { env } from "../../config/env.js";
import { ExternalServiceError } from "../../lib/errors.js";

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export class PayPalClient {
  private cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly clientId = env.PAYPAL_CLIENT_ID,
    private readonly clientSecret = env.PAYPAL_CLIENT_SECRET,
    private readonly baseUrl = env.PAYPAL_BASE_URL,
  ) {}

  private requireCredentials() {
    if (!this.clientId || !this.clientSecret) {
      throw new ExternalServiceError("PAYPAL_NOT_CONFIGURED", "PayPal credentials are not configured.", 503);
    }
  }

  async getAccessToken(): Promise<string> {
    this.requireCredentials();

    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.token;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });

      const data = (await response.json()) as TokenResponse & Record<string, unknown>;
      if (!response.ok || !data.access_token) {
        throw new ExternalServiceError(
          "PAYPAL_AUTHENTICATION_FAILED",
          "Unable to obtain a PayPal access token.",
          502,
          { status: response.status, debugId: response.headers.get("paypal-debug-id") },
        );
      }

      this.cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      return data.access_token;
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError("PAYPAL_AUTHENTICATION_FAILED", "PayPal authentication request failed.", 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async request<T>(path: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
    const maxAttempts = 3;
    const method = (options.method ?? "GET").toUpperCase();
    const initialHeaders = new Headers(options.headers);
    const retrySafe = method === "GET" || method === "HEAD" || initialHeaders.has("PayPal-Request-Id");

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const token = await this.getAccessToken();
      const headers = new Headers(initialHeaders);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Accept", "application/json");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers, signal: controller.signal });
        const text = await response.text();

        let data: unknown = null;
        if (text) {
          try { data = JSON.parse(text); } catch { data = { raw: text }; }
        }

        if (response.ok) return data as T;

        if (response.status === 401 && attempt === 1) {
          this.cachedToken = undefined;
          continue;
        }

        const retryableStatus = response.status === 429 || response.status >= 500;
        if (retrySafe && retryableStatus && attempt < maxAttempts) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10_000)
            : 250 * 2 ** (attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new ExternalServiceError(
          `PAYPAL_HTTP_${response.status}`,
          "PayPal request failed.",
          response.status >= 500 || response.status === 429 ? 502 : response.status,
          { provider: "paypal", status: response.status, debugId: response.headers.get("paypal-debug-id"), body: data },
        );
      } catch (error) {
        if (error instanceof ExternalServiceError) throw error;
        if (retrySafe && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
          continue;
        }
        throw new ExternalServiceError("PAYPAL_REQUEST_FAILED", "PayPal request failed or timed out.", 502);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ExternalServiceError("PAYPAL_REQUEST_FAILED", "PayPal request failed.", 502);
  }

  async verifyWebhookSignature(input: {
    auth_algo: string;
    cert_url: string;
    transmission_id: string;
    transmission_sig: string;
    transmission_time: string;
    webhook_id: string;
    webhook_event: Record<string, unknown>;
  }) {
    const data = await this.request<{ verification_status?: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    return data;
  }
}

export const paypalClient = new PayPalClient();
