import { Show } from "@clerk/react";
import { Redirect, Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-background">
          <div className="text-center max-w-md mx-auto px-4">
            <h1 className="text-4xl font-bold text-foreground mb-4 font-serif">
              Dashboard Web Personal
            </h1>
            <p className="text-muted-foreground mb-8">
              Tu centro de control ejecutivo. Accede a tu información clave, tareas y herramientas en un solo lugar.
            </p>
            <Link href="/sign-in" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-8 py-2 w-full">
              Ingresar al Dashboard
            </Link>
          </div>
        </div>
      </Show>
    </>
  );
}
