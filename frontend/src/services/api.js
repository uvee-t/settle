const API_BASE = (
    import.meta.env.VITE_SETTLE_API_URL || "http://localhost:4000"
).replace(/\/$/, "");

// Access token and workspace context are intentionally memory-only.
// The refresh token is stored in an HttpOnly cookie managed by the backend.
let accessToken = "";
let currentUser = null;
let currentWorkspace = null;
let currentWorkspaceId = "";

export function session() {
    return {
        token: accessToken,
        refreshToken: "",
        workspaceId: currentWorkspaceId,
        user: currentUser,
        workspace: currentWorkspace,
    };
}

export function saveSession(p) {
    accessToken = p.accessToken || p.access_token || "";

    if (p.user) {
        currentUser = p.user;
    }

    if (p.workspace) {
        currentWorkspace = p.workspace;
        currentWorkspaceId = p.workspace.id || "";
    } else if (p.workspaceIds?.length && !currentWorkspaceId) {
        currentWorkspaceId = p.workspaceIds[0];
    }
}

export function clearSession() {
    accessToken = "";
    currentUser = null;
    currentWorkspace = null;
    currentWorkspaceId = "";
}

export const isSignedIn = () =>
    Boolean(session().token && session().workspaceId);

/** Keeps the cached workspace name in step with edits made in Settings. */
export function updateWorkspaceCache(patch) {
    if (currentWorkspace) {
        currentWorkspace = {
            ...currentWorkspace,
            ...patch,
        };
    }
}

export class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

// Prevent parallel requests from rotating the same refresh token.
let refreshing = null;

export function refreshSession() {
    if (!refreshing) {
        refreshing = fetch(`${API_BASE}/v1/auth/refresh`, {
            method: "POST",
            credentials: "include",
        })
            .then(async (response) => {
                if (!response.ok) {
                    clearSession();
                    return false;
                }

                const payload = await response.json();
                saveSession(payload);

                return Boolean(session().token && session().workspaceId);
            })
            .catch(() => false)
            .finally(() => {
                refreshing = null;
            });
    }

    return refreshing;
}

export async function api(path, options = {}) {
    const build = () => {
        const headers = new Headers(options.headers || {});
        const current = session();

        if (current.token) {
            headers.set("authorization", `Bearer ${current.token}`);
        }

        if (current.workspaceId) {
            headers.set("x-workspace-id", current.workspaceId);
        }

        if (
            options.body &&
            !(options.body instanceof FormData) &&
            !headers.has("content-type")
        ) {
            headers.set("content-type", "application/json");
        }

        return {
            ...options,
            headers,
            credentials: "include",
        };
    };

    let response;

    try {
        response = await fetch(`${API_BASE}${path}`, build());
    } catch {
        throw new ApiError(
            "Cannot reach the Settle API. Check your connection and try again.",
            0,
        );
    }

    const hadSession = Boolean(session().token);

    // Refresh once when the access token expires.
    if (response.status === 401 && !path.startsWith("/v1/auth/")) {
        const refreshed = await refreshSession();

        if (refreshed) {
            response = await fetch(`${API_BASE}${path}`, build());
        } else if (hadSession) {
            clearSession();
            window.dispatchEvent(new Event("settle-auth-expired"));
        }
    }

    const raw = await response.text();

    let data = null;

    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        data = raw;
    }

    if (!response.ok) {
        throw new ApiError(
            data?.error?.message ||
                data?.message ||
                `Request failed (${response.status})`,
            response.status,
            data?.error?.code,
        );
    }

    return data;
}
