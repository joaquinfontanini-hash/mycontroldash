import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type TokenState = "loading" | "valid" | "invalid" | "expired" | "used";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

function PasswordStrengthBar({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
    password.length >= 12,
  ];
  const score = checks.filter(Boolean).length;
  const colors = ["", "bg-red-500", "bg-orange-500", "bg-amber-400", "bg-lime-500", "bg-green-500"];
  const labels = ["", "Muy débil", "Débil", "Regular", "Buena", "Excelente"];

  if (!password) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= score ? colors[score] : "bg-muted"}`}
          />
        ))}
      </div>
      {score > 0 && (
        <p className={`text-xs ${score <= 2 ? "text-red-600" : score <= 3 ? "text-amber-600" : "text-green-600"}`}>
          Seguridad: {labels[score]}
        </p>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const token = getToken();

  const [tokenState, setTokenState]   = useState<TokenState>("loading");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [showConf, setShowConf]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [done, setDone]               = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (!token) { setTokenState("invalid"); return; }

    fetch(`${BASE}/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok || !data.valid) {
          const msg = data.error ?? "";
          if (msg.includes("expiró"))   setTokenState("expired");
          else if (msg.includes("ya fue utilizado")) setTokenState("used");
          else setTokenState("invalid");
        } else {
          setTokenState("valid");
        }
      })
      .catch(() => setTokenState("invalid"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (!/[A-Z]/.test(password) && !/[0-9]/.test(password)) {
      setError("La contraseña debe incluir al menos un número o una mayúscula");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await r.json();

      if (!r.ok || !data.ok) {
        setError(data.error ?? "Error al restablecer la contraseña");
        if (data.error?.includes("expiró")) setTokenState("expired");
        if (data.error?.includes("utilizado")) setTokenState("used");
        return;
      }

      setDone(true);
      // Redirect to sign-in after 3 seconds
      setTimeout(() => setLocation("/sign-in"), 3000);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  // ── Token invalid/expired states ───────────────────────────────────────────
  if (tokenState === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tokenState !== "valid" && !done) {
    const messages = {
      invalid:  { title: "Enlace inválido", body: "Este enlace no existe o fue manipulado.", canRetry: true },
      expired:  { title: "Enlace expirado",  body: "Este enlace venció. Los enlaces son válidos por 30 minutos.",   canRetry: true },
      used:     { title: "Enlace ya usado",  body: "Este enlace ya fue utilizado. Si necesitás restablecer tu contraseña, solicitá uno nuevo.",  canRetry: true },
    };
    const msg = messages[tokenState];
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm text-center">
          <div className="rounded-full bg-destructive/10 p-3 w-fit mx-auto">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{msg.title}</h1>
            <p className="text-sm text-muted-foreground mt-2">{msg.body}</p>
          </div>
          {msg.canRetry && (
            <Link href="/forgot-password">
              <Button className="w-full">Solicitar nuevo enlace</Button>
            </Link>
          )}
          <Link href="/sign-in" className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm text-center">
          <div className="rounded-full bg-green-100 dark:bg-green-950/30 p-3 w-fit mx-auto">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">¡Contraseña restablecida!</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Tu contraseña fue actualizada correctamente. Serás redirigido al inicio de sesión...
            </p>
          </div>
          <Link href="/sign-in">
            <Button className="w-full">Ir al inicio de sesión</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">

        <div className="space-y-1 text-center">
          <div className="flex items-center justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Lock className="h-6 w-6 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Elegí una contraseña segura para tu cuenta.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPass ? "text" : "password"}
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                disabled={loading}
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <PasswordStrengthBar password={password} />
            <p className="text-xs text-muted-foreground">
              Mínimo 8 caracteres con al menos un número o mayúscula.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmá la contraseña</Label>
            <div className="relative">
              <Input
                id="confirm"
                type={showConf ? "text" : "password"}
                placeholder="Repetí la contraseña"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                disabled={loading}
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConf(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirm && password !== confirm && (
              <p className="text-xs text-destructive">Las contraseñas no coinciden</p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !password || !confirm || password !== confirm}
          >
            {loading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando...</>
              : <><Lock className="mr-2 h-4 w-4" />Establecer nueva contraseña</>
            }
          </Button>
        </form>

        <div className="text-center">
          <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
