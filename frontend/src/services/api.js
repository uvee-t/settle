// Settle API client. Contract is unchanged from the previous frontend:
// bearer token + x-workspace-id header, refresh via POST /v1/auth/refresh.
const API_BASE = (import.meta.env.VITE_SETTLE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const get = (k) => sessionStorage.getItem(`settle.${k}`) || '';

export function session() {
  let user = null;
  let workspace = null;
  try {
    user = JSON.parse(get('user') || 'null');
    workspace = JSON.parse(get('workspace') || 'null');
  } catch {
    /* corrupted storage is treated as signed out data */
  }
  return {
    token: get('accessToken'),
    refreshToken: get('refreshToken'),
    workspaceId: get('workspaceId'),
    user,
    workspace,
  };
}

export function saveSession(p) {
  sessionStorage.setItem('settle.accessToken', p.accessToken || p.access_token || '');
  sessionStorage.setItem('settle.refreshToken', p.refreshToken || p.refresh_token || '');
  if (p.user) sessionStorage.setItem('settle.user', JSON.stringify(p.user));
  if (p.workspace) {
    sessionStorage.setItem('settle.workspace', JSON.stringify(p.workspace));
    sessionStorage.setItem('settle.workspaceId', p.workspace.id || '');
  } else if (p.workspaceIds?.length && !get('workspaceId')) {
    sessionStorage.setItem('settle.workspaceId', p.workspaceIds[0]);
  }
}

export function clearSession() {
  ['accessToken', 'refreshToken', 'workspaceId', 'user', 'workspace'].forEach((k) => sessionStorage.removeItem(`settle.${k}`));
}

export const isSignedIn = () => Boolean(session().token && session().workspaceId);

/** Keeps the cached workspace name in step with edits made in Settings. */
export function updateWorkspaceCache(patch) {
  const w = session().workspace;
  if (w) sessionStorage.setItem('settle.workspace', JSON.stringify({ ...w, ...patch }));
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// One refresh at a time. Parallel requests that all hit a 401 would otherwise each
// spend the same refresh token, which breaks rotating refresh tokens and logs the user out.
let refreshing = null;
function refreshSession(refreshToken) {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (rr) => {
        if (!rr.ok) return false;
        saveSession(await rr.json());
        return true;
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
    const s = session();
    if (s.token) headers.set('authorization', `Bearer ${s.token}`);
    if (s.workspaceId) headers.set('x-workspace-id', s.workspaceId);
    if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
    return { ...options, headers };
  };

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, build());
  } catch {
    throw new ApiError('Cannot reach the Settle API. Check your connection and try again.', 0);
  }

  const hadSession = Boolean(session().token);
  if (res.status === 401 && session().refreshToken) {
    if (await refreshSession(session().refreshToken)) {
      res = await fetch(`${API_BASE}${path}`, build());
    } else {
      clearSession();
    }
  }
  if (res.status === 401 && hadSession && !path.startsWith('/v1/auth/')) {
    clearSession();
    window.dispatchEvent(new Event('settle-auth-expired'));
  }

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!res.ok) {
    throw new ApiError(data?.error?.message || data?.message || `Request failed (${res.status})`, res.status, data?.error?.code);
  }
  return data;
}
