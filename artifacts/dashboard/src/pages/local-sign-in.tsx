import { useState, FormEvent } from "react";
import { Redirect } from "wouter";
import { Briefcase, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkPassword,
  setLocalSession,
  getLocalSession,
} from "@/lib/local-auth";

export default function LocalSignInPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  if (getLocalSession()) {
    return <Redirect to="/dashboard" />;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    setTimeout(() => {
      if (checkPassword(password)) {
        setLocalSession();
        window.location.replace("#/dashboard");
        window.location.href = "/dashboard";
      } else {
        setError("Contraseña incorrecta. Intentá de nuevo.");
      }
      setLoading(false);
    }, 400);
  }

  return (
    <div className="min-h-[100dvh] w-full bg-[#0c1220] text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center">
            <Briefcase className="h-5 w-5 text-[#0c1220]" />
          </div>
          <span className="font-serif text-xl font-semibold tracking-tight">
            Executive
          </span>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold mb-1">Acceder al panel</h1>
            <p className="text-sm text-white/50">
              Ingresá tu contraseña para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-sm font-medium text-white/80"
              >
                Contraseña
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  autoFocus
                  disabled={loading}
                  className="pl-9 pr-10 bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-500/60 focus:ring-amber-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-amber-500 hover:bg-amber-400 text-[#0c1220] font-semibold h-10"
            >
              {loading ? "Verificando..." : "Ingresar"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-white/25 mt-6">
          Panel privado — Uso profesional
        </p>
      </div>
    </div>
  );
}
