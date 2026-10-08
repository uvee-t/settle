import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, refreshTokens, workspaces, workspaceMembers } from "../../db/schema/core.js";
import { AppError, NotFoundError } from "../../lib/errors.js";
import { authJwtSecret, env } from "../../config/env.js";

const scrypt = promisify(scryptCb);
const secret = new TextEncoder().encode(authJwtSecret);

function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [, saltHex, hashHex] = encoded.split("$");
  if (!saltHex || !hashHex) return false;
  const derived = (await scrypt(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

async function issueAccessToken(userId: string, email: string) {
  return new SignJWT({ email, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

type DbExecutor = Pick<typeof db, "insert" | "query">;

async function issueRefreshToken(
  userId: string,
  familyId: string = randomUUID(),
  executor: DbExecutor = db,
) {
  const token = randomBytes(48).toString("base64url");
  const id = randomUUID();

  await executor.insert(refreshTokens).values({
    id,
    userId,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });

  return { token, familyId, id };
}

export async function register(input: { email: string; password: string; name: string; workspaceName: string }) {
  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const existing = await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) throw new AppError("EMAIL_ALREADY_REGISTERED", "An account with this email already exists.", 409);

    const [user] = await tx.insert(users).values({
      email,
      passwordHash: await hashPassword(input.password),
      name: input.name.trim(),
    }).returning();

    const slug = `${input.workspaceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${randomBytes(3).toString("hex")}`;
    const [workspace] = await tx.insert(workspaces).values({
      name: input.workspaceName.trim(),
      slug,
    }).returning();

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
    });

    const accessToken = await issueAccessToken(user.id, user.email);
    const refresh = await issueRefreshToken(user.id, randomUUID(), tx);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      accessToken,
      refreshToken: refresh.token,
    };
  });
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }

  const memberships = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, user.id),
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);

  const accessToken = await issueAccessToken(user.id, user.email);
  const refresh = await issueRefreshToken(user.id);

  return {
    user: { id: user.id, email: user.email, name: user.name },
    workspaceIds,
    accessToken,
    refreshToken: refresh.token,
  };
}

export async function refresh(input: { refreshToken: string }) {
  const hash = hashRefreshToken(input.refreshToken);
  const tokenRow = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hash),
  });

  if (!tokenRow) {
    throw new AppError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.", 401);
  }

  if (tokenRow.revokedAt) {
    // Refresh-token reuse indicates possible theft. Revoke the entire family.
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, tokenRow.familyId), isNull(refreshTokens.revokedAt)));
    throw new AppError("REFRESH_TOKEN_REUSE", "Refresh token reuse detected. Please sign in again.", 401);
  }

  if (tokenRow.expiresAt <= new Date()) {
    throw new AppError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.", 401);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, tokenRow.userId) });
  if (!user) throw new NotFoundError("User not found.");

  const replacement = await issueRefreshToken(user.id, tokenRow.familyId);

  await db.update(refreshTokens)
    .set({ revokedAt: new Date(), replacedById: replacement.id })
    .where(eq(refreshTokens.id, tokenRow.id));

  return {
    accessToken: await issueAccessToken(user.id, user.email),
    refreshToken: replacement.token,
  };
}

export async function logout(refreshToken: string) {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
}

export async function verifyAccessToken(token: string) {
  if (!token || token.length > 4096) {
    throw new AppError("INVALID_ACCESS_TOKEN", "Invalid access token.", 401);
  }

  try {
    const result = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (result.payload.type !== "access" || !result.payload.sub) {
      throw new AppError("INVALID_ACCESS_TOKEN", "Invalid access token.", 401);
    }
    return { userId: result.payload.sub, email: String(result.payload.email ?? "") };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_ACCESS_TOKEN", "Invalid or expired access token.", 401);
  }
}
