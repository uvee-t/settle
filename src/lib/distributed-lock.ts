import { randomUUID } from "node:crypto";
import { redis } from "./redis.js";
import { AppError } from "./errors.js";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 5_000;
const RETRY_DELAY_MS = 100;

export async function withRedisLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: {
    ttlMs?: number;
    waitMs?: number;
  } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;

  let acquired = false;

  while (!acquired) {
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    acquired = result === "OK";

    if (acquired) break;
    if (Date.now() >= deadline) {
      throw new AppError(
        "RESOURCE_BUSY",
        "The requested operation is already being processed.",
        409,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
