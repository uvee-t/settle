import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Redis Cloud DNS/network failures (including transient EAI_AGAIN) should not
 * permanently kill queue workers. ioredis will keep reconnecting with capped
 * exponential backoff; BullMQ requires maxRetriesPerRequest=null.
 * A persistently incorrect hostname still needs to be corrected in REDIS_URL.
 */
export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    connectTimeout: 10_000,
    keepAlive: 10_000,
    retryStrategy(times) {
        const exponent = Math.min(Math.max(times - 1, 0), 6);
        const baseDelay = Math.min(250 * 2 ** exponent, 10_000);
        const jitter = Math.floor(Math.random() * 250);
        return baseDelay + jitter;
    },
});
