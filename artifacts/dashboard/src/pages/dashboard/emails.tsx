import { useListEmails, useGetEmailStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Clock, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function EmailsPage() {
  const { data: emails, isLoading: emailsLoading, error: emailsError } = useListEmails();
  const { data: stats, isLoading: statsLoading } = useGetEmailStats();

  if (emailsLoading || statsLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (emailsError) {
    return <div className="text-destructive">Error al cargar emails.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Emails</h1>
        <p className="text-muted-foreground mt-1">Bandeja de entrada ejecutiva.</p>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Total (24h)</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.total24h}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">No leídos</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.unread}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Importantes</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.important}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {emails?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Bandeja vacía</h3>
            <p className="text-muted-foreground">No tienes correos nuevos.</p>
          </div>
        ) : (
          emails?.map(email => (
            <Card key={email.id} className={`transition-colors hover:bg-muted/50 ${!email.isRead ? 'border-l-4 border-l-primary' : ''}`}>
              <CardContent className="p-4 flex gap-4 items-start">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className={`font-medium truncate ${!email.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {email.sender} <span className="text-xs font-normal text-muted-foreground ml-2">&lt;{email.senderEmail}&gt;</span>
                    </h4>
                    <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(email.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <h5 className="font-semibold text-sm truncate">{email.subject}</h5>
                    {email.category && <Badge variant="outline" className="text-[10px] h-5">{email.category}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{email.preview}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
