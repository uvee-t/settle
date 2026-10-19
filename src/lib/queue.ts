import { Queue } from "bullmq";
import { redis } from "./redis.js";

const defaults = { attempts: 5, backoff: { type: "exponential" as const, delay: 1000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 5000 } };
export const webhookQueue = new Queue("settle-webhooks", { connection: redis, defaultJobOptions: defaults });
export const outboxQueue = new Queue("settle-outbox", { connection: redis, defaultJobOptions: defaults });
export const disputeQueue = new Queue("settle-disputes", { connection: redis, defaultJobOptions: { ...defaults, backoff: { type: "exponential", delay: 2000 } } });
export const reminderQueue = new Queue("settle-reminders", { connection: redis, defaultJobOptions: { ...defaults, attempts: 4, backoff: { type: "exponential", delay: 5000 } } });
