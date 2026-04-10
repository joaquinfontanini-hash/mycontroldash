import { db, emailConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:8080";
const OAUTH_REDIRECT = `${APP_BASE_URL}/api/emails/oauth/callback`;

export interface EmailMessage {
  id: string | number;
  sender: string;
  senderEmail: string;
  subject: string;
  preview: string;
  date: string;
  isRead: boolean;
  category: string;
}

export function isGmailConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function getGmailAuthUrl(clerkId: string): string {
  if (!GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not set");
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state: clerkId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleGmailCallback(code: string, clerkId: string): Promise<void> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Gmail OAuth not configured");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json() as { email?: string };

  const existing = await db
    .select()
    .from(emailConnectionsTable)
    .where(eq(emailConnectionsTable.clerkId, clerkId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(emailConnectionsTable)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing[0]?.refreshToken,
        tokenExpiresAt: expiresAt,
        email: profile.email,
        isActive: true,
        lastSyncAt: new Date(),
      })
      .where(eq(emailConnectionsTable.clerkId, clerkId));
  } else {
    await db.insert(emailConnectionsTable).values({
      clerkId,
      provider: "gmail",
      email: profile.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: expiresAt,
      isActive: true,
      lastSyncAt: new Date(),
    });
  }
}

export async function getEmailConnection(clerkId: string) {
  const [conn] = await db
    .select()
    .from(emailConnectionsTable)
    .where(eq(emailConnectionsTable.clerkId, clerkId))
    .limit(1);
  return conn ?? null;
}

export async function disconnectEmail(clerkId: string): Promise<void> {
  await db
    .update(emailConnectionsTable)
    .set({ isActive: false, accessToken: null, refreshToken: null })
    .where(eq(emailConnectionsTable.clerkId, clerkId));
}

async function refreshAccessToken(clerkId: string, refreshToken: string): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error("Gmail not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Failed to refresh token");
  const data = await res.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await db
    .update(emailConnectionsTable)
    .set({ accessToken: data.access_token, tokenExpiresAt: expiresAt })
    .where(eq(emailConnectionsTable.clerkId, clerkId));
  return data.access_token;
}

export async function fetchGmailMessages(clerkId: string, maxResults = 20): Promise<{
  messages: EmailMessage[];
  unread: number;
  status: "connected" | "not_connected" | "error";
}> {
  const conn = await getEmailConnection(clerkId);
  if (!conn || !conn.isActive) {
    return { messages: getMockEmails(), unread: 4, status: "not_connected" };
  }

  try {
    let token = conn.accessToken!;
    const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : 0;

    if (Date.now() > expiresAt - 60000 && conn.refreshToken) {
      token = await refreshAccessToken(clerkId, conn.refreshToken);
    }

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=in:inbox`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) throw new Error(`Gmail list error: ${listRes.status}`);
    const listData = await listRes.json() as { messages?: { id: string }[] };
    const ids = listData.messages?.slice(0, maxResults) ?? [];

    const messages = await Promise.all(
      ids.map(async ({ id }) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From,Subject,Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) return null;
        const msg = await msgRes.json() as {
          id: string;
          labelIds: string[];
          snippet: string;
          payload: { headers: { name: string; value: string }[] };
          internalDate: string;
        };

        const headers = Object.fromEntries(
          msg.payload.headers.map(h => [h.name.toLowerCase(), h.value])
        );

        const from = headers["from"] ?? "";
        const nameMatch = from.match(/^"?([^"<]+)"?\s*<?/);
        const emailMatch = from.match(/<(.+)>/);
        const isRead = !msg.labelIds.includes("UNREAD");

        const dateMs = Number(msg.internalDate);
        const cat = categorizeEmail(headers["subject"] ?? "", headers["from"] ?? "");

        return {
          id: msg.id,
          sender: nameMatch?.[1]?.trim() ?? "Desconocido",
          senderEmail: emailMatch?.[1] ?? from,
          subject: headers["subject"] ?? "(Sin asunto)",
          preview: msg.snippet ?? "",
          date: new Date(dateMs).toISOString(),
          isRead,
          category: cat,
        } satisfies EmailMessage;
      })
    );

    const valid = messages.filter(Boolean) as EmailMessage[];
    const unread = valid.filter(m => !m.isRead).length;

    await db
      .update(emailConnectionsTable)
      .set({ lastSyncAt: new Date() })
      .where(eq(emailConnectionsTable.clerkId, clerkId));

    return { messages: valid, unread, status: "connected" };
  } catch (err) {
    logger.error({ err, clerkId }, "Gmail fetch failed");
    return { messages: getMockEmails(), unread: 4, status: "error" };
  }
}

function categorizeEmail(subject: string, from: string): string {
  const text = `${subject} ${from}`.toLowerCase();
  if (text.includes("afip") || text.includes("arca") || text.includes("impuesto") || text.includes("iva")) return "impuestos";
  if (text.includes("factura") || text.includes("invoice")) return "facturación";
  if (text.includes("banco") || text.includes("transferencia") || text.includes("alerta")) return "finanzas";
  if (text.includes("cliente") || text.includes("propuesta") || text.includes("reunión")) return "clientes";
  return "trabajo";
}

function getMockEmails(): EmailMessage[] {
  return [
    {
      id: 1, sender: "Carlos Mendoza", senderEmail: "carlos@consultora.com.ar",
      subject: "Informe anual de auditoría - Revisión final",
      preview: "Adjunto el borrador final del informe de auditoría para su revisión.",
      date: new Date(Date.now() - 1800000).toISOString(), isRead: false, category: "trabajo",
    },
    {
      id: 2, sender: "AFIP Notificaciones", senderEmail: "notificaciones@afip.gob.ar",
      subject: "Notificación: Vencimiento declaración jurada IVA",
      preview: "Le informamos que el próximo vencimiento para IVA es el 18 del corriente.",
      date: new Date(Date.now() - 3600000).toISOString(), isRead: false, category: "impuestos",
    },
    {
      id: 3, sender: "Lucía Rodríguez", senderEmail: "lucia@clienteempresa.com",
      subject: "Re: Propuesta de servicios profesionales",
      preview: "Nos pareció interesante y quisiera coordinar una reunión.",
      date: new Date(Date.now() - 7200000).toISOString(), isRead: true, category: "clientes",
    },
    {
      id: 4, sender: "Banco Nación Argentina", senderEmail: "alertas@bna.com.ar",
      subject: "Alerta: Transferencia recibida por $450.000",
      preview: "Se acreditó en su cuenta una transferencia de $450.000.",
      date: new Date(Date.now() - 10800000).toISOString(), isRead: true, category: "finanzas",
    },
    {
      id: 5, sender: "Rentas Neuquén", senderEmail: "notificaciones@rentas.neuquen.gov.ar",
      subject: "Recordatorio: Vencimiento Ingresos Brutos",
      preview: "El vencimiento del anticipo mensual de Ingresos Brutos opera el día 20.",
      date: new Date(Date.now() - 14400000).toISOString(), isRead: false, category: "impuestos",
    },
    {
      id: 6, sender: "Ana García", senderEmail: "ana.garcia@socio.com.ar",
      subject: "Reunión de socios — Agenda lunes",
      preview: "Les comparto la agenda para la reunión del lunes. Puntos: presupuesto y nuevos clientes.",
      date: new Date(Date.now() - 21600000).toISOString(), isRead: false, category: "trabajo",
    },
  ];
}
