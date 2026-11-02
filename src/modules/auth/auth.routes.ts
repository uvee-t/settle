import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { login, logout, refresh, register } from "./auth.service.js";

const registerSchema = z.object({
    email: z.email(),
    password: z.string().min(10).max(128),
    name: z.string().min(1).max(120),
    workspace_name: z.string().min(1).max(120),
});

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

const REFRESH_COOKIE = "settle_refresh";

const refreshCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/v1/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
};

function setRefreshCookie(reply: FastifyReply, token: string) {
    reply.setCookie(REFRESH_COOKIE, token, refreshCookieOptions);
}

function clearRefreshCookie(reply: FastifyReply) {
    reply.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/v1/auth",
    });
}

export async function authRoutes(app: FastifyInstance) {
    // REGISTER
    app.post(
        "/v1/auth/register",
        {
            config: {
                rateLimit: { max: 10, timeWindow: "1 minute" },
            },
        },
        async (request, reply) => {
            const body = registerSchema.parse(request.body);

            const result = await register({
                email: body.email,
                password: body.password,
                name: body.name,
                workspaceName: body.workspace_name,
            });

            setRefreshCookie(reply, result.refreshToken);

            return reply.code(201).send({
                user: result.user,
                workspace: result.workspace,
                accessToken: result.accessToken,
            });
        },
    );

    // LOGIN
    app.post(
        "/v1/auth/login",
        {
            config: {
                rateLimit: { max: 10, timeWindow: "1 minute" },
            },
        },
        async (request, reply) => {
            const result = await login(loginSchema.parse(request.body));

            setRefreshCookie(reply, result.refreshToken);

            return reply.send({
                user: result.user,
                workspaceIds: result.workspaceIds,
                accessToken: result.accessToken,
            });
        },
    );

    // REFRESH ACCESS TOKEN
    app.post(
        "/v1/auth/refresh",
        {
            config: {
                rateLimit: { max: 20, timeWindow: "1 minute" },
            },
        },
        async (request, reply) => {
            const token = request.cookies?.[REFRESH_COOKIE];

            if (!token) {
                throw new AppError(
                    "INVALID_REFRESH_TOKEN",
                    "Refresh session is missing or expired.",
                    401,
                );
            }

            const result = await refresh({
                refreshToken: token,
            });

            setRefreshCookie(reply, result.refreshToken);

            return reply.send({
                user: result.user,
                workspaceIds: result.workspaceIds,
                accessToken: result.accessToken,
            });
        },
    );

    // LOGOUT
    app.post(
        "/v1/auth/logout",
        {
            config: {
                rateLimit: { max: 20, timeWindow: "1 minute" },
            },
        },
        async (request, reply) => {
            const token = request.cookies?.[REFRESH_COOKIE];

            if (token) {
                await logout(token);
            }

            clearRefreshCookie(reply);

            return reply.send({ success: true });
        },
    );
}
