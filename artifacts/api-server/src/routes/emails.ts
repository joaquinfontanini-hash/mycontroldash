import { Router, type IRouter } from "express";
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
import { requireModule } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/emails/oauth/status", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth?.userId ?? "anonymous";
  const configured = isGmailConfigured();

  if (!configured) {
    res.json({
      configured: false,
      connected: false,
      message: "Gmail no configurado. Agregar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.",
    });
    return;
  }

  const conn = await getEmailConnection(clerkId);
  res.json({
    configured: true,
    connected: conn?.isActive ?? false,
    email: conn?.email ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
  });
});

router.get("/emails/oauth/connect", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth?.userId ?? "anonymous";

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

router.get("/emails/oauth/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) {
    logger.warn({ error }, "Gmail OAuth error from Google");
    res.redirect("/?error=gmail_denied");
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  try {
    await handleGmailCallback(code, state);
    res.redirect("/dashboard/emails?connected=1");
  } catch (err) {
    logger.error({ err }, "Gmail callback error");
    res.redirect("/dashboard/emails?error=oauth_failed");
  }
});

router.post("/emails/oauth/disconnect", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth?.userId ?? "anonymous";
  await disconnectEmail(clerkId);
  res.json({ ok: true });
});

router.get("/emails", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId ?? "anonymous";
    const query = ListEmailsQueryParams.safeParse(req.query);
    const limit = query.success ? (query.data.limit ?? 20) : 20;

    const { messages, unread, status } = await fetchGmailMessages(clerkId, limit);

    res.json(messages.slice(0, limit));
  } catch (err) {
    logger.error({ err }, "Emails route error");
    res.status(500).json({ error: "Error al cargar emails", messages: [] });
  }
});

router.get("/emails/stats", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId ?? "anonymous";
    const { messages, unread, status } = await fetchGmailMessages(clerkId, 20);
    const important = messages.filter(e => ["impuestos", "finanzas"].includes(e.category)).length;

    res.json({
      total24h: messages.length,
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
