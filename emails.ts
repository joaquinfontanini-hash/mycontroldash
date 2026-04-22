import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import {
  fetchGmailMessages,
  getGmailAuthUrl,
  handleGmailCallback,
  disconnectEmail,
  getEmailConnection,
  isGmailConfigured,
} from "../services/email.service.js";
import { ListEmailsQueryParams } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/require-auth.js";

const router: IRouter = Router();

// ── Helper: obtener clerkId o 401 ─────────────────────────────────────────────
// El original usaba `auth?.userId ?? "anonymous"` — sin auth obligatoria, cualquier
// request sin token cargaba emails del usuario "anonymous" (o producía errores
// de DB que podían filtrar información interna).
// Ahora todos los endpoints de email requieren autenticación.
function getClerkId(req: Request): string | null {
  return getAuth(req)?.userId ?? null;
}

// ── Helper: sanitizar EmailConnection para response ───────────────────────────
// accessToken y refreshToken son credenciales OAuth encriptadas — aunque
// estén encriptadas en la DB, NUNCA deben aparecer en un response HTTP.
// Un logger de respuestas, un proxy o un bug de encriptación podrían exponerlos.
function sanitizeConnection(conn: Awaited<ReturnType<typeof getEmailConnection>>) {
  if (!conn) return null;
  return {
    isActive:   conn.isActive,
    email:      conn.email,
    provider:   conn.provider,
    lastSyncAt: conn.lastSyncAt,
    connectedAt: conn.connectedAt,
    // accessToken y refreshToken deliberadamente EXCLUIDOS
  };
}

// ── GET /emails/oauth/status ──────────────────────────────────────────────────
// Requiere auth: expone si hay una cuenta Gmail vinculada al usuario.
router.get("/emails/oauth/status", requireAuth, async (req: Request, res): Promise<void> => {
  const clerkId = getClerkId(req);
  if (!clerkId) { res.status(401).json({ error: "No autenticado" }); return; }

  try {
    const configured = isGmailConfigured();
    if (!configured) {
      res.json({
        configured: false,
        connected:  false,
        message:    "Gmail no configurado. Agregar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.",
      });
      return;
    }

    const conn = await getEmailConnection(clerkId);
    res.json({
      configured: true,
      connected:  conn?.isActive ?? false,
      // sanitizeConnection — nunca exponer tokens OAuth
      connection: sanitizeConnection(conn),
    });
  } catch (err) {
    logger.error({ err }, "emails/oauth/status error");
    res.status(500).json({ error: "Error al obtener estado de Gmail" });
  }
});

// ── GET /emails/oauth/connect ─────────────────────────────────────────────────
// Redirige al flujo OAuth de Google. Requiere auth.
router.get("/emails/oauth/connect", requireAuth, async (req: Request, res): Promise<void> => {
  const clerkId = getClerkId(req);
  if (!clerkId) { res.status(401).json({ error: "No autenticado" }); return; }

  if (!isGmailConfigured()) {
    res.status(400).json({ error: "Gmail OAuth no configurado. Ver variables de entorno." });
    return;
  }

  try {
    const url = getGmailAuthUrl(clerkId);
    res.redirect(url);
  } catch (err) {
    logger.error({ err }, "Gmail auth URL error");
    res.status(500).json({ error: "Error al generar URL de autenticación" });
  }
});

// ── GET /emails/oauth/callback ────────────────────────────────────────────────
// Callback de Google OAuth. No requiere auth de sesión (el usuario viene
// desde Google, sin sesión activa todavía).
// El redirect apunta a APP_URL (Vercel) — no al backend (Railway).
// El original redirigía a "/" que apuntaría al backend en Railway, no al frontend.
router.get("/emails/oauth/callback", async (req: Request, res): Promise<void> => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  // APP_URL es la URL del frontend en Vercel, configurada como variable de entorno
  const appUrl = process.env["APP_URL"] ?? "";

  if (error) {
    logger.warn({ error }, "Gmail OAuth error from Google");
    res.redirect(`${appUrl}/?error=gmail_denied`);
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  try {
    await handleGmailCallback(code, state);
    // Redirigir al frontend (Vercel), no al backend (Railway)
    res.redirect(`${appUrl}/dashboard/emails?connected=1`);
  } catch (err) {
    logger.error({ err }, "Gmail callback error");
    res.redirect(`${appUrl}/dashboard/emails?error=oauth_failed`);
  }
});

// ── POST /emails/oauth/disconnect ─────────────────────────────────────────────
// Desconectar Gmail. Requiere auth.
router.post("/emails/oauth/disconnect", requireAuth, async (req: Request, res): Promise<void> => {
  const clerkId = getClerkId(req);
  if (!clerkId) { res.status(401).json({ error: "No autenticado" }); return; }

  try {
    await disconnectEmail(clerkId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "emails/oauth/disconnect error");
    res.status(500).json({ error: "Error al desconectar Gmail" });
  }
});

// ── GET /emails ───────────────────────────────────────────────────────────────
// Lista mensajes de Gmail del usuario autenticado. Requiere auth.
router.get("/emails", requireAuth, async (req: Request, res): Promise<void> => {
  const clerkId = getClerkId(req);
  if (!clerkId) { res.status(401).json({ error: "No autenticado" }); return; }

  try {
    const query = ListEmailsQueryParams.safeParse(req.query);
    const limit = query.success ? (query.data.limit ?? 20) : 20;

    const { messages } = await fetchGmailMessages(clerkId, limit);
    res.json(messages.slice(0, limit));
  } catch (err) {
    logger.error({ err }, "Emails route error");
    res.status(500).json({ error: "Error al cargar emails", messages: [] });
  }
});

// ── GET /emails/stats ─────────────────────────────────────────────────────────
// Estadísticas de la bandeja. Requiere auth.
router.get("/emails/stats", requireAuth, async (req: Request, res): Promise<void> => {
  const clerkId = getClerkId(req);
  if (!clerkId) { res.status(401).json({ error: "No autenticado" }); return; }

  try {
    const { messages, unread, status } = await fetchGmailMessages(clerkId, 20);
    const important = messages.filter((e) =>
      ["impuestos", "finanzas"].includes(e.category ?? ""),
    ).length;

    res.json({
      total24h:   messages.length,
      unread,
      important,
      status,
      configured: isGmailConfigured(),
    });
  } catch (err) {
    logger.error({ err }, "Email stats error");
    res.status(500).json({ error: "Error al cargar estadísticas" });
  }
});

export default router;
