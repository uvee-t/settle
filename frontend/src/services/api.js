const API_BASE = (
    import.meta.env.VITE_SETTLE_API_URL || "http://localhost:4000"
).replace(/\/$/, "");
const get = (k) => sessionStorage.getItem(`settle.${k}`) || "";
export function session() {
    return {
        token: get("accessToken"),
        refreshToken: get("refreshToken"),
        workspaceId: get("workspaceId"),
        user: JSON.parse(get("user") || "null"),
        workspace: JSON.parse(get("workspace") || "null"),
    };
}
export function saveSession(p) {
    sessionStorage.setItem(
        "settle.accessToken",
        p.accessToken || p.access_token || "",
    );
    sessionStorage.setItem(
        "settle.refreshToken",
        p.refreshToken || p.refresh_token || "",
    );
    if (p.user) sessionStorage.setItem("settle.user", JSON.stringify(p.user));
    if (p.workspace) {
        sessionStorage.setItem("settle.workspace", JSON.stringify(p.workspace));
        sessionStorage.setItem("settle.workspaceId", p.workspace.id || "");
    } else if (p.workspaceIds?.length && !get("workspaceId"))
        sessionStorage.setItem("settle.workspaceId", p.workspaceIds[0]);
}
export function clearSession() {
    ["accessToken", "refreshToken", "workspaceId", "user", "workspace"].forEach(
        (k) => sessionStorage.removeItem(`settle.${k}`),
    );
}
export async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const s = session();
    if (s.token) headers.set("authorization", `Bearer ${s.token}`);
    if (s.workspaceId) headers.set("x-workspace-id", s.workspaceId);
    if (options.body && !(options.body instanceof FormData))
        headers.set("content-type", "application/json");
    let res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (res.status === 401 && s.refreshToken) {
        const rr = await fetch(`${API_BASE}/v1/auth/refresh`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refresh_token: s.refreshToken }),
        });
        if (rr.ok) {
            saveSession(await rr.json());
            headers.set("authorization", `Bearer ${session().token}`);
            res = await fetch(`${API_BASE}${path}`, { ...options, headers });
        } else clearSession();
    }
    const raw = await res.text();
    let data = null;
    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        data = raw;
    }
    if (!res.ok)
        throw new Error(
            data?.error?.message ||
                data?.message ||
                `Request failed (${res.status})`,
        );
    return data;
}
