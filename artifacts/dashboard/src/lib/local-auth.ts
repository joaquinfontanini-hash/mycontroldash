export const LOCAL_AUTH_MODE = import.meta.env.VITE_LOCAL_AUTH_MODE === "true";

const SESSION_KEY = "exec_local_session";

export const LOCAL_NAME = import.meta.env.VITE_LOCAL_NAME ?? "Administrador";
export const LOCAL_EMAIL = import.meta.env.VITE_LOCAL_EMAIL ?? "admin@dashboard.local";
const LOCAL_PASSWORD = import.meta.env.VITE_LOCAL_PASSWORD ?? "admin123";

export interface LocalSession {
  name: string;
  email: string;
  role: "super_admin";
  loggedInAt: number;
}

export function getLocalSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalSession;
  } catch {
    return null;
  }
}

export function setLocalSession(opts?: { name?: string; email?: string }): void {
  const session: LocalSession = {
    name: opts?.name ?? LOCAL_NAME,
    email: opts?.email ?? LOCAL_EMAIL,
    role: "super_admin",
    loggedInAt: Date.now(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function saveLocalSession(opts: { name?: string; email?: string }): void {
  setLocalSession(opts);
}

export function clearLocalSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function checkPassword(password: string): boolean {
  return password === LOCAL_PASSWORD;
}

export function verifyLocalPassword(password: string): boolean {
  return checkPassword(password);
}
