import { useListNews } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Newspaper, ExternalLink } from "lucide-react";

export default function NewsPage() {
  const { data: news, isLoading, error } = useListNews();

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <div className="text-destructive">Error al cargar noticias.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Noticias</h1>
        <p className="text-muted-foreground mt-1">Actualidad relevante.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {news?.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <Newspaper className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No hay noticias</h3>
            <p className="text-muted-foreground">No se encontraron artículos recientes.</p>
          </div>
        ) : (
          news?.map(article => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block group">
              <Card className="h-full hover:border-primary transition-colors overflow-hidden">
                {article.imageUrl && (
                  <div className="aspect-video w-full overflow-hidden bg-muted">
                    <img src={article.imageUrl} alt={article.title} className="object-cover w-full h-full group-hover:scale-105 transition-transform" />
                  </div>
                )}
                <CardHeader>
                  <div className="text-xs font-semibold text-primary mb-1">{article.category} • {article.source}</div>
                  <CardTitle className="text-lg line-clamp-2 group-hover:text-primary transition-colors">{article.title}</CardTitle>
                  <CardDescription>{new Date(article.date).toLocaleDateString()}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3">{article.summary}</p>
                </CardContent>
              </Card>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
