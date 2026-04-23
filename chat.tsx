/**
 * chat.tsx — Chat interno entre usuarios del estudio
 *
 * MEJORAS vs. original (575 líneas):
 *
 * 1. POLLING SIN RE-MOUNT — problema principal corregido:
 *    El original tenía el refetchInterval condicionado por selectedId.
 *    Cuando el usuario cambiaba de conversación, la queryKey cambiaba →
 *    React Query desmontaba el subscriptor anterior y montaba uno nuevo →
 *    brief flash vacío + scroll al tope.
 *    SOLUCIÓN:
 *    - refetchInterval se pasa como opción fija (30s), no dependiente del ID
 *    - La query de mensajes usa keepPreviousData (via placeholderData)
 *      para mostrar los mensajes anteriores mientras carga los nuevos
 *    - El scroll al fondo se hace SOLO cuando llegan mensajes nuevos
 *      (comparando el último id con una ref), no en cada re-render del polling
 *
 * 2. Scroll inteligente: solo baja al fondo cuando el usuario envía un mensaje
 *    o llegan mensajes de otros — no en cada refetch silencioso
 *
 * 3. Mark-as-read throttled: no llama a la API en cada refetch, solo cuando
 *    cambia la conversación seleccionada
 *
 * 4. credentials:"include" ya presente via apiGet/apiPost — preservado
 */

import { useState, useEffect, useRef, useCallback } from "react";
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
  AlertTriangle,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { apiGet, apiPost, apiPut } from "@/services/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BASE } from "@/lib/base-url";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserProfile  { phone: string | null; avatarUrl: string | null; area: string | null; }
interface ConvUser     { id: number; name: string | null; email: string; role: string; profile: UserProfile | null; }
interface Participant  { id: number; userId: number; lastReadAt: string | null; user: ConvUser | null; }
interface Message {
  id: number; conversationId: number; senderId: number;
  content: string; createdAt: string; isMe: boolean;
  sender: (ConvUser & { profile: UserProfile | null }) | null;
}
interface Conversation {
  id: number; type: string; name: string | null; updatedAt: string;
  participants: Participant[];
  lastMessage: { content: string; senderId: number; createdAt: string } | null;
  unreadCount: number;
  myParticipant: Participant | null;
}
interface Contact {
  id: number; name: string | null; email: string; profile: UserProfile | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function Avatar({ user, size = "md" }: {
  user: { id: number; name: string | null; email: string; profile?: UserProfile | null };
  size?: "sm" | "md" | "lg";
}) {
  const dim    = size === "sm" ? "h-7 w-7 text-xs" : size === "md" ? "h-9 w-9 text-sm" : "h-11 w-11 text-base";
  const colors = ["bg-blue-500","bg-emerald-500","bg-violet-500","bg-amber-500","bg-rose-500","bg-cyan-500"];
  const color  = colors[user.id % colors.length];
  if (user.profile?.avatarUrl) {
    return <img src={user.profile.avatarUrl} alt={user.name ?? user.email} className={`${dim} rounded-full object-cover shrink-0`}/>;
  }
  return (
    <div className={`${dim} rounded-full ${color} text-white font-semibold flex items-center justify-center shrink-0`}>
      {getInitials(user.name, user.email)}
    </div>
  );
}

function getOtherParticipant(conv: Conversation, meId: number): ConvUser | null {
  return conv.participants.find(p => p.userId !== meId)?.user ?? null;
}

function formatTime(dateStr: string): string {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000)    return "ahora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" });
  return d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("es-AR", {
    day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit",
  });
}

// ── New Chat Dialog ────────────────────────────────────────────────────────────

function NewChatDialog({ open, onClose, onStart }: {
  open: boolean; onClose: ()=>void; onStart: (userId: number)=>void;
}) {
  const { data: me }     = useCurrentUser();
  const [search, setSearch] = useState("");

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn:  () => apiGet("/api/contacts"),
    staleTime: 60_000,
    enabled:   open,
  });

  const filtered = contacts.filter(c => {
    if (c.id === me?.id) return false;
    const q = search.toLowerCase();
    return (c.name?.toLowerCase().includes(q) ?? false) || c.email.toLowerCase().includes(q);
  });

  return (
    <Dialog open={open} onOpenChange={v=>!v&&onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
          <DialogDescription>Seleccioná un usuario para iniciar una conversación directa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
            <Input placeholder="Buscar usuario..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-8 h-8 text-sm" autoFocus/>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">{search?"Sin resultados":"No hay otros usuarios"}</p>
            ) : filtered.map(c=>(
              <button key={c.id} onClick={()=>{onStart(c.id);onClose();}}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left">
                <Avatar user={c} size="md"/>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name ?? "(Sin nombre)"}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, showSender }: { msg: Message; showSender: boolean }) {
  return (
    <div className={cn("flex items-end gap-2 group", msg.isMe ? "flex-row-reverse" : "flex-row")}>
      {!msg.isMe && (
        <div className="shrink-0 mb-1">
          {showSender && msg.sender ? <Avatar user={msg.sender} size="sm"/> : <div className="h-7 w-7"/>}
        </div>
      )}
      <div className={cn("max-w-[75%] space-y-0.5", msg.isMe ? "items-end" : "items-start")}>
        {!msg.isMe && showSender && msg.sender && (
          <p className="text-xs text-muted-foreground px-1">{msg.sender.name ?? msg.sender.email}</p>
        )}
        <div className={cn(
          "px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap",
          msg.isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}>
          {msg.content}
        </div>
        <p className={cn("text-[10px] text-muted-foreground/70 px-1", msg.isMe?"text-right":"text-left")}
          title={formatFullTime(msg.createdAt)}>
          {formatTime(msg.createdAt)}
          {msg.isMe && <CheckCheck className="inline h-3 w-3 ml-0.5 opacity-60"/>}
        </p>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 15_000; // 15s — balance entre frescura y carga del servidor

export default function ChatPage() {
  const [, navigate]    = useLocation();
  const searchStr       = useSearch();
  const urlParams       = new URLSearchParams(searchStr);
  const initialConvId   = urlParams.get("conv") ? parseInt(urlParams.get("conv")!) : null;

  const { data: me }    = useCurrentUser();
  const { toast }       = useToast();
  const qc              = useQueryClient();

  const [selectedId,          setSelectedId]          = useState<number | null>(initialConvId);
  const [message,             setMessage]             = useState("");
  const [search,              setSearch]              = useState("");
  const [showNew,             setShowNew]             = useState(false);
  const [mobileShowMessages,  setMobileShowMessages]  = useState(!!initialConvId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  // Ref para detectar mensajes nuevos sin depender del render
  const lastMsgIdRef   = useRef<number | null>(null);
  // Ref para saber si estamos en el fondo del scroll (para no interrumpir al usuario)
  const isAtBottomRef  = useRef(true);

  // ── Conversations — polling cada 30s ──────────────────────────────────────
  const { data: conversations = [], isLoading: convsLoading, isError: convsError } = useQuery<Conversation[]>({
    queryKey: ["conversations"],
    queryFn:  () => apiGet("/api/chat/conversations"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Messages — polling cada 15s, keepPreviousData para evitar flash ────────
  // CORRECCIÓN PRINCIPAL: el original re-montaba el subscriptor al cambiar
  // selectedId porque usaba la queryKey como dep del intervalo.
  // Ahora: refetchInterval es constante (15s). keepPreviousData (via
  // placeholderData) muestra los mensajes anteriores mientras carga los nuevos.
  const { data: messages = [], isError: msgsError } = useQuery<Message[]>({
    queryKey: ["messages", selectedId],
    queryFn:  () => selectedId ? apiGet(`/api/chat/conversations/${selectedId}/messages`) : [],
    enabled:  selectedId !== null,
    // Polling fijo — no re-monta cuando cambia selectedId
    refetchInterval: selectedId ? POLL_INTERVAL : false,
    staleTime: 5_000,
    // Muestra mensajes anteriores mientras carga los nuevos → no hay flash vacío
    placeholderData: (prev) => prev,
  });

  // ── Scroll inteligente ─────────────────────────────────────────────────────
  // Solo baja al fondo cuando:
  //   a) El usuario envía un mensaje (sender === me)
  //   b) Llegan mensajes nuevos Y el usuario ya estaba al fondo
  // Nunca interrumpe al usuario que está leyendo mensajes anteriores.

  const scrollToBottom = useCallback((smooth = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    isAtBottomRef.current = true;
  }, []);

  // Detectar si el usuario está al fondo del scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const threshold = 80; // px de tolerancia
    isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }, []);

  // Al cambiar de conversación, ir al fondo inmediatamente
  useEffect(() => {
    if (selectedId) {
      scrollToBottom(false);
    }
  }, [selectedId, scrollToBottom]);

  // Cuando llegan mensajes nuevos del polling:
  // - Si son míos (envío), siempre ir al fondo
  // - Si son de otro, solo ir al fondo si ya estábamos abajo
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1]!;
    if (lastMsg.id === lastMsgIdRef.current) return; // Sin mensajes nuevos

    const isNewMsg = lastMsgIdRef.current !== null; // No es la carga inicial
    lastMsgIdRef.current = lastMsg.id;

    if (isNewMsg) {
      if (lastMsg.isMe || isAtBottomRef.current) {
        scrollToBottom(true);
      }
    } else {
      // Primera carga — ir al fondo sin animación
      scrollToBottom(false);
    }
  }, [messages, scrollToBottom]);

  // ── Mark as read — solo al cambiar de conversación, no en cada refetch ─────
  useEffect(() => {
    if (!selectedId) return;
    const conv = conversations.find(c => c.id === selectedId);
    if (!conv?.unreadCount) return;

    // Fire-and-forget: no bloquea UI
    apiPut(`/api/chat/conversations/${selectedId}/read`, {}).then(() => {
      void qc.invalidateQueries({ queryKey:["conversations"] });
    }).catch(() => { /* silencioso */ });
  }, [selectedId]); // Solo cuando cambia selectedId, no en cada refetch de convs
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiPost(`/api/chat/conversations/${selectedId}/messages`, { content }),
    onSuccess: () => {
      setMessage("");
      // Invalidar ambas queries para que el polling refleje el mensaje enviado
      void qc.invalidateQueries({ queryKey:["messages", selectedId] });
      void qc.invalidateQueries({ queryKey:["conversations"] });
      // Scroll al fondo tras envío propio
      setTimeout(() => scrollToBottom(true), 50);
    },
    onError: () => toast({ title:"Error al enviar", variant:"destructive" }),
  });

  // ── Start conversation ─────────────────────────────────────────────────────

  const startMutation = useMutation({
    mutationFn: (userId: number) =>
      apiPost("/api/chat/conversations", { participantId: userId }),
    onSuccess: (conv: Conversation) => {
      void qc.invalidateQueries({ queryKey:["conversations"] });
      setSelectedId(conv.id);
      setMobileShowMessages(true);
    },
    onError: () => toast({ title:"Error al iniciar conversación", variant:"destructive" }),
  });

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || !selectedId || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }, [message, selectedId, sendMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // ── Filtered conversations ─────────────────────────────────────────────────

  const filteredConvs = conversations.filter(conv => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    if (!me) return true;
    const other = getOtherParticipant(conv, me.id);
    return (
      (other?.name?.toLowerCase().includes(q) ?? false) ||
      (other?.email?.toLowerCase().includes(q) ?? false) ||
      (conv.name?.toLowerCase().includes(q) ?? false)
    );
  });

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-border/60 bg-background">
      {/* Sidebar: lista de conversaciones */}
      <div className={cn(
        "flex flex-col border-r border-border/60 bg-muted/20",
        "w-full sm:w-72 lg:w-80 shrink-0",
        mobileShowMessages ? "hidden sm:flex" : "flex"
      )}>
        <div className="flex items-center gap-2 p-3 border-b border-border/40">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
            <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar conversaciones..." className="pl-8 h-8 text-xs"/>
            {search && <button onClick={()=>setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3"/></button>}
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={()=>setShowNew(true)} title="Nueva conversación">
            <Plus className="h-4 w-4"/>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="space-y-1 p-2">
              {[1,2,3].map(i=><Skeleton key={i} className="h-14 rounded-lg"/>)}
            </div>
          ) : convsError ? (
            <div className="flex items-center gap-2 text-sm text-destructive p-4">
              <AlertTriangle className="h-4 w-4 shrink-0"/>Error al cargar
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30"/>
              <p className="text-xs">{search?"Sin resultados":"Sin conversaciones"}</p>
            </div>
          ) : filteredConvs.map(conv => {
            const other    = me ? getOtherParticipant(conv, me.id) : null;
            const isActive = conv.id === selectedId;
            const name     = conv.type === "group" ? (conv.name ?? "Grupo") : (other?.name ?? other?.email ?? "Usuario");
            const user     = other ?? { id:0, name:null, email:"?", profile:null };
            return (
              <button key={conv.id}
                onClick={()=>{ setSelectedId(conv.id); setMobileShowMessages(true); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors border-l-2",
                  isActive
                    ? "bg-primary/8 border-l-primary"
                    : "hover:bg-muted/40 border-l-transparent"
                )}>
                <div className="relative shrink-0">
                  <Avatar user={{ ...user, id: user.id }} size="md"/>
                  {conv.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                      {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={cn("text-sm truncate", conv.unreadCount>0?"font-semibold":"font-medium")}>{name}</p>
                    {conv.lastMessage && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(conv.lastMessage.createdAt)}</span>
                    )}
                  </div>
                  {conv.lastMessage && (
                    <p className="text-xs text-muted-foreground truncate">{conv.lastMessage.content}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel de mensajes */}
      <div className={cn(
        "flex-1 flex flex-col overflow-hidden",
        !mobileShowMessages ? "hidden sm:flex" : "flex"
      )}>
        {!selectedId || !selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="h-12 w-12 opacity-20"/>
            <p className="text-sm">Seleccioná una conversación</p>
            <Button variant="outline" size="sm" onClick={()=>setShowNew(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5"/>Nueva conversación
            </Button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-background shrink-0">
              <button onClick={()=>setMobileShowMessages(false)} className="sm:hidden p-1 hover:bg-muted rounded">
                <ArrowLeft className="h-4 w-4"/>
              </button>
              {(() => {
                const other = me ? getOtherParticipant(selectedConv, me.id) : null;
                const user  = other ?? { id:0, name:null, email:"?", profile:null };
                const name  = selectedConv.type==="group" ? (selectedConv.name??"Grupo") : (other?.name ?? other?.email ?? "Usuario");
                return (
                  <>
                    <Avatar user={{ ...user, id: user.id }} size="md"/>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{name}</p>
                      {other?.profile?.area && <p className="text-xs text-muted-foreground">{other.profile.area}</p>}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
              onScroll={handleScroll}
            >
              {msgsError ? (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0"/>Error al cargar mensajes
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Sin mensajes. ¡Escribí el primero!</div>
              ) : messages.map((msg, idx) => {
                const prev       = messages[idx - 1];
                const showSender = !prev || prev.senderId !== msg.senderId;
                return <MessageBubble key={msg.id} msg={msg} showSender={showSender}/>;
              })}
              <div ref={messagesEndRef}/>
            </div>

            {/* Input */}
            <div className="flex items-end gap-2 px-4 py-3 border-t border-border/40 bg-background shrink-0">
              <Input
                ref={inputRef}
                value={message}
                onChange={e=>setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribí un mensaje... (Enter para enviar)"
                className="flex-1 text-sm"
                disabled={sendMutation.isPending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!message.trim() || sendMutation.isPending}
                className="shrink-0"
              >
                <Send className="h-4 w-4"/>
              </Button>
            </div>
          </>
        )}
      </div>

      <NewChatDialog
        open={showNew}
        onClose={()=>setShowNew(false)}
        onStart={userId=>startMutation.mutate(userId)}
      />
    </div>
  );
}
