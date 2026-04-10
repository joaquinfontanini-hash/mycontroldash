import { useState } from "react";
import { useListNews } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Newspaper, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const CATEGORIES = [
  { value: "", label: "Todas" },
  { value: "nacionales", label: "Nacionales" },
  { value: "provinciales", label: "Neuquén / Patagonia" },
  { value: "economia", label: "Economía" },
  { value: "impuestos", label: "Impuestos" },
  { value: "negocios", label: "Negocios" },
];

const SOURCE_COLORS: Record<string, string> = {
  "AFIP": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Infobae": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  "Ambito": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "La Nacion": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "El Cronista": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "Clarín": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function getSourceColor(source: string) {
  return SOURCE_COLORS[source] ?? "bg-muted text-muted-foreground";
}

export default function NewsPage() {
  const [category, setCategory] = useState("");
  const { data: news, isLoading, error } = useListNews({ category: category || undefined });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="flex gap-2">
          {CATEGORIES.map(c => <Skeleton key={c.value} className="h-8 w-24 rounded-full" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive p-4 rounded-lg border border-destructive/20 bg-destructive/5">Error al cargar noticias.</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Actualidad económica, fiscal y regional. {news?.length ?? 0} artículos.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border
              ${category === cat.value
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/60 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {news?.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed rounded-xl">
          <Newspaper className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin noticias</h3>
          <p className="text-muted-foreground text-sm">No hay artículos para esta categoría.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {news?.map(article => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block group">
              <Card className="h-full card-hover hover:border-primary/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${getSourceColor(article.source)}`}>
                      {article.source}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(article.date).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {article.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">{article.summary}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] capitalize">{article.category}</Badge>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
