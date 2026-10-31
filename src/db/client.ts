import dns from "node:dns/promises";
import net from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

const databaseUrl = new URL(env.DATABASE_URL);

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(env.DB_CONNECTION_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function resolveDatabaseHost(): Promise<string> {
  if (env.DB_HOST_OVERRIDE) return env.DB_HOST_OVERRIDE;

  const hostname = databaseUrl.hostname;
  const port = Number(databaseUrl.port || 5432);
  const addresses = await dns.resolve4(hostname);

  for (const address of addresses) {
    if (await canConnect(address, port)) {
      logger.info(
        { hostname, address },
        "Selected reachable PostgreSQL IPv4 address",
      );
      return address;
    }
  }

  throw new Error(
    `No reachable IPv4 address found for PostgreSQL host ${hostname}`,
  );
}

const databaseHost = await resolveDatabaseHost();

export const pool = new Pool({
  host: databaseHost,
  port: Number(databaseUrl.port || 5432),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: databaseUrl.pathname.slice(1),
  ssl: env.DB_SSL
    ? {
        servername: databaseUrl.hostname,
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
      }
    : false,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

pool.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

export const db = drizzle(pool, { schema });
