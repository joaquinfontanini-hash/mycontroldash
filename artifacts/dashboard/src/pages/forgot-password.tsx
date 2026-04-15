import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, Mail, ArrowLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function ForgotPasswordPage() {
  const [email, setEmail]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setLoading(true);

    try {
      const r = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await r.json();

      if (r.status === 429) {
        setSent(true); // rate limit — show same neutral message
        return;
      }

      if (!r.ok && !data.ok) {
        setError(data.error ?? "Ocurrió un error. Intentá de nuevo.");
        return;
      }

      setSent(true);
    } catch {
      setError("No se pudo conectar con el servidor. Revisá tu conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">

        {/* Header */}
        <div className="space-y-1 text-center">
          <div className="flex items-center justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Mail className="h-6 w-6 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Ingresá tu email y te enviamos instrucciones para crear una nueva contraseña.
          </p>
        </div>

        {/* Success state */}
        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center dark:bg-green-950/30 dark:border-green-800">
              <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                ¡Listo! Revisá tu bandeja de entrada.
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                Si el email está registrado, recibirás instrucciones en los próximos minutos.
                Revisá también tu carpeta de spam.
              </p>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              El enlace es válido por 30 minutos. Si no llegó, podés volver a intentarlo.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setSent(false); setEmail(""); }}
            >
              Enviar de nuevo
            </Button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email de tu cuenta</Label>
              <Input
                id="email"
                type="email"
                placeholder="nombre@ejemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                disabled={loading}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
              {loading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>
                : <><Mail className="mr-2 h-4 w-4" />Enviar instrucciones</>
              }
            </Button>
          </form>
        )}

        {/* Back link */}
        <div className="text-center">
          <Link href="/sign-in" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
