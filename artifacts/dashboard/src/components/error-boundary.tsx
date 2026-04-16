import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Component crashed:", error?.message ?? String(error));
    console.error("[ErrorBoundary] Stack:", error?.stack);
    console.error("[ErrorBoundary] Component tree:", info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[280px] p-8 text-center rounded-xl border border-destructive/20 bg-destructive/5">
          <AlertTriangle className="h-8 w-8 text-destructive/70 mb-3" />
          <h3 className="text-base font-semibold mb-1">
            {this.props.label ?? "Este módulo no pudo cargar"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-xs">
            Ocurrió un error inesperado. Podés intentar recargar.
          </p>
          <Button size="sm" variant="outline" onClick={this.reset}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reintentar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
