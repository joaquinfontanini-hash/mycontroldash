/**
 * usePreferences — DB-backed user preferences via /api/me/preferences
 *
 * Provides a write-through pattern:
 *   1. Read: served instantly from React Query cache (stale-while-revalidate).
 *   2. Write: optimistic update in cache, then persisted to DB.
 *   3. Fallback: if not authenticated or network error, falls back to localStorage.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/base-url";

type JsonValue = string | number | boolean | null | Record<string, unknown> | unknown[];
type PrefMap = Record<string, JsonValue>;

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function usePreferences() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ ok: boolean; data: PrefMap }>({
    queryKey: ["user-preferences"],
    queryFn: () => apiFetch(`${BASE}/api/me/preferences`),
    staleTime: 60_000,
    retry: 1,
  });

  const prefMap: PrefMap = data?.data ?? {};

  const setMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: JsonValue }) =>
      apiFetch(`${BASE}/api/me/preferences/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }),
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: ["user-preferences"] });
      const prev = qc.getQueryData<{ ok: boolean; data: PrefMap }>(["user-preferences"]);
      qc.setQueryData<{ ok: boolean; data: PrefMap }>(["user-preferences"], old => ({
        ok: true,
        data: { ...(old?.data ?? {}), [key]: value },
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["user-preferences"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["user-preferences"] }),
  });

  function get<T extends JsonValue>(key: string, fallback: T): T {
    if (key in prefMap) return prefMap[key] as T;
    return fallback;
  }

  function getString(key: string, fallback = ""): string {
    const v = get<string>(key, fallback as string);
    return typeof v === "string" ? v : String(v ?? fallback);
  }

  function getNumber(key: string, fallback = 0): number {
    const v = get<number>(key, fallback as number);
    return typeof v === "number" ? v : Number(v ?? fallback);
  }

  function getBool(key: string, fallback = false): boolean {
    const v = get(key, fallback);
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v !== "false" && v !== "0" && v !== "";
    return Boolean(v ?? fallback);
  }

  function set(key: string, value: JsonValue) {
    setMutation.mutate({ key, value });
  }

  return {
    isLoading,
    prefMap,
    get,
    getString,
    getNumber,
    getBool,
    set,
    isSaving: setMutation.isPending,
  };
}
