import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Briefcase, Eye, EyeOff, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const FIELDS = [
  { id: "firstName", label: "Nombre", type: "text", placeholder: "Tu nombre", autoComplete: "given-name" },
  { id: "lastName", label: "Apellido", type: "text", placeholder: "Tu apellido", autoComplete: "family-name" },
  { id: "email", label: "Email", type: "email", placeholder: "tu@email.com", autoComplete: "email" },
];

export default function RegisterPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "",
    password: "", confirmPassword: "", note: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "El nombre es requerido.";
    if (!form.lastName.trim()) return "El apellido es requerido.";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Ingresá un email válido.";
    if (form.password.length < 6) return "La contraseña debe tener al menos 6 caracteres.";
    if (form.password !== form.confirmPassword) return "Las contraseñas no coinciden.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/registration-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          note: form.note.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "No se pudo enviar la solicitud. Intentá de nuevo.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Error de conexión. Verificá tu conexión e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-sm p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold">Solicitud enviada</h1>
          <p className="text-sm text-muted-foreground">
            Tu solicitud de acceso fue recibida. Un administrador la revisará y te notificará cuando sea aprobada.
          </p>
          <Link href="/sign-in">
            <Button variant="outline" className="w-full gap-2 mt-2">
              <ArrowLeft className="h-4 w-4" /> Volver al inicio de sesión
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="flex justify-center mb-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-black" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Solicitar acceso</h1>
          <p className="text-sm text-muted-foreground">
            Completá el formulario y un administrador revisará tu solicitud.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.slice(0, 2).map(field => (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  type={field.type}
                  placeholder={field.placeholder}
                  autoComplete={field.autoComplete}
                  value={form[field.id as keyof typeof form]}
                  onChange={setField(field.id)}
                  disabled={loading}
                  required
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="tu@email.com"
              autoComplete="email" value={form.email}
              onChange={setField("email")} disabled={loading} required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password" type={showPassword ? "text" : "password"}
                placeholder="Mínimo 6 caracteres" autoComplete="new-password"
                value={form.password} onChange={setField("password")}
                disabled={loading} className="pr-10" required
              />
              <button type="button" tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(v => !v)}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <div className="relative">
              <Input
                id="confirmPassword" type={showConfirm ? "text" : "password"}
                placeholder="Repetí la contraseña" autoComplete="new-password"
                value={form.confirmPassword} onChange={setField("confirmPassword")}
                disabled={loading} className="pr-10" required
              />
              <button type="button" tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirm(v => !v)}>
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">
              Motivo de la solicitud <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Textarea
              id="note" placeholder="Indicá brevemente para qué necesitás acceso..."
              value={form.note} onChange={setField("note")} disabled={loading}
              className="resize-none min-h-[80px]"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-medium"
            disabled={loading}
          >
            {loading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>
              : "Solicitar acceso"
            }
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link href="/sign-in" className="text-amber-600 hover:text-amber-500 font-medium">
              Iniciar sesión
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
