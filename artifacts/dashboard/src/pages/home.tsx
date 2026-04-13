import { Show } from "@clerk/react";
import { Redirect, Link } from "wouter";
import {
  LayoutDashboard,
  CheckSquare,
  Newspaper,
  Briefcase,
  Plane,
  CloudSun,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  { icon: Briefcase, label: "Monitor Fiscal", desc: "AFIP, Rentas Neuquén y normativas en tiempo real" },
  { icon: CheckSquare, label: "Gestión de Tareas", desc: "Pendientes, prioridades y vencimientos claros" },
  { icon: Newspaper, label: "Noticias del Sector", desc: "Infobae, Ámbito, La Nación y fuentes provinciales" },
  { icon: CloudSun, label: "Clima Neuquén", desc: "Pronóstico extendido actualizado cada día" },
  { icon: Plane, label: "Ofertas de Viaje", desc: "Beneficios y tarifas corporativas disponibles" },
  { icon: LayoutDashboard, label: "Resumen Ejecutivo", desc: "Vista única de toda tu actividad diaria" },
];

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <div className="min-h-[100dvh] w-full bg-[#0c1220] text-white flex flex-col">
          <header className="flex items-center justify-between px-8 py-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-[#0c1220]" />
              </div>
              <span className="font-serif text-lg font-semibold tracking-tight">Executive</span>
            </div>
            <Link
              href="/sign-in"
              className="text-sm text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
            >
              Iniciar sesión <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </header>

          <main className="flex-1 flex flex-col items-center justify-center px-4 py-20">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 mb-8">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs text-amber-400 font-medium tracking-wide uppercase">
                Panel Privado — Uso Profesional
              </span>
            </div>

            <h1 className="text-center text-5xl md:text-6xl font-serif font-bold tracking-tight leading-tight mb-6 max-w-3xl">
              Tu centro de control{" "}
              <span className="text-amber-400">ejecutivo</span>
            </h1>

            <p className="text-center text-white/60 text-lg max-w-xl mb-10 leading-relaxed">
              Dashboard personal para profesionales argentinos. Fiscal, tareas, clima de Neuquén,
              noticias clave y viajes — todo en un solo lugar seguro.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-[#0c1220] font-semibold px-8 py-3.5 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 hover:-translate-y-0.5 text-sm"
              >
                Ingresar al Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 border border-white/20 hover:border-amber-500/40 text-white/70 hover:text-amber-400 px-6 py-3.5 rounded-lg transition-all duration-200 text-sm"
              >
                Solicitar acceso
              </Link>
            </div>

            <div className="mt-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl w-full px-4">
              {FEATURES.map(({ icon: Icon, label, desc }) => (
                <div
                  key={label}
                  className="rounded-xl border border-white/10 bg-white/5 p-5 hover:border-amber-500/30 hover:bg-white/8 transition-all duration-200"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center mb-3">
                    <Icon className="h-4.5 w-4.5 text-amber-400" />
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{label}</h3>
                  <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </main>

          <footer className="text-center py-6 text-white/30 text-xs border-t border-white/10">
            Dashboard Web Personal — Privado y seguro
          </footer>
        </div>
      </Show>
    </>
  );
}
