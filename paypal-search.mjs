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

const basic = Buffer
  .from(`${clientId}:${clientSecret}`)
  .toString("base64");

const tokenResponse = await fetch(
  `${baseUrl}/v1/oauth2/token`,
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  },
);

const token = (await tokenResponse.json()).access_token;

const response = await fetch(
  `${baseUrl}/v2/invoicing/search-invoices`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      reference: "E2E-HOMEPAGE-MILESTONE-001",
    }),
  },
);

console.log("HTTP_STATUS:", response.status);
console.log("RESPONSE:");
console.log(await response.text());
