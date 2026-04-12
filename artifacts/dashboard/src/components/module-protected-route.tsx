import { ReactNode, useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCAL_AUTH_MODE, getLocalSession } from "@/lib/local-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const RETRY_DELAY = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);
const GUARD_TIMEOUT_MS = 12_000;

interface ModuleData {
  key: string;
  isActive: boolean;
  allowedRoles: string[];
}

function useModules() {
  return useQuery<ModuleData[]>({
    queryKey: ["modules"],
    queryFn: () => fetch(`${BASE}/api/modules`).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    retry: 2,
    retryDelay: RETRY_DELAY,
  });
}

function Spinner() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] text-center gap-3 p-8">
      <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="h-5 w-5 text-destructive/70" />
      </div>
      <h2 className="text-lg font-semibold">No se pudo cargar tu sesión</h2>
      <p className="text-muted-foreground text-sm max-w-xs">
        Hubo un problema al conectar con el servidor. Verificá tu conexión e intentá de nuevo.
      </p>
      <Button size="sm" variant="outline" onClick={onRetry} className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" />
        Reintentar
      </Button>
    </div>
  );
}

function AccessDenied({ title, message }: { title: string; message: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] text-center gap-3 p-8">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-xl font-bold text-muted-foreground">
        ⊘
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm max-w-xs">{message}</p>
    </div>
  );
}

function ModuleGuard({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  const {
    data: me,
    isLoading: meLoading,
    isError: meError,
    refetch: refetchMe,
  } = useCurrentUser();
  const { data: modules, isLoading: modulesLoading } = useModules();
  const [timedOut, setTimedOut] = useState(false);

  const isLoading = meLoading || modulesLoading;

  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), GUARD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading && !timedOut) return <Spinner />;

  if (timedOut || meError || (!meLoading && !me)) {
    return (
      <LoadError
        onRetry={() => {
          setTimedOut(false);
          refetchMe();
        }}
      />
    );
  }

  if (!me) return <Spinner />;

  if (me.isBlocked) {
    return (
      <AccessDenied
        title="Cuenta bloqueada"
        message={
          <>
            Tu cuenta fue bloqueada. Contactá al administrador.
            {me.blockedReason && <span className="block mt-1 font-medium">{me.blockedReason}</span>}
          </>
        }
      />
    );
  }

  if (modules && modules.length > 0) {
    const mod = modules.find(m => m.key === moduleKey);
    if (mod) {
      if (!mod.isActive) {
        return (
          <AccessDenied
            title="Módulo desactivado"
            message="Este módulo está desactivado. Contactá al administrador."
          />
        );
      }
      if (!mod.allowedRoles.includes(me.role)) {
        return (
          <AccessDenied
            title="Sin acceso"
            message={<>Tu rol (<span className="font-medium">{me.role}</span>) no tiene permiso para este módulo.</>}
          />
        );
      }
    }
  }

  return <>{children}</>;
}

// ── Local auth version: checks localStorage, no API calls ──────────────────────

function ProtectedRouteLocal({
  component: Component,
}: {
  component: React.ComponentType;
  moduleKey?: string;
}) {
  const session = getLocalSession();
  if (!session) return <Redirect to="/sign-in" />;
  return <Component />;
}

// ── Clerk+Session version: validates backend session + module guards ────────────

function ProtectedRouteClerk({
  component: Component,
  moduleKey,
}: {
  component: React.ComponentType;
  moduleKey?: string;
}) {
  const { data: me, isLoading, isError } = useCurrentUser();

  if (isLoading) return <Spinner />;

  if (isError || !me) return <Redirect to="/sign-in" />;

  if (moduleKey) {
    return (
      <ModuleGuard moduleKey={moduleKey}>
        <Component />
      </ModuleGuard>
    );
  }

  return <Component />;
}

export const ProtectedRoute: React.FC<{
  component: React.ComponentType;
  moduleKey?: string;
}> = LOCAL_AUTH_MODE ? ProtectedRouteLocal : ProtectedRouteClerk;
