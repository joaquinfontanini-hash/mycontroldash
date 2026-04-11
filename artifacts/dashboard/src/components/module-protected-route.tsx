import { ReactNode } from "react";
import { Redirect } from "wouter";
import { useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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
  });
}

function Spinner() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const { data: modules, isLoading: modulesLoading } = useModules();

  if (meLoading || modulesLoading) return <Spinner />;

  if (!me) {
    return <Spinner />;
  }

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

export function ProtectedRoute({
  component: Component,
  moduleKey,
}: {
  component: React.ComponentType;
  moduleKey?: string;
}) {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) return <Spinner />;

  if (!isSignedIn) return <Redirect to="/" />;

  if (moduleKey) {
    return (
      <ModuleGuard moduleKey={moduleKey}>
        <Component />
      </ModuleGuard>
    );
  }

  return <Component />;
}
