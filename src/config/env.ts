import "dotenv/config";
import { z } from "zod";

const schema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    PAYPAL_BASE_URL: z.url().default("https://api-m.sandbox.paypal.com"),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    PAYPAL_CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),

    CORS_ORIGIN: z.string().default("http://localhost:5173"),

    // Backblaze B2 S3-compatible storage. Legacy AWS variables remain as
    // fallbacks so existing deployments can migrate without a code rollback.
    B2_ENDPOINT: z.url().default("https://s3.us-east-005.backblazeb2.com"),
    B2_REGION: z.string().default("us-east-005"),
    B2_BUCKET: z.string().optional(),
    B2_KEY_ID: z.string().optional(),
    B2_APPLICATION_KEY: z.string().optional(),
    AWS_REGION: z.string().default("ap-south-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),

    AUTH_JWT_SECRET: z.string().min(32).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    DB_CONNECTION_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10_000),
    DB_POOL_MAX: z.coerce.number().int().positive().default(20),
    DB_HOST_OVERRIDE: z.string().optional(),
    DB_SSL: z.preprocess(
        (value) =>
            value === undefined
                ? true
                : value === true || value === "true" || value === "1",
        z.boolean(),
    ),
    DB_SSL_REJECT_UNAUTHORIZED: z.preprocess(
        (value) =>
            value === undefined
                ? true
                : value === true || value === "true" || value === "1",
        z.boolean(),
    ),

    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    API_RATE_LIMIT_WINDOW: z.string().default("1 minute"),
    REMINDER_DAYS_BEFORE_DUE: z.coerce.number().int().min(0).max(30).default(3),
    REMINDER_ENABLED: z.preprocess(
        (value) =>
            value === undefined
                ? true
                : value === true || value === "true" || value === "1",
        z.boolean(),
    ),

    DOCUMENT_MAX_SIZE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(25 * 1024 * 1024),
    DOCUMENT_ALLOWED_CONTENT_TYPES: z
        .string()
        .default(
            "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/gif,text/plain,text/csv,application/json",
        ),
    DOCUMENT_MALWARE_SCAN_ENABLED: z.preprocess(
        (value) =>
            value === undefined
                ? false
                : value === true || value === "true" || value === "1",
        z.boolean(),
    ),
    CLAMAV_HOST: z.string().default("127.0.0.1"),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

    AI_ENABLED: z.preprocess(
        (value) =>
            value === undefined
                ? false
                : value === true || value === "true" || value === "1",
        z.boolean(),
    ),
    AI_PROVIDER: z.enum(["gemini", "openai"]).default("gemini"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("gemini-2.5-flash"),
    AI_BASE_URL: z.preprocess(
        (value) =>
            typeof value === "string" && value.trim() === ""
                ? undefined
                : value,
        z.url().optional(),
    ),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(120_000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error(
        "Invalid environment configuration",
        parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

if (env.NODE_ENV === "production") {
    if (!env.AUTH_JWT_SECRET)
        throw new Error("AUTH_JWT_SECRET is required in production.");
    if (!env.PAYPAL_CREDENTIALS_ENCRYPTION_KEY || Buffer.byteLength(env.PAYPAL_CREDENTIALS_ENCRYPTION_KEY, "utf8") !== 32) {
        throw new Error("PAYPAL_CREDENTIALS_ENCRYPTION_KEY must be exactly 32 UTF-8 bytes in production.");
    }
    if (env.PAYPAL_BASE_URL.includes("sandbox")) {
        throw new Error("Production cannot use the PayPal Sandbox API.");
    }
    if (env.CORS_ORIGIN === "http://localhost:5173") {
        throw new Error(
            "CORS_ORIGIN must be explicitly configured in production.",
        );
    }
    if (!env.DOCUMENT_MALWARE_SCAN_ENABLED) {
        throw new Error(
            "DOCUMENT_MALWARE_SCAN_ENABLED must be enabled in production.",
        );
    }
    if (env.AI_ENABLED && !env.AI_API_KEY) {
        throw new Error("AI_API_KEY is required when AI_ENABLED is true.");
    }
}

export const authJwtSecret =
    env.AUTH_JWT_SECRET ??
    "settle-development-only-jwt-secret-change-me-please-32chars";
