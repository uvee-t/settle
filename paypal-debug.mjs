import fs from "node:fs";

const envText = fs.readFileSync(".env", "utf8");

for (const line of envText.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;

  const index = line.indexOf("=");
  if (index === -1) continue;

  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  process.env[key] = value;
}

const baseUrl = process.env.PAYPAL_BASE_URL;
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

if (!baseUrl || !clientId || !clientSecret) {
  throw new Error("PayPal environment variables are missing.");
}

const basic = Buffer
  .from(`${clientId}:${clientSecret}`)
  .toString("base64");

const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: "grant_type=client_credentials",
});

const tokenData = await tokenResponse.json();

if (!tokenResponse.ok || !tokenData.access_token) {
  console.log("TOKEN_HTTP_STATUS:", tokenResponse.status);
  console.log("TOKEN_RESPONSE:", JSON.stringify(tokenData, null, 2));
  process.exit(1);
}

const payload = {
  detail: {
    invoice_number: "SETTLE-E2E-DEBUG-001",
    reference: "E2E-HOMEPAGE-DEBUG-001",
    currency_code: "USD",
    payment_term: {
      term_type: "DUE_ON_DATE_SPECIFIED",
      due_date: "2026-10-12",
    },
  },
  primary_recipients: [
    {
      billing_info: {
        email_address: "acme-e2e@example.com",
        name: {
          full_name: "Acme Technologies Inc.",
        },
        business_name: "Acme Technologies Inc.",
      },
    },
  ],
  items: [
    {
      name: "Milestone 1 — Homepage",
      quantity: "1",
      unit_amount: {
        currency_code: "USD",
        value: "300.00",
      },
    },
  ],
};

const response = await fetch(`${baseUrl}/v2/invoicing/invoices`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${tokenData.access_token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "PayPal-Request-Id": "settle-debug-e2e-001",
  },
  body: JSON.stringify(payload),
});

const text = await response.text();

console.log("HTTP_STATUS:", response.status);
console.log(
  "PAYPAL_DEBUG_ID:",
  response.headers.get("paypal-debug-id")
);
console.log("RESPONSE:");
console.log(text);
