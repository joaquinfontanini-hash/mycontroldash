import { ReactNode, useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser, isUnauthenticatedError } from "@/hooks/use-current-user";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCAL_AUTH_MODE, getLocalSession } from "@/lib/local-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Constants ─────────────────────────────────────────────────────────────────

const RETRY_DELAY = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);

// After GUARD_TIMEOUT_MS of loading, show an error with retry instead of
// spinning forever. This catches stuck network requests.
const GUARD_TIMEOUT_MS = 12_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModuleData {
  key: string;
  isActive: boolean;
  allowedRoles: string[];
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

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

// ── Modules query (used inside ModuleGuard) ───────────────────────────────────

function useModules() {
  return useQuery<ModuleData[]>({
    queryKey: ["modules"],
    queryFn: () =>
      fetch(`${BASE}/api/modules`, { credentials: "include" })
        .then(r => (r.ok ? r.json() : [])),
    staleTime: 60_000,
    retry: 2,
    retryDelay: RETRY_DELAY,
  });
}

// ── ModuleGuard ───────────────────────────────────────────────────────────────
// Checks that the user has access to the specific module key.
// Only runs after ProtectedRoute has already confirmed the session is valid.

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

// ── LOCAL AUTH version ────────────────────────────────────────────────────────
// Checks localStorage session synchronously, then applies ModuleGuard.

function ProtectedRouteLocal({
  component: Component,
  moduleKey,
}: {
  component: React.ComponentType;
  moduleKey?: string;
}) {
  const session = getLocalSession();
  if (!session) return <Redirect to="/sign-in" />;

  if (moduleKey) {
    return (
      <ModuleGuard moduleKey={moduleKey}>
        <Component />
      </ModuleGuard>
    );
  }

  return <Component />;
}

// ── CLERK + EXPRESS SESSION version ──────────────────────────────────────────
//
// IMPORTANT — unified session logic:
//
//   The global session is stored in PostgreSQL (table: "session", managed by
//   connect-pg-simple) and is carried by the HTTP-only cookie "connect.sid".
//
//   Validation route: GET /api/users/me with credentials: "include".
//   The backend reads req.session.userId and returns the user row.
//
//   Protection layers:
//     1. ProtectedRouteClerk (this component) — verifies the session is valid.
//     2. ModuleGuard — verifies the user has permission for the specific module.
//     3. requireAuth middleware — enforces auth on every API endpoint.
//
//   Redirect policy:
//     • HTTP 401  → session does not exist or expired → redirect to /sign-in.
//     • Other errors (network, 5xx) → show retry button, DO NOT redirect.
//       Redirecting on transient errors is the root cause of spurious re-logins.
//     • No data, no error, not loading → treat the same as 401 (no session).

function ProtectedRouteClerk({
  component: Component,
  moduleKey,
}: {
  component: React.ComponentType;
  moduleKey?: string;
}) {
  const {
    data: me,
    isLoading,
    isError,
    error,
    refetch,
  } = useCurrentUser();

  // Still fetching the session — show a spinner, never redirect prematurely.
  if (isLoading) return <Spinner />;

  if (isError) {
    // Only a real "not authenticated" response (HTTP 401) warrants a redirect.
    // Network failures, 500s, etc. should NOT log the user out — they would be
    // sent to /sign-in and forced to re-enter credentials even though their
    // session is perfectly valid.
    if (isUnauthenticatedError(error)) return <Redirect to="/sign-in" />;
    // For all other errors: show a retry UI so the user can reconnect.
    return <LoadError onRetry={() => refetch()} />;
  }

  // Explicit absence of a session (query succeeded, no user returned) — only
  // happens if /api/users/me returns 200 with null/undefined, which shouldn't
  // occur but we guard it anyway.
  if (!me) return <Redirect to="/sign-in" />;

  // The user needs to set a new password before accessing any module.
  if (me.mustChangePassword) return <Redirect to="/change-password" />;

  if (moduleKey) {
    return (
      <ModuleGuard moduleKey={moduleKey}>
        <Component />
      </ModuleGuard>
    );
  }

  return <Component />;
}

// ── Public export ─────────────────────────────────────────────────────────────

export const ProtectedRoute: React.FC<{
  component: React.ComponentType;
  moduleKey?: string;
}> = LOCAL_AUTH_MODE ? ProtectedRouteLocal : ProtectedRouteClerk;
