/**
 * email-provider.service.ts
 *
 * Capa de abstracción del proveedor de email.
 *
 * Arquitectura:
 *   EmailProvider (interface)
 *     └── SmtpProvider — SMTP/Gmail App Password (implementación activa)
 *         (futuro: OAuth2GmailProvider, SendGridProvider, ResendProvider)
 *
 *   EmailService — fachada de alto nivel:
 *     ├── sendEmail()
 *     ├── sendTemplateEmail()
 *     ├── sendTestEmail()
 *     ├── getProviderStatus()
 *     ├── healthCheck()
 *     └── renderTemplate()
 *
 * Configuración:
 *   - Las credenciales SMTP se guardan encriptadas en system_email_provider (BD).
 *   - El superadmin las configura desde el panel de administración.
 *   - Si no están configuradas, todos los envíos se loguean como "not_configured".
 *
 * Env vars opcionales:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM  (fallback legacy)
 *   APP_URL — dominio del dashboard (para links en emails)
 */

import nodemailer from "nodemailer";
import { db, systemEmailProviderTable, emailLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptCredential, decryptCredential } from "../lib/email-crypto.js";
import { renderTemplate, type TemplateKey, type RenderedEmail } from "./email-templates.js";
import { logger } from "../lib/logger.js";

// ── Provider interface ────────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(opts: SendEmailOptions): Promise<{ messageId?: string }>;
  verify(): Promise<{ ok: boolean; error?: string }>;
}

// ── SMTP Provider (Gmail + generic) ──────────────────────────────────────────

export class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private transport: nodemailer.Transporter;

  constructor(
    private host: string,
    private port: number,
    private user: string,
    pass: string,
    private from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(opts: SendEmailOptions): Promise<{ messageId?: string }> {
    const info = await this.transport.sendMail({
      from:    this.from,
      to:      Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
      replyTo: opts.replyTo,
    });
    return { messageId: info.messageId };
  }

  async verify(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.transport.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Provider cache ────────────────────────────────────────────────────────────
// Invalidated any time the configuration changes.

let _cachedProvider: EmailProvider | null = null;
let _providerCacheKey = "";

function invalidateProviderCache(): void {
  _cachedProvider = null;
  _providerCacheKey = "";
}

// ── Load provider from DB ─────────────────────────────────────────────────────

async function loadProviderFromDb(): Promise<EmailProvider | null> {
  try {
    const [cfg] = await db.select().from(systemEmailProviderTable).where(eq(systemEmailProviderTable.id, 1));
    if (!cfg || !cfg.isActive || cfg.connectionStatus === "not_configured") return null;
    if (!cfg.encSmtpHost || !cfg.encSmtpUser || !cfg.encSmtpPass) return null;

    const host  = decryptCredential(cfg.encSmtpHost);
    const port  = parseInt(decryptCredential(cfg.encSmtpPort ?? "587"));
    const user  = decryptCredential(cfg.encSmtpUser);
    const pass  = decryptCredential(cfg.encSmtpPass);
    const from  = cfg.senderName
      ? `${cfg.senderName} <${cfg.senderEmail ?? user}>`
      : (cfg.senderEmail ?? user);

    const cacheKey = `${host}:${port}:${user}`;
    if (_cachedProvider && _providerCacheKey === cacheKey) return _cachedProvider;

    const provider = new SmtpProvider(host, port, user, pass, from);
    _cachedProvider = provider;
    _providerCacheKey = cacheKey;
    return provider;
  } catch (err) {
    logger.error({ err }, "email-provider: failed to load from DB");
    return null;
  }
}

/** Load from env vars (legacy fallback) */
function loadProviderFromEnv(): EmailProvider | null {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  if (!host || !user || !pass) return null;

  const port = parseInt(process.env["SMTP_PORT"] ?? "587");
  const from = process.env["SMTP_FROM"] ?? `Sistema <${user}>`;
  return new SmtpProvider(host, port, user, pass, from);
}

// ── Core send function ────────────────────────────────────────────────────────

export type SendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  status: "sent" | "failed" | "not_configured" | "skipped";
};

async function sendRaw(
  opts: SendEmailOptions,
  meta: { userId?: number; templateKey?: string },
): Promise<SendResult> {
  const provider = await loadProviderFromDb() ?? loadProviderFromEnv();

  if (!provider) {
    await logEmail({
      userId: meta.userId,
      templateKey: meta.templateKey,
      recipientEmail: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      provider: "none",
      status: "not_configured",
      errorMessage: "SMTP no configurado. Configure las credenciales en Admin → Email del sistema.",
    });
    logger.warn({ to: opts.to }, "email-provider: SMTP not configured");
    return { ok: false, status: "not_configured", error: "SMTP not configured" };
  }

  try {
    const result = await provider.send(opts);
    await logEmail({
      userId: meta.userId,
      templateKey: meta.templateKey,
      recipientEmail: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      provider: provider.name,
      status: "sent",
      providerMessageId: result.messageId,
    });
    await updateProviderStats("success");
    logger.info({ to: opts.to, templateKey: meta.templateKey, messageId: result.messageId }, "email-provider: sent");
    return { ok: true, status: "sent", messageId: result.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logEmail({
      userId: meta.userId,
      templateKey: meta.templateKey,
      recipientEmail: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      provider: provider.name,
      status: "failed",
      errorMessage: error,
    });
    await updateProviderStats("failure", error);
    logger.error({ err, to: opts.to }, "email-provider: send failed");
    return { ok: false, status: "failed", error };
  }
}

// ── Stats updater ─────────────────────────────────────────────────────────────

async function updateProviderStats(result: "success" | "failure", errorMessage?: string): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [cfg]  = await db.select().from(systemEmailProviderTable).where(eq(systemEmailProviderTable.id, 1));
    if (!cfg) return;

    const resetDay = cfg.sentTodayDate !== today;
    const updates: Record<string, unknown> = {
      sentTodayDate: today,
      sentToday:   resetDay ? (result === "success" ? 1 : 0) : (cfg.sentToday + (result === "success" ? 1 : 0)),
      failedToday: resetDay ? (result === "failure" ? 1 : 0) : (cfg.failedToday + (result === "failure" ? 1 : 0)),
    };
    if (result === "success") updates["lastSuccessAt"] = new Date();
    if (result === "failure") {
      updates["lastErrorAt"] = new Date();
      updates["lastErrorMessage"] = errorMessage?.slice(0, 500);
    }
    await db.update(systemEmailProviderTable).set(updates).where(eq(systemEmailProviderTable.id, 1));
  } catch {
    // non-critical
  }
}

// ── Email log helper ──────────────────────────────────────────────────────────

async function logEmail(data: {
  userId?: number;
  templateKey?: string;
  recipientEmail: string;
  subject: string;
  provider?: string;
  status: string;
  errorMessage?: string;
  providerMessageId?: string;
  metadataJson?: string;
}): Promise<void> {
  try {
    await db.insert(emailLogsTable).values({
      userId:            data.userId ?? null,
      templateKey:       data.templateKey ?? null,
      recipientEmail:    data.recipientEmail,
      subject:           data.subject,
      provider:          data.provider ?? null,
      status:            data.status,
      errorMessage:      data.errorMessage ?? null,
      providerMessageId: data.providerMessageId ?? null,
      metadataJson:      data.metadataJson ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "email-provider: failed to write email log (non-critical)");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API — EmailService
// ═══════════════════════════════════════════════════════════════════════════════

/** Send a raw email */
export async function sendEmail(
  opts: SendEmailOptions,
  meta: { userId?: number; templateKey?: string } = {},
): Promise<SendResult> {
  return sendRaw(opts, meta);
}

/** Render a template and send it */
export async function sendTemplateEmail(
  templateKey: TemplateKey,
  vars: Record<string, unknown>,
  to: string | string[],
  meta: { userId?: number } = {},
): Promise<SendResult> {
  let rendered: RenderedEmail;
  try {
    rendered = renderTemplate(templateKey, vars);
  } catch (err) {
    logger.error({ err, templateKey }, "email-provider: template render failed");
    return { ok: false, status: "failed", error: `Template render error: ${err}` };
  }

  const cfg = await getProviderConfig();
  const replyTo = cfg?.replyTo ?? undefined;

  return sendRaw(
    { to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo },
    { userId: meta.userId, templateKey },
  );
}

/** Send a test email to verify configuration */
export async function sendTestEmail(
  to: string,
  meta: { adminName?: string; userId?: number } = {},
): Promise<SendResult> {
  const cfg = await getProviderConfig();
  return sendTemplateEmail(
    "test_email",
    {
      adminName:   meta.adminName,
      sentAt:      new Date(),
      providerType: cfg?.providerType ?? "smtp",
      senderEmail:  cfg?.senderEmail ?? "no-configurado",
    },
    to,
    { userId: meta.userId },
  );
}

// ── Provider configuration management ────────────────────────────────────────

export interface ProviderConfigInput {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  senderEmail?: string;
  senderName?: string;
  replyTo?: string;
  providerType?: string;
}

export async function configureProvider(input: ProviderConfigInput, updatedBy?: string): Promise<void> {
  invalidateProviderCache();

  const encHost = encryptCredential(input.smtpHost);
  const encPort = encryptCredential(String(input.smtpPort));
  const encUser = encryptCredential(input.smtpUser);
  const encPass = encryptCredential(input.smtpPass);

  const [existing] = await db.select().from(systemEmailProviderTable).where(eq(systemEmailProviderTable.id, 1));

  const data = {
    providerType:     input.providerType ?? "smtp_gmail",
    senderEmail:      input.senderEmail ?? input.smtpUser,
    senderName:       input.senderName ?? "Sistema Dashboard",
    replyTo:          input.replyTo ?? null,
    encSmtpHost:      encHost,
    encSmtpPort:      encPort,
    encSmtpUser:      encUser,
    encSmtpPass:      encPass,
    connectionStatus: "pending_verification",
    isActive:         false,   // activated only after successful healthCheck()
    lastConnectedAt:  new Date(),
  };

  if (!existing) {
    await db.insert(systemEmailProviderTable).values({ id: 1, ...data } as any);
  } else {
    await db.update(systemEmailProviderTable).set(data).where(eq(systemEmailProviderTable.id, 1));
  }

  logger.info({ updatedBy }, "email-provider: configuration updated");
}

export async function disconnectProvider(updatedBy?: string): Promise<void> {
  invalidateProviderCache();
  await db.update(systemEmailProviderTable).set({
    isActive:         false,
    connectionStatus: "not_configured",
    encSmtpHost:      null,
    encSmtpPort:      null,
    encSmtpUser:      null,
    encSmtpPass:      null,
    lastErrorMessage: null,
  }).where(eq(systemEmailProviderTable.id, 1));
  logger.info({ updatedBy }, "email-provider: disconnected");
}

export async function getProviderConfig(): Promise<import("@workspace/db").SystemEmailProvider | null> {
  try {
    const [cfg] = await db.select().from(systemEmailProviderTable).where(eq(systemEmailProviderTable.id, 1));
    return cfg ?? null;
  } catch { return null; }
}

export interface ProviderStatus {
  configured: boolean;
  active: boolean;
  providerType: string;
  senderEmail: string | null;
  senderName: string;
  replyTo: string | null;
  connectionStatus: string;
  lastConnectedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  sentToday: number;
  failedToday: number;
  smtpHost?: string;       // partially revealed (host only, no creds)
  smtpPort?: string;
  smtpUser?: string;       // partially masked
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  const cfg = await getProviderConfig();
  if (!cfg) {
    return {
      configured:       false,
      active:           false,
      providerType:     "smtp_gmail",
      senderEmail:      null,
      senderName:       "Sistema Dashboard",
      replyTo:          null,
      connectionStatus: "not_configured",
      lastConnectedAt:  null,
      lastSuccessAt:    null,
      lastErrorAt:      null,
      lastErrorMessage: null,
      sentToday:        0,
      failedToday:      0,
    };
  }

  // Partially reveal SMTP host/port/user for UI (no passwords!)
  let smtpHost: string | undefined;
  let smtpPort: string | undefined;
  let smtpUser: string | undefined;
  try {
    if (cfg.encSmtpHost) smtpHost = decryptCredential(cfg.encSmtpHost);
    if (cfg.encSmtpPort) smtpPort = decryptCredential(cfg.encSmtpPort);
    if (cfg.encSmtpUser) {
      const user = decryptCredential(cfg.encSmtpUser);
      smtpUser = user.replace(/(?<=.).(?=.*@)/g, "•"); // mask middle chars
    }
  } catch { /* ignore */ }

  return {
    configured:       !!(cfg.encSmtpHost && cfg.encSmtpUser && cfg.encSmtpPass),
    active:           cfg.isActive,
    providerType:     cfg.providerType,
    senderEmail:      cfg.senderEmail,
    senderName:       cfg.senderName,
    replyTo:          cfg.replyTo,
    connectionStatus: cfg.connectionStatus,
    lastConnectedAt:  cfg.lastConnectedAt?.toISOString() ?? null,
    lastSuccessAt:    cfg.lastSuccessAt?.toISOString() ?? null,
    lastErrorAt:      cfg.lastErrorAt?.toISOString() ?? null,
    lastErrorMessage: cfg.lastErrorMessage,
    sentToday:        cfg.sentToday,
    failedToday:      cfg.failedToday,
    smtpHost,
    smtpPort,
    smtpUser,
  };
}

/** Live health check — tries to connect to the SMTP server */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const provider = await loadProviderFromDb() ?? loadProviderFromEnv();
  if (!provider) {
    return { ok: false, error: "No provider configured" };
  }
  const start = Date.now();
  const result = await provider.verify();
  const latencyMs = Date.now() - start;

  if (!result.ok) {
    await db.update(systemEmailProviderTable).set({
      connectionStatus: "error",
      lastErrorAt: new Date(),
      lastErrorMessage: result.error?.slice(0, 500),
    }).where(eq(systemEmailProviderTable.id, 1));
  } else {
    await db.update(systemEmailProviderTable).set({
      connectionStatus: "connected",
      lastConnectedAt: new Date(),
    }).where(eq(systemEmailProviderTable.id, 1));
  }
  return { ok: result.ok, latencyMs, error: result.error };
}

/** Update provider settings without changing credentials */
export async function updateProviderSettings(opts: {
  senderName?: string;
  replyTo?: string;
  isActive?: boolean;
}): Promise<void> {
  invalidateProviderCache();
  const update: Record<string, unknown> = {};
  if (opts.senderName !== undefined) update["senderName"] = opts.senderName;
  if (opts.replyTo    !== undefined) update["replyTo"]    = opts.replyTo || null;
  if (opts.isActive   !== undefined) update["isActive"]   = opts.isActive;
  await db.update(systemEmailProviderTable).set(update).where(eq(systemEmailProviderTable.id, 1));
}

export { renderTemplate, invalidateProviderCache };
