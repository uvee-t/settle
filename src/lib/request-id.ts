import { randomUUID } from "node:crypto";

export function getRequestId(value?: string): string {
  return value?.trim() || randomUUID();
}
