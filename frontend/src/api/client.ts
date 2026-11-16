export const API_URL = import.meta.env.VITE_API_URL || `${import.meta.env.BASE_URL}api`; // BASE_URL = Vite `base`, e.g. "/qcr/"
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'; // opt-in: in-browser mock, no backend

export const AUTH_STORAGE_KEY = 'qcr.auth';
/** Backend sends a renewed token here while the user is active (8h idle timeout). */
const RENEW_HEADER = 'X-Session-Token';

/**
 * Session lives in sessionStorage → closing the tab/window logs out; each tab signs in on its own.
 * Old persistent login (localStorage) dropped once.
 */
export const authStore = {
  get: () => sessionStorage.getItem(AUTH_STORAGE_KEY),
  set: (v: string) => sessionStorage.setItem(AUTH_STORAGE_KEY, v),
  clear: () => sessionStorage.removeItem(AUTH_STORAGE_KEY),
};
try {
  localStorage.removeItem(AUTH_STORAGE_KEY);
} catch {
  /* storage blocked */
}
export const UNAUTHORIZED_EVENT = 'qcr:unauthorized';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  try {
    const raw = authStore.get();
    return raw ? (JSON.parse(raw).token as string) : null;
  } catch {
    return null;
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const renewed = res.headers.get(RENEW_HEADER);
  if (renewed && token) {
    try {
      const raw = authStore.get();
      if (raw) authStore.set(JSON.stringify({ ...JSON.parse(raw), token: renewed }));
    } catch {
      /* keep old token until it expires */
    }
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(message, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
