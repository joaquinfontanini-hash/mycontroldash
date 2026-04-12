import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { LOCAL_AUTH_MODE } from "@/lib/local-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const MAX_ATTEMPTS = 3;

async function syncUser(
  clerkId: string,
  email: string,
  name: string | null,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
    try {
      const r = await fetch(`${BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkId, email, name }),
      });
      if (r.ok || r.status === 409) return;
    } catch {
      if (attempt === MAX_ATTEMPTS - 1) throw new Error("sync failed after retries");
    }
  }
}

function useUserSyncClerk() {
  const { user, isSignedIn, isLoaded } = useUser();
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

    syncUser(user.id, email, name)
      .then(() => {
        if (!abortRef.current) {
          syncedRef.current = user.id;
          qc.invalidateQueries({ queryKey: ["current-user"] });
        }
      })
      .catch(() => {
        if (!abortRef.current) {
          qc.invalidateQueries({ queryKey: ["current-user"] });
        }
      });
  }, [isLoaded, isSignedIn, user, qc]);
}

function useUserSyncLocal() {
  // No-op in local mode: session is managed by local-auth
}

export const useUserSync: () => void = LOCAL_AUTH_MODE
  ? useUserSyncLocal
  : useUserSyncClerk;
