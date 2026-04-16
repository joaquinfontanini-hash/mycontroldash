import { useEffect, useRef } from "react";
import { useUser, useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { LOCAL_AUTH_MODE } from "@/lib/local-auth";

import { BASE } from "@/lib/base-url";

const MAX_ATTEMPTS = 4;

function backoffMs(attempt: number) {
  return Math.min(500 * 2 ** attempt, 8000);
}

async function registerUser(
  clerkId: string,
  email: string,
  name: string | null,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffMs(attempt)));
    try {
      const r = await fetch(`${BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clerkId, email, name }),
      });
      if (r.ok || r.status === 409) return;
      console.warn(`[useUserSync] registerUser: HTTP ${r.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.warn(`[useUserSync] registerUser: network error (attempt ${attempt + 1})`, err);
      if (attempt === MAX_ATTEMPTS - 1) throw new Error("register failed after retries");
    }
  }
}

async function establishGoogleSession(getToken: () => Promise<string | null>): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffMs(attempt)));
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch(`${BASE}/api/auth/google-session`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (r.ok) return;
      console.warn(`[useUserSync] google-session: HTTP ${r.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.warn(`[useUserSync] google-session: network error (attempt ${attempt + 1})`, err);
      if (attempt === MAX_ATTEMPTS - 1) throw new Error("session sync failed after retries");
    }
  }
}

function useUserSyncClerk() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const syncedRef = useRef<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;
    return () => { abortRef.current = true; };
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (syncedRef.current === user.id) return;

    const email = user.primaryEmailAddress?.emailAddress ?? "";
    const name = user.fullName ?? null;

    registerUser(user.id, email, name)
      .then(() => establishGoogleSession(getToken))
      .then(() => {
        if (!abortRef.current) {
          syncedRef.current = user.id;
          qc.invalidateQueries({ queryKey: ["current-user"] });
        }
      })
      .catch((err) => {
        console.error("[useUserSync] sync failed, invalidating to retry auth flow", err);
        if (!abortRef.current) {
          qc.invalidateQueries({ queryKey: ["current-user"] });
        }
      });
  }, [isLoaded, isSignedIn, user, qc, getToken]);
}

function useUserSyncLocal() {
  // No-op in local mode: session is managed by local-auth
}

export const useUserSync: () => void = LOCAL_AUTH_MODE
  ? useUserSyncLocal
  : useUserSyncClerk;
