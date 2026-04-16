import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  MessageSquare, Send, Search, Plus, ArrowLeft, CheckCheck, RefreshCw, X,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { apiGet, apiPost, apiPut } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { BASE } from "@/lib/base-url";

interface UserProfile { phone: string | null; avatarUrl: string | null; area: string | null; }
interface ConvUser { id: number; name: string | null; email: string; role: string; profile: UserProfile | null; }
interface Participant { id: number; userId: number; lastReadAt: string | null; user: ConvUser | null; }

interface Message {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
  isMe: boolean;
  sender: (ConvUser & { profile: UserProfile | null }) | null;
}

interface Conversation {
  id: number;
  type: string;
  name: string | null;
  updatedAt: string;
  participants: Participant[];
  lastMessage: { content: string; senderId: number; createdAt: string } | null;
  unreadCount: number;
  myParticipant: Participant | null;
}

interface Contact {
  id: number;
  name: string | null;
  email: string;
  profile: UserProfile | null;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function Avatar({
  user, size = "md",
}: {
  user: { id: number; name: string | null; email: string; profile?: UserProfile | null };
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-xs" : size === "md" ? "h-9 w-9 text-sm" : "h-11 w-11 text-base";
  const colors = ["bg-blue-500","bg-emerald-500","bg-violet-500","bg-amber-500","bg-rose-500","bg-cyan-500"];
  const color = colors[user.id % colors.length];

  if (user.profile?.avatarUrl) {
    return (
      <img
        src={user.profile.avatarUrl}
        alt={user.name ?? user.email}
        className={`${dim} rounded-full object-cover shrink-0`}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full ${color} text-white font-semibold flex items-center justify-center shrink-0`}>
      {getInitials(user.name, user.email)}
    </div>
  );
}

function getOtherParticipant(conv: Conversation, meId: number): ConvUser | null {
  const other = conv.participants.find(p => p.userId !== meId);
  return other?.user ?? null;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "ahora";
  if (diff < 3600_000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400_000) return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function NewChatDialog({ open, onClose, onStart }: {
  open: boolean;
  onClose: () => void;
  onStart: (userId: number) => void;
}) {
  const { data: me } = useCurrentUser();
  const [search, setSearch] = useState("");
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => apiGet("/api/contacts"),
    staleTime: 60_000,
    enabled: open,
  });

  const filtered = contacts.filter(c => {
    if (c.id === me?.id) return false;
    const q = search.toLowerCase();
    return (c.name?.toLowerCase().includes(q) ?? false) || c.email.toLowerCase().includes(q);
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
          <DialogDescription>Seleccioná un usuario para iniciar una conversación directa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar usuario..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">
                {search ? "Sin resultados" : "No hay otros usuarios"}
              </p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => { onStart(c.id); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left"
                >
                  <Avatar user={c} size="md" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name ?? "(Sin nombre)"}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageBubble({ msg, showSender }: { msg: Message; showSender: boolean }) {
  return (
    <div className={cn("flex items-end gap-2 group", msg.isMe ? "flex-row-reverse" : "flex-row")}>
      {!msg.isMe && (
        <div className="shrink-0 mb-1">
          {showSender && msg.sender ? (
            <Avatar user={msg.sender} size="sm" />
          ) : (
            <div className="h-7 w-7" />
          )}
        </div>
      )}
      <div className={cn("max-w-[75%] space-y-0.5", msg.isMe ? "items-end" : "items-start")}>
        {!msg.isMe && showSender && msg.sender && (
          <p className="text-xs text-muted-foreground px-1">
            {msg.sender.name ?? msg.sender.email}
          </p>
        )}
        <div
          className={cn(
            "px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap",
            msg.isMe
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm",
          )}
        >
          {msg.content}
        </div>
        <p
          className={cn(
            "text-[10px] text-muted-foreground/70 px-1",
            msg.isMe ? "text-right" : "text-left",
          )}
          title={formatFullTime(msg.createdAt)}
        >
          {formatTime(msg.createdAt)}
          {msg.isMe && <CheckCheck className="inline h-3 w-3 ml-0.5 opacity-60" />}
        </p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const initialConvId = urlParams.get("conv") ? parseInt(urlParams.get("conv")!) : null;

  const { data: me } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(initialConvId);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [mobileShowMessages, setMobileShowMessages] = useState(!!initialConvId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [], isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations"],
    queryFn: () => apiGet("/api/conversations"),
    refetchInterval: 3000,
    staleTime: 0,
  });

  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["messages", selectedId],
    queryFn: () => selectedId ? apiGet(`/api/conversations/${selectedId}/messages`) : Promise.resolve([]),
    enabled: !!selectedId,
    refetchInterval: 3000,
    staleTime: 0,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiPut(`/api/conversations/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const sendMsg = useMutation({
    mutationFn: (content: string) =>
      apiPost<Message>(`/api/conversations/${selectedId}/messages`, { content }),
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const startConversation = useMutation({
    mutationFn: (targetUserId: number) =>
      fetch(`${BASE}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      }).then(r => {
        if (!r.ok) throw new Error("Error al crear conversación");
        return r.json() as Promise<Conversation>;
      }),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedId(conv.id);
      setMobileShowMessages(true);
      inputRef.current?.focus();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (selectedId) {
      markRead.mutate(selectedId);
    }
  }, [selectedId, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectConv = (id: number) => {
    setSelectedId(id);
    setMobileShowMessages(true);
    markRead.mutate(id);
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || sendMsg.isPending || !selectedId) return;
    sendMsg.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;
  const otherUser = selectedConv && me ? getOtherParticipant(selectedConv, me.id) : null;

  const filteredConvs = conversations.filter(conv => {
    if (!search) return true;
    const q = search.toLowerCase();
    const other = me ? getOtherParticipant(conv, me.id) : null;
    return (
      other?.name?.toLowerCase().includes(q) ||
      other?.email.toLowerCase().includes(q) ||
      conv.lastMessage?.content.toLowerCase().includes(q)
    );
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <div
        className={cn(
          "flex flex-col border-r bg-background transition-all duration-200",
          "w-full md:w-80 lg:w-96 shrink-0",
          mobileShowMessages ? "hidden md:flex" : "flex",
        )}
      >
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              Conversaciones
              {totalUnread > 0 && (
                <Badge className="h-5 min-w-5 text-[10px] px-1 bg-primary">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </Badge>
              )}
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => setShowNew(true)}
              title="Nueva conversación"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar conversaciones..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="p-3 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 items-center p-2">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
              <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {search ? "Sin resultados" : "No hay conversaciones"}
              </p>
              {!search && (
                <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Nueva conversación
                </Button>
              )}
            </div>
          ) : (
            filteredConvs.map(conv => {
              const other = me ? getOtherParticipant(conv, me.id) : null;
              const isSelected = selectedId === conv.id;
              const hasUnread = (conv.unreadCount ?? 0) > 0;

              return (
                <button
                  key={conv.id}
                  onClick={() => selectConv(conv.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 transition-colors text-left border-b border-border/40",
                    isSelected
                      ? "bg-primary/8 dark:bg-primary/10"
                      : "hover:bg-muted/50",
                  )}
                >
                  <div className="relative">
                    {other ? (
                      <Avatar user={other} size="md" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    {hasUnread && (
                      <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-[8px] text-primary-foreground font-bold">
                          {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("text-sm truncate", hasUnread ? "font-semibold" : "font-medium")}>
                        {other?.name ?? other?.email ?? "Conversación"}
                      </span>
                      {conv.lastMessage && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatTime(conv.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "text-xs truncate mt-0.5",
                      hasUnread ? "text-foreground font-medium" : "text-muted-foreground",
                    )}>
                      {conv.lastMessage
                        ? (conv.lastMessage.senderId === me?.id ? "Tú: " : "") + conv.lastMessage.content
                        : "Sin mensajes aún"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 min-w-0",
          !mobileShowMessages ? "hidden md:flex" : "flex",
        )}
      >
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center p-6">
            <MessageSquare className="h-16 w-16 text-muted-foreground/20" />
            <div>
              <h3 className="font-semibold text-lg">Chat interno</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Seleccioná una conversación o iniciá una nueva
              </p>
            </div>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva conversación
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
              <button
                className="md:hidden p-1 rounded hover:bg-muted"
                onClick={() => { setMobileShowMessages(false); setSelectedId(null); }}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              {otherUser && (
                <>
                  <Avatar user={otherUser} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {otherUser.name ?? otherUser.email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{otherUser.email}</p>
                  </div>
                </>
              )}
              {!otherUser && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium text-sm">Conversación #{selectedId}</span>
                </div>
              )}
              <button
                className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
                onClick={() => qc.invalidateQueries({ queryKey: ["messages", selectedId] })}
                title="Actualizar"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {msgsLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className={cn("flex gap-2", i % 2 === 0 ? "" : "flex-row-reverse")}>
                      <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                      <Skeleton className={cn("h-12 rounded-2xl", i % 2 === 0 ? "w-48" : "w-36")} />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">
                    No hay mensajes aún. Escribí uno para empezar.
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const prev = idx > 0 ? messages[idx - 1] : null;
                  const showSender = !prev || prev.senderId !== msg.senderId;
                  return <MessageBubble key={msg.id} msg={msg} showSender={showSender} />;
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="px-4 py-3 border-t bg-background/95 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  placeholder="Escribí un mensaje..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sendMsg.isPending}
                  className="flex-1"
                  maxLength={5000}
                  autoComplete="off"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!message.trim() || sendMsg.isPending}
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1 px-1">
                Enter para enviar
              </p>
            </div>
          </>
        )}
      </div>

      <NewChatDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onStart={(userId) => startConversation.mutate(userId)}
      />
    </div>
  );
}
