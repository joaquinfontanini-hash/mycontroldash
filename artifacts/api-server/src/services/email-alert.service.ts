/**
 * email-alert.service.ts
 *
 * Sistema de alertas por email para vencimientos impositivos.
 *
 * CONFIGURACIÓN (variables de entorno):
 *   SMTP_HOST     — servidor SMTP (ej: "smtp.gmail.com")
 *   SMTP_PORT     — puerto (ej: "587")
 *   SMTP_USER     — usuario/email del remitente
 *   SMTP_PASS     — contraseña o app-password
 *   SMTP_FROM     — "Estudio Fiscal <no-reply@tudominio.com>"
 *
 * Si las variables no están configuradas, el sistema:
 *   - Genera el email y lo registra en alert_logs con status "skipped"
 *   - Nunca falla silenciosamente
 *   - Permite vista previa del HTML generado
 */

import nodemailer from "nodemailer";
import { db, alertLogsTable, dueDatesTable, clientsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type AlertType =
  | "reminder_7d"
  | "reminder_3d"
  | "reminder_1d"
  | "due_today"
  | "overdue"
  | "error"
  | "system";

export interface DueDateAlertPayload {
  dueDateId: number;
  clientId: number;
  clientName: string;
  clientEmail?: string | null;
  clientEmailSecondary?: string | null;
  taxCode: string;
  taxLabel: string;
  dueDate: string;
  daysRemaining: number;
  trafficLight: string;
  priority: string;
  traceability?: string;
  alertType: AlertType;
}

// ── SMTP transport ────────────────────────────────────────────────────────────

function createTransport() {
  const host = process.env["SMTP_HOST"];
  const port = parseInt(process.env["SMTP_PORT"] ?? "587");
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const SMTP_FROM = process.env["SMTP_FROM"] ?? "Sistema de Vencimientos <no-reply@estudio.ar>";

function isSmtpConfigured(): boolean {
  return !!(process.env["SMTP_HOST"] && process.env["SMTP_USER"] && process.env["SMTP_PASS"]);
}

// ── Email templates ───────────────────────────────────────────────────────────

const SEMAFORO_COLORS: Record<string, string> = {
  rojo: "#ef4444",
  amarillo: "#f59e0b",
  verde: "#22c55e",
  gris: "#94a3b8",
};

const SEMAFORO_LABELS: Record<string, string> = {
  rojo: "🔴 URGENTE",
  amarillo: "🟡 PRÓXIMO",
  verde: "🟢 A TIEMPO",
  gris: "⚪ SIN DATOS",
};

function baseTemplate(content: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 24px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #1e293b; color: white; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; }
    .body { padding: 32px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; }
    .field value { display: block; font-size: 15px; color: #0f172a; font-weight: 500; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; color: white; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .cta { display: block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; text-align: center; font-weight: 600; margin-top: 24px; }
    .footer { background: #f8fafc; padding: 16px 32px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      Sistema de Vencimientos — Estudio Fiscal<br>
      Este es un mensaje automático. No responder a este correo.
    </div>
  </div>
</body>
</html>`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch { return dateStr; }
}

function buildSubject(payload: DueDateAlertPayload): string {
  const { alertType, clientName, taxLabel, dueDate } = payload;
  const dateFormatted = dueDate;
  switch (alertType) {
    case "reminder_7d": return `⏰ Recordatorio 7 días — ${taxLabel} · ${clientName} · ${dateFormatted}`;
    case "reminder_3d": return `⚠️ Recordatorio 3 días — ${taxLabel} · ${clientName} · ${dateFormatted}`;
    case "reminder_1d": return `🔔 Vence mañana — ${taxLabel} · ${clientName} · ${dateFormatted}`;
    case "due_today":   return `🔴 VENCE HOY — ${taxLabel} · ${clientName}`;
    case "overdue":     return `🚨 VENCIDO — ${taxLabel} · ${clientName} · ${dateFormatted}`;
    case "error":       return `⛔ Error de cálculo — ${clientName}`;
    default:            return `Notificación de vencimiento — ${clientName}`;
  }
}

function buildAlertTypeLabel(type: AlertType): string {
  const labels: Record<AlertType, string> = {
    reminder_7d: "Recordatorio — 7 días",
    reminder_3d: "Recordatorio — 3 días",
    reminder_1d: "Recordatorio — Mañana",
    due_today: "Vence hoy",
    overdue: "Vencido",
    error: "Error de cálculo",
    system: "Aviso del sistema",
  };
  return labels[type] ?? type;
}

function buildHtmlBody(payload: DueDateAlertPayload): string {
  const {
    clientName, taxLabel, dueDate, daysRemaining,
    trafficLight, priority, alertType, taxCode,
  } = payload;

  const color = SEMAFORO_COLORS[trafficLight] ?? "#94a3b8";
  const semaforoLabel = SEMAFORO_LABELS[trafficLight] ?? trafficLight.toUpperCase();
  const dateFormatted = formatDate(dueDate);
  const typeLabel = buildAlertTypeLabel(alertType);

  const daysText = daysRemaining < 0
    ? `Vencido hace ${Math.abs(daysRemaining)} día(s)`
    : daysRemaining === 0
    ? "Vence hoy"
    : `Faltan ${daysRemaining} día(s)`;

  const headerBg = trafficLight === "rojo" ? "#7f1d1d"
    : trafficLight === "amarillo" ? "#78350f"
    : "#1e293b";

  const content = `
    <div class="header" style="background: ${headerBg}">
      <h1>${typeLabel}</h1>
      <p>Notificación automática del Sistema de Vencimientos</p>
    </div>
    <div class="body">
      <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
        <span class="badge" style="background: ${color}; font-size: 14px;">${semaforoLabel}</span>
        <span style="font-size: 15px; font-weight: 600; color: #0f172a;">${daysText}</span>
      </div>
      <div class="grid">
        <div class="field">
          <label>Cliente</label>
          <value>${clientName}</value>
        </div>
        <div class="field">
          <label>Obligación fiscal</label>
          <value>${taxLabel}</value>
        </div>
        <div class="field">
          <label>Fecha de vencimiento</label>
          <value>${dateFormatted}</value>
        </div>
        <div class="field">
          <label>Estado</label>
          <value>${semaforoLabel}</value>
        </div>
      </div>
      <hr class="divider">
      <p style="color: #64748b; font-size: 14px; margin: 0;">
        Este vencimiento fue calculado automáticamente a partir del calendario fiscal vigente.
        Por favor, verificar el estado antes de la fecha límite.
      </p>
      <a class="cta" href="${process.env["APP_URL"] ?? "https://tu-dashboard.replit.app"}/dashboard/due-dates">
        Ver en el Dashboard
      </a>
    </div>
  `;
  return baseTemplate(content, buildSubject(payload));
}

// ── Deduplication ─────────────────────────────────────────────────────────────
// Prevent sending the same alert type to the same recipient for the same due date
// within a 24-hour window.

async function isDuplicate(
  dueDateId: number,
  alertType: AlertType,
  recipient: string,
): Promise<boolean> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await db
    .select()
    .from(alertLogsTable)
    .where(and(
      eq(alertLogsTable.dueDateId, dueDateId),
      eq(alertLogsTable.alertType, alertType),
      eq(alertLogsTable.recipient, recipient),
      eq(alertLogsTable.sendStatus, "sent"),
    ))
    .orderBy(desc(alertLogsTable.sentAt))
    .limit(1);

  if (logs.length === 0) return false;
  const last = logs[0]?.sentAt;
  if (!last) return false;
  return new Date(last) > yesterday;
}

// ── Core: send one alert ──────────────────────────────────────────────────────

export async function sendDueDateAlert(
  payload: DueDateAlertPayload,
  recipients: string[],
  opts: { isAutomatic?: boolean; triggeredBy?: string; forceResend?: boolean } = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { isAutomatic = true, triggeredBy, forceResend = false } = opts;
  let sent = 0, failed = 0, skipped = 0;

  const subject = buildSubject(payload);
  const htmlBody = buildHtmlBody(payload);
  const transport = createTransport();

  for (const recipient of recipients) {
    if (!recipient || !recipient.includes("@")) continue;

    // Dedup check
    if (!forceResend && await isDuplicate(payload.dueDateId, payload.alertType, recipient)) {
      skipped++;
      await db.insert(alertLogsTable).values({
        clientId: payload.clientId,
        dueDateId: payload.dueDateId,
        alertType: payload.alertType,
        recipient,
        subject,
        bodyHtml: htmlBody,
        sendStatus: "skipped",
        errorMessage: "Duplicado: ya enviado en las últimas 24h",
        isAutomatic,
        retriggeredBy: triggeredBy ?? null,
      });
      continue;
    }

    if (!transport || !isSmtpConfigured()) {
      // SMTP not configured — log but don't fail
      await db.insert(alertLogsTable).values({
        clientId: payload.clientId,
        dueDateId: payload.dueDateId,
        alertType: payload.alertType,
        recipient,
        subject,
        bodyHtml: htmlBody,
        sendStatus: "skipped",
        errorMessage: "SMTP no configurado. Configure SMTP_HOST, SMTP_USER, SMTP_PASS en variables de entorno.",
        isAutomatic,
        retriggeredBy: triggeredBy ?? null,
      });
      skipped++;
      logger.warn({ recipient, alertType: payload.alertType }, "Email alert: SMTP not configured");
      continue;
    }

    try {
      await transport.sendMail({
        from: SMTP_FROM,
        to: recipient,
        subject,
        html: htmlBody,
      });

      await db.insert(alertLogsTable).values({
        clientId: payload.clientId,
        dueDateId: payload.dueDateId,
        alertType: payload.alertType,
        recipient,
        subject,
        bodyHtml: htmlBody,
        sentAt: new Date(),
        sendStatus: "sent",
        isAutomatic,
        retriggeredBy: triggeredBy ?? null,
      });

      // Mark due date as alerted
      await db.update(dueDatesTable)
        .set({ alertGenerated: true, lastAlertSentAt: new Date().toISOString() })
        .where(eq(dueDatesTable.id, payload.dueDateId));

      sent++;
      logger.info({ recipient, alertType: payload.alertType, clientName: payload.clientName }, "Email alert sent");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await db.insert(alertLogsTable).values({
        clientId: payload.clientId,
        dueDateId: payload.dueDateId,
        alertType: payload.alertType,
        recipient,
        subject,
        bodyHtml: htmlBody,
        sendStatus: "failed",
        errorMessage,
        isAutomatic,
        retriggeredBy: triggeredBy ?? null,
      });
      failed++;
      logger.error({ err, recipient, alertType: payload.alertType }, "Email alert failed");
    }
  }

  return { sent, failed, skipped };
}

// ── Daily alert job ───────────────────────────────────────────────────────────
// Called by the scheduler every day at 8:00 AM.
// Checks all pending due dates and sends relevant alerts.

export async function runDailyAlertJob(): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  logger.info("Email alert job: starting daily run");
  let processed = 0, totalSent = 0, totalSkipped = 0, totalErrors = 0;

  const pending = await db
    .select({ dd: dueDatesTable, client: clientsTable })
    .from(dueDatesTable)
    .innerJoin(clientsTable, eq(dueDatesTable.clientId, clientsTable.id))
    .where(and(
      eq(dueDatesTable.status, "pending"),
      eq(dueDatesTable.alertEnabled, true),
    ));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const { dd, client } of pending) {
    if (!client.alertsActive) continue;

    let daysRemaining: number;
    try {
      const due = new Date(dd.dueDate + "T00:00:00");
      daysRemaining = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    } catch { continue; }

    let alertType: AlertType | null = null;
    if (daysRemaining < 0)  alertType = "overdue";
    else if (daysRemaining === 0) alertType = "due_today";
    else if (daysRemaining === 1) alertType = "reminder_1d";
    else if (daysRemaining === 3) alertType = "reminder_3d";
    else if (daysRemaining === 7) alertType = "reminder_7d";

    if (!alertType) continue;

    const recipients = [client.email, client.emailSecondary]
      .filter((e): e is string => Boolean(e && e.includes("@")));

    if (recipients.length === 0) {
      // Log internally but don't attempt send
      await db.insert(alertLogsTable).values({
        clientId: client.id,
        dueDateId: dd.id,
        alertType,
        recipient: "no-email",
        subject: buildSubject({
          dueDateId: dd.id,
          clientId: client.id,
          clientName: client.name,
          taxCode: dd.taxCode ?? "",
          taxLabel: dd.title,
          dueDate: dd.dueDate,
          daysRemaining,
          trafficLight: dd.trafficLight,
          priority: dd.priority,
          alertType,
        }),
        sendStatus: "skipped",
        errorMessage: "Cliente sin email configurado",
        isAutomatic: true,
      });
      totalSkipped++;
      processed++;
      continue;
    }

    const result = await sendDueDateAlert(
      {
        dueDateId: dd.id,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email,
        clientEmailSecondary: client.emailSecondary,
        taxCode: dd.taxCode ?? "",
        taxLabel: dd.title,
        dueDate: dd.dueDate,
        daysRemaining,
        trafficLight: dd.trafficLight,
        priority: dd.priority,
        alertType,
      },
      recipients,
      { isAutomatic: true },
    );

    totalSent += result.sent;
    totalSkipped += result.skipped;
    totalErrors += result.failed;
    processed++;
  }

  logger.info({ processed, totalSent, totalSkipped, totalErrors }, "Email alert job: completed");
  return { processed, sent: totalSent, skipped: totalSkipped, errors: totalErrors };
}

// ── Resend manually ───────────────────────────────────────────────────────────

export async function resendAlert(
  alertLogId: number,
  triggeredBy: string,
): Promise<{ success: boolean; message: string }> {
  const [log] = await db
    .select()
    .from(alertLogsTable)
    .where(eq(alertLogsTable.id, alertLogId));

  if (!log) return { success: false, message: "Alerta no encontrada" };
  if (!log.dueDateId) return { success: false, message: "Sin due_date_id" };

  const [dd] = await db.select().from(dueDatesTable).where(eq(dueDatesTable.id, log.dueDateId));
  if (!dd) return { success: false, message: "Vencimiento no encontrado" };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dd.dueDate + "T00:00:00");
  const daysRemaining = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const result = await sendDueDateAlert(
    {
      dueDateId: dd.id,
      clientId: log.clientId ?? 0,
      clientName: "Cliente",
      taxCode: dd.taxCode ?? "",
      taxLabel: dd.title,
      dueDate: dd.dueDate,
      daysRemaining,
      trafficLight: dd.trafficLight,
      priority: dd.priority,
      alertType: log.alertType as AlertType,
    },
    [log.recipient],
    { isAutomatic: false, triggeredBy, forceResend: true },
  );

  return {
    success: result.sent > 0,
    message: result.sent > 0 ? "Alerta reenviada" : "Fallo el reenvío",
  };
}
