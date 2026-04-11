import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { apiGet, apiPut, apiDelete } from "@/services/api-client";

export const USER_SETTINGS_DEFAULTS: Record<string, string> = {
  alert_due_date_days: "7",
  alert_sensitivity: "medium",
  alert_vencimientos_enabled: "true",
  alert_tareas_enabled: "true",
  alert_finanzas_enabled: "true",
  alert_estrategia_enabled: "true",
  modo_hoy_show_scores: "true",
  modo_hoy_max_actions: "3",
  decisions_show_rules: "true",
  sidebar_compact: "false",
};

type SettingsMap = Record<string, string>;

export function useUserSettings() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();

  const { data: settings = USER_SETTINGS_DEFAULTS, isLoading } = useQuery<SettingsMap>({
    queryKey: ["user-settings"],
    queryFn: () => apiGet<SettingsMap>("/api/user-settings"),
    staleTime: 120_000,
    enabled: !!isSignedIn,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiPut<{ key: string; value: string }>(`/api/user-settings/${encodeURIComponent(key)}`, { value }),
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: ["user-settings"] });
      const prev = qc.getQueryData<SettingsMap>(["user-settings"]);
      qc.setQueryData<SettingsMap>(["user-settings"], old => ({ ...(old ?? USER_SETTINGS_DEFAULTS), [key]: value }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["user-settings"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["user-settings"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => apiDelete(`/api/user-settings/${encodeURIComponent(key)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-settings"] }),
  });

  function get(key: string): string {
    return settings[key] ?? USER_SETTINGS_DEFAULTS[key] ?? "";
  }

  function getBool(key: string): boolean {
    const v = get(key);
    return v !== "false" && v !== "0" && v !== "";
  }

  function getInt(key: string, fallback = 0): number {
    const v = parseInt(get(key), 10);
    return isNaN(v) ? fallback : v;
  }

  function set(key: string, value: string) {
    updateMutation.mutate({ key, value });
  }

  function setBool(key: string, value: boolean) {
    set(key, value ? "true" : "false");
  }

  function setInt(key: string, value: number) {
    set(key, String(value));
  }

  function reset(key: string) {
    deleteMutation.mutate(key);
  }

  return {
    settings,
    isLoading,
    get, getBool, getInt,
    set, setBool, setInt,
    reset,
    isSaving: updateMutation.isPending,
  };
}
