const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const url = `${BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
  };
  const res = await fetch(url, options);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg = (body as any)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, data?: unknown): Promise<T> {
  return request<T>("POST", path, data);
}

export function apiPut<T>(path: string, data?: unknown): Promise<T> {
  return request<T>("PUT", path, data);
}

export function apiPatch<T>(path: string, data?: unknown): Promise<T> {
  return request<T>("PATCH", path, data);
}

export function apiDelete(path: string): Promise<void> {
  return request<void>("DELETE", path);
}
