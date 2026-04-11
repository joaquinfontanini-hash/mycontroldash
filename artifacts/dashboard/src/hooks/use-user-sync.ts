import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function useUserSync() {
  const { user, isSignedIn, isLoaded } = useUser();
  const qc = useQueryClient();
  const syncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (syncedRef.current === user.id) return;

    const email = user.primaryEmailAddress?.emailAddress ?? "";
    const name = user.fullName ?? null;

    syncedRef.current = user.id;

    fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerkId: user.id, email, name }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(() => {
        qc.invalidateQueries({ queryKey: ["current-user"] });
      })
      .catch(() => {
        syncedRef.current = null;
      });
  }, [isLoaded, isSignedIn, user, qc]);
}
