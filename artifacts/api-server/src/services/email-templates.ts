/**
 * email-templates.ts
 *
 * Sistema centralizado de templates HTML responsive para emails transaccionales.
 *
 * Cada template devuelve { subject, html, text }.
 * Todas las variables se escapan para prevenir XSS en HTML.
 *
 * Templates disponibles:
 *   forgot_password_request    — enviar link de reset
 *   password_changed           — confirmación de cambio
 *   due_date_alert             — vencimiento próximo/vencido
 *   news_alert                 — alerta de noticia relevante
 *   dollar_alert               — umbral de cotización alcanzado
 *   login_alert                — acceso a la cuenta
 *   test_email                 — prueba del sistema
 */

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateEs(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
  });
}

// ── Base HTML template ────────────────────────────────────────────────────────

function baseHtml(opts: {
  preheader: string;
  headerBg: string;
  headerTitle: string;
  headerSubtitle?: string;
  body: string;
  appName?: string;
  appUrl?: string;
}): string {
  const appName = esc(opts.appName ?? "Dashboard Estudio");
  const appUrl  = esc(opts.appUrl ?? process.env["APP_URL"] ?? "https://dashboard.estudio.ar");
  const year    = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(opts.headerTitle)}</title>
  <!--[if !mso]><!-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
  <!--<![endif]-->
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f1f5f9; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased; }
    .wrapper { width: 100%; background: #f1f5f9; padding: 32px 16px; }
    .email-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: ${esc(opts.headerBg)}; padding: 36px 40px 32px; text-align: center; }
    .header-logo { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 16px; }
    .header-title { font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.25; margin-bottom: 6px; }
    .header-subtitle { font-size: 14px; color: rgba(255,255,255,0.8); line-height: 1.5; }
    .body-content { padding: 40px 40px 32px; }
    .text { font-size: 15px; line-height: 1.7; color: #334155; margin-bottom: 20px; }
    .text-muted { font-size: 13px; color: #64748b; line-height: 1.6; }
    .cta-wrapper { text-align: center; margin: 32px 0; }
    .cta { display: inline-block; background: ${esc(opts.headerBg)}; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
    .cta:hover { opacity: 0.92; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
    .info-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; width: 120px; min-width: 120px; padding-top: 2px; }
    .info-value { font-size: 14px; color: #0f172a; font-weight: 500; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
    .badge-red    { background: #fee2e2; color: #dc2626; }
    .badge-amber  { background: #fef3c7; color: #d97706; }
    .badge-green  { background: #dcfce7; color: #16a34a; }
    .badge-blue   { background: #dbeafe; color: #2563eb; }
    .badge-gray   { background: #f1f5f9; color: #64748b; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 40px; text-align: center; }
    .footer-text { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .footer-link { color: #64748b; text-decoration: none; }
    .security-notice { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px 18px; font-size: 13px; color: #9a3412; margin-top: 24px; line-height: 1.6; }
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 16px 8px; }
      .header { padding: 28px 24px; }
      .body-content { padding: 28px 24px 24px; }
      .footer { padding: 20px 24px; }
      .header-title { font-size: 22px; }
      .info-label { width: 90px; min-width: 90px; }
    }
  </style>
</head>
<body>
  <!-- preheader (hidden in email body but shown in inbox preview) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>

  <div class="wrapper">
    <div class="email-card">
      <!-- HEADER -->
      <div class="header">
        <div class="header-logo">${appName}</div>
        <div class="header-title">${esc(opts.headerTitle)}</div>
        ${opts.headerSubtitle ? `<div class="header-subtitle">${esc(opts.headerSubtitle)}</div>` : ""}
      </div>

      <!-- BODY -->
      <div class="body-content">
        ${opts.body}
      </div>

      <!-- FOOTER -->
      <div class="footer">
        <p class="footer-text">
          Este es un mensaje automático de <strong>${appName}</strong>.<br>
          Si no solicitaste esta acción, podés ignorar este correo.<br>
          <a class="footer-link" href="${appUrl}">${appUrl}</a>
        </p>
        <p class="footer-text" style="margin-top:8px">© ${year} ${appName} · Todos los derechos reservados</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Template render result ────────────────────────────────────────────────────

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. forgot_password_request
// ═══════════════════════════════════════════════════════════════════════════════

export function renderForgotPasswordRequest(vars: {
  userName?: string;
  resetUrl: string;
  expiresMinutes?: number;
  requestedAt?: Date;
  ip?: string;
}): RenderedEmail {
  const name    = esc(vars.userName ?? "Usuario");
  const url     = esc(vars.resetUrl);
  const expires = vars.expiresMinutes ?? 30;
  const time    = formatDateEs(vars.requestedAt ?? new Date());
  const ip      = vars.ip ? `IP: ${esc(vars.ip.substring(0, 20))}...` : "";

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
    <div class="cta-wrapper">
      <a class="cta" href="${url}" target="_blank" rel="noopener noreferrer">Restablecer contraseña</a>
    </div>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Solicitado</span>
        <span class="info-value">${time}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Expira en</span>
        <span class="info-value">${expires} minutos</span>
      </div>
      ${ip ? `<div class="info-row"><span class="info-label">Origen</span><span class="info-value">${ip}</span></div>` : ""}
    </div>
    <p class="text-muted">Si no realizaste esta solicitud, podés ignorar este correo. Tu contraseña no cambiará.</p>
    <div class="security-notice">
      ⚠️ <strong>Nunca compartás este enlace.</strong> Es de uso único y expira en ${expires} minutos. Tampoco te pediremos que lo compartas por ningún otro canal.
    </div>`;

  const text = `Restablecé tu contraseña\n\nHola ${vars.userName ?? "Usuario"},\n\nRecibimos una solicitud para restablecer tu contraseña.\n\nHacé click en este enlace para continuar:\n${vars.resetUrl}\n\nEste enlace expira en ${expires} minutos.\n\nSi no realizaste esta solicitud, ignorá este correo.`;

  return {
    subject: "Restablecé tu contraseña — Dashboard Estudio",
    html: baseHtml({
      preheader: "Enlace para restablecer tu contraseña (expira en " + expires + " min)",
      headerBg: "#1e293b",
      headerTitle: "Restablecé tu contraseña",
      headerSubtitle: "Seguí las instrucciones para crear una nueva contraseña",
      body,
    }),
    text,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. password_changed
// ═══════════════════════════════════════════════════════════════════════════════

export function renderPasswordChanged(vars: {
  userName?: string;
  changedAt?: Date;
  ip?: string;
  appUrl?: string;
}): RenderedEmail {
  const name  = esc(vars.userName ?? "Usuario");
  const time  = formatDateEs(vars.changedAt ?? new Date());
  const ip    = vars.ip ? `${esc(vars.ip.substring(0, 20))}...` : "desconocido";
  const url   = esc(vars.appUrl ?? process.env["APP_URL"] ?? "");

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Tu contraseña fue cambiada exitosamente.</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Fecha y hora</span>
        <span class="info-value">${time}</span>
      </div>
      <div class="info-row">
        <span class="info-label">IP de origen</span>
        <span class="info-value">${ip}</span>
      </div>
    </div>
    <p class="text-muted">Si fuiste vos quien realizó este cambio, podés ignorar este mensaje.</p>
    <div class="security-notice">
      ⚠️ Si <strong>no realizaste</strong> este cambio, tu cuenta puede estar comprometida. Contactá al administrador del sistema inmediatamente.
    </div>
    ${url ? `<div class="cta-wrapper"><a class="cta" href="${url}/sign-in">Ingresar a mi cuenta</a></div>` : ""}`;

  return {
    subject: "Tu contraseña fue cambiada — Dashboard Estudio",
    html: baseHtml({
      preheader: "Tu contraseña fue cambiada. Si no fuiste vos, actuá inmediatamente.",
      headerBg: "#0f766e",
      headerTitle: "Contraseña cambiada",
      headerSubtitle: "Tu contraseña se actualizó correctamente",
      body,
    }),
    text: `Tu contraseña fue cambiada\n\nHola ${vars.userName ?? "Usuario"},\n\nTu contraseña fue cambiada el ${time} desde la IP ${ip}.\n\nSi no realizaste este cambio, contactá al administrador inmediatamente.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. due_date_alert
// ═══════════════════════════════════════════════════════════════════════════════

const SEMAFORO_STYLES: Record<string, { badge: string; color: string; label: string }> = {
  rojo:     { badge: "badge-red",   color: "#dc2626", label: "🔴 URGENTE" },
  amarillo: { badge: "badge-amber", color: "#d97706", label: "🟡 PRÓXIMO" },
  verde:    { badge: "badge-green", color: "#16a34a", label: "🟢 A TIEMPO" },
  gris:     { badge: "badge-gray",  color: "#64748b", label: "⚪ INFO" },
};

export function renderDueDateAlert(vars: {
  userName?: string;
  clientName: string;
  taxLabel: string;
  dueDate: string;
  daysRemaining: number;
  trafficLight: string;
  alertType: string;
  appUrl?: string;
}): RenderedEmail {
  const name  = esc(vars.userName ?? "Usuario");
  const sema  = SEMAFORO_STYLES[vars.trafficLight] ?? SEMAFORO_STYLES["gris"]!;
  const days  = vars.daysRemaining;
  const dayText = days < 0
    ? `Venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? "s" : ""}`
    : days === 0 ? "Vence HOY"
    : `Faltan ${days} día${days !== 1 ? "s" : ""}`;

  const url   = esc(vars.appUrl ?? process.env["APP_URL"] ?? "");
  const headerBg = vars.trafficLight === "rojo" ? "#7f1d1d"
    : vars.trafficLight === "amarillo" ? "#78350f"
    : "#1e3a5f";

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Hay un vencimiento impositivo que requiere tu atención:</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Estado</span>
        <span class="info-value"><span class="badge ${sema.badge}">${sema.label}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Cliente</span>
        <span class="info-value">${esc(vars.clientName)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Obligación</span>
        <span class="info-value">${esc(vars.taxLabel)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Vencimiento</span>
        <span class="info-value" style="color:${sema.color};font-weight:700">${esc(vars.dueDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tiempo</span>
        <span class="info-value" style="font-weight:600">${dayText}</span>
      </div>
    </div>
    ${url ? `<div class="cta-wrapper"><a class="cta" href="${url}/dashboard/due-dates">Ver en el Dashboard</a></div>` : ""}`;

  const alertLabels: Record<string, string> = {
    reminder_7d: "Recordatorio — 7 días",
    reminder_3d: "Recordatorio — 3 días",
    reminder_1d: "Vence mañana",
    due_today:   "Vence hoy",
    overdue:     "VENCIDO",
  };

  return {
    subject: `${sema.label} — ${vars.taxLabel} · ${vars.clientName} · ${vars.dueDate}`,
    html: baseHtml({
      preheader: `${dayText} — ${vars.taxLabel} para ${vars.clientName}`,
      headerBg,
      headerTitle: alertLabels[vars.alertType] ?? "Alerta de vencimiento",
      headerSubtitle: `${vars.taxLabel} — ${vars.clientName}`,
      body,
    }),
    text: `${alertLabels[vars.alertType] ?? "Alerta"}\n\nCliente: ${vars.clientName}\nObligación: ${vars.taxLabel}\nFecha: ${vars.dueDate}\nEstado: ${dayText}\n\nVer en: ${url}/dashboard/due-dates`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. news_alert
// ═══════════════════════════════════════════════════════════════════════════════

export function renderNewsAlert(vars: {
  userName?: string;
  articles: Array<{ title: string; source: string; url: string; summary?: string; category?: string }>;
  frequency?: string;
  appUrl?: string;
}): RenderedEmail {
  const name    = esc(vars.userName ?? "Usuario");
  const items   = vars.articles.slice(0, 5);
  const url     = esc(vars.appUrl ?? process.env["APP_URL"] ?? "");

  const articlesHtml = items.map(a => `
    <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #e2e8f0">
      ${a.category ? `<span class="badge badge-blue" style="margin-bottom:8px">${esc(a.category)}</span>` : ""}
      <p style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:6px;line-height:1.4">
        <a href="${esc(a.url)}" style="color:#1e40af;text-decoration:none">${esc(a.title)}</a>
      </p>
      ${a.summary ? `<p style="font-size:13px;color:#475569;line-height:1.5">${esc(a.summary)}</p>` : ""}
      <p style="font-size:12px;color:#94a3b8;margin-top:6px">${esc(a.source)}</p>
    </div>`).join("");

  const freqLabel = vars.frequency === "weekly" ? "resumen semanal"
    : vars.frequency === "daily" ? "resumen diario"
    : "alerta inmediata";

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Este es tu ${freqLabel} de noticias relevantes para el sector:</p>
    <div style="margin:28px 0">${articlesHtml}</div>
    ${url ? `<div class="cta-wrapper"><a class="cta" href="${url}/dashboard/news">Ver todas las noticias</a></div>` : ""}`;

  return {
    subject: `Noticias relevantes — ${new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long" })}`,
    html: baseHtml({
      preheader: `${items.length} noticia${items.length !== 1 ? "s" : ""} relevante${items.length !== 1 ? "s" : ""} para vos`,
      headerBg: "#1e3a8a",
      headerTitle: "Noticias Relevantes",
      headerSubtitle: `${items.length} artículo${items.length !== 1 ? "s" : ""} seleccionado${items.length !== 1 ? "s" : ""}`,
      body,
    }),
    text: `Noticias Relevantes\n\n${items.map(a => `• ${a.title}\n  ${a.source}\n  ${a.url}`).join("\n\n")}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. dollar_alert
// ═══════════════════════════════════════════════════════════════════════════════

export function renderDollarAlert(vars: {
  userName?: string;
  market: string;        // "blue" | "mep" | "oficial"
  currentValue: number;
  previousValue: number;
  changePct: number;     // negative = bajó
  direction: "up" | "down";
  triggeredAt?: Date;
  appUrl?: string;
}): RenderedEmail {
  const name      = esc(vars.userName ?? "Usuario");
  const market    = esc(vars.market.toUpperCase());
  const direction = vars.direction === "up" ? "subió" : "bajó";
  const arrow     = vars.direction === "up" ? "↑" : "↓";
  const color     = vars.direction === "up" ? "#dc2626" : "#16a34a";
  const badge     = vars.direction === "up" ? "badge-red" : "badge-green";
  const url       = esc(vars.appUrl ?? process.env["APP_URL"] ?? "");
  const time      = formatDateEs(vars.triggeredAt ?? new Date());

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">El dólar <strong>${market}</strong> ${direction} más del umbral configurado:</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Mercado</span>
        <span class="info-value">${market}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Variación</span>
        <span class="info-value"><span class="badge ${badge}">${arrow} ${Math.abs(vars.changePct).toFixed(2)}%</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Valor actual</span>
        <span class="info-value" style="color:${color};font-weight:700;font-size:18px">$${vars.currentValue.toFixed(2)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Valor anterior</span>
        <span class="info-value">$${vars.previousValue.toFixed(2)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Momento</span>
        <span class="info-value">${time}</span>
      </div>
    </div>`;

  return {
    subject: `${arrow} Dólar ${market} ${direction} ${Math.abs(vars.changePct).toFixed(1)}% — $${vars.currentValue.toFixed(2)}`,
    html: baseHtml({
      preheader: `Dólar ${market}: $${vars.currentValue.toFixed(2)} (${arrow}${Math.abs(vars.changePct).toFixed(1)}%)`,
      headerBg: vars.direction === "up" ? "#7f1d1d" : "#14532d",
      headerTitle: `${arrow} Dólar ${market}`,
      headerSubtitle: `$${vars.currentValue.toFixed(2)} · Variación ${arrow}${Math.abs(vars.changePct).toFixed(1)}%`,
      body,
    }),
    text: `Alerta Dólar ${market}\n\nValor actual: $${vars.currentValue.toFixed(2)}\nVariación: ${arrow}${Math.abs(vars.changePct).toFixed(1)}%\nMomento: ${time}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. login_alert
// ═══════════════════════════════════════════════════════════════════════════════

export function renderLoginAlert(vars: {
  userName?: string;
  email: string;
  loginAt?: Date;
  ip?: string;
  userAgent?: string;
  isNewDevice?: boolean;
  isSuspicious?: boolean;
  location?: string;
  appUrl?: string;
}): RenderedEmail {
  const name      = esc(vars.userName ?? "Usuario");
  const time      = formatDateEs(vars.loginAt ?? new Date());
  const ip        = vars.ip ? `${esc(vars.ip.substring(0, 20))}...` : "desconocida";
  const ua        = esc(vars.userAgent?.substring(0, 80) ?? "Desconocido");
  const loc       = esc(vars.location ?? "Ubicación no disponible");
  const url       = esc(vars.appUrl ?? process.env["APP_URL"] ?? "");
  const suspicious = vars.isSuspicious ?? false;
  const newDevice  = vars.isNewDevice ?? false;

  const badge = suspicious ? `<span class="badge badge-red">⚠️ Sospechoso</span>`
    : newDevice ? `<span class="badge badge-amber">📱 Nuevo dispositivo</span>`
    : `<span class="badge badge-green">✅ Normal</span>`;

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Se detectó un acceso a tu cuenta${suspicious ? " que podría ser sospechoso" : newDevice ? " desde un dispositivo nuevo" : ""}.</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Estado</span>
        <span class="info-value">${badge}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Cuenta</span>
        <span class="info-value">${esc(vars.email)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Fecha y hora</span>
        <span class="info-value">${time}</span>
      </div>
      <div class="info-row">
        <span class="info-label">IP (parcial)</span>
        <span class="info-value">${ip}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Navegador</span>
        <span class="info-value">${ua}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Ubicación</span>
        <span class="info-value">${loc}</span>
      </div>
    </div>
    <p class="text-muted">Si fuiste vos, no hace falta que hagas nada.</p>
    ${suspicious ? `<div class="security-notice">⚠️ <strong>Este acceso parece sospechoso.</strong> Si no fuiste vos, cambiá tu contraseña inmediatamente y contactá al administrador.</div>` : ""}
    ${url ? `<div class="cta-wrapper"><a class="cta" href="${url}/sign-in">Acceder a mi cuenta</a></div>` : ""}`;

  const subjectPrefix = suspicious ? "⚠️ Acceso sospechoso"
    : newDevice ? "📱 Nuevo dispositivo detectado"
    : "✅ Nuevo acceso";

  return {
    subject: `${subjectPrefix} — Dashboard Estudio`,
    html: baseHtml({
      preheader: `${suspicious ? "Acceso sospechoso" : newDevice ? "Dispositivo nuevo" : "Acceso"} el ${time}`,
      headerBg: suspicious ? "#7f1d1d" : newDevice ? "#78350f" : "#1e3a5f",
      headerTitle: suspicious ? "Acceso sospechoso detectado"
        : newDevice ? "Acceso desde nuevo dispositivo"
        : "Nuevo acceso a tu cuenta",
      headerSubtitle: time,
      body,
    }),
    text: `Acceso a tu cuenta\n\nFecha: ${time}\nIP: ${ip}\nNavegador: ${vars.userAgent ?? "desconocido"}${suspicious ? "\n\n⚠️ Este acceso parece sospechoso. Si no fuiste vos, cambiá tu contraseña." : ""}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. test_email
// ═══════════════════════════════════════════════════════════════════════════════

export function renderTestEmail(vars: {
  adminName?: string;
  sentAt?: Date;
  providerType?: string;
  senderEmail?: string;
}): RenderedEmail {
  const name   = esc(vars.adminName ?? "Administrador");
  const time   = formatDateEs(vars.sentAt ?? new Date());
  const prov   = esc(vars.providerType ?? "SMTP");
  const sender = esc(vars.senderEmail ?? "no-configurado");

  const body = `
    <p class="text">Hola ${name},</p>
    <p class="text">Este es un email de prueba del sistema de notificaciones del Dashboard.</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Estado</span>
        <span class="info-value"><span class="badge badge-green">✅ Entregado correctamente</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">Enviado el</span>
        <span class="info-value">${time}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Proveedor</span>
        <span class="info-value">${prov}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Remitente</span>
        <span class="info-value">${sender}</span>
      </div>
    </div>
    <p class="text-muted">Si recibiste este mensaje, la configuración de email del sistema está funcionando correctamente. Podés cerrar esta ventana.</p>`;

  return {
    subject: "✅ Email de prueba — Sistema funcionando correctamente",
    html: baseHtml({
      preheader: "Email de prueba enviado correctamente",
      headerBg: "#0f766e",
      headerTitle: "Email de prueba",
      headerSubtitle: "El sistema de email está configurado y funcionando",
      body,
    }),
    text: `Email de prueba\n\nSi recibiste este mensaje, el sistema de email está funcionando.\n\nFecha: ${time}\nProveedor: ${prov}`,
  };
}

// ── Template dispatcher ───────────────────────────────────────────────────────

export type TemplateKey =
  | "forgot_password_request"
  | "password_changed"
  | "due_date_alert"
  | "news_alert"
  | "dollar_alert"
  | "login_alert"
  | "test_email";

export function renderTemplate(key: TemplateKey, vars: Record<string, unknown>): RenderedEmail {
  switch (key) {
    case "forgot_password_request": return renderForgotPasswordRequest(vars as any);
    case "password_changed":        return renderPasswordChanged(vars as any);
    case "due_date_alert":          return renderDueDateAlert(vars as any);
    case "news_alert":              return renderNewsAlert(vars as any);
    case "dollar_alert":            return renderDollarAlert(vars as any);
    case "login_alert":             return renderLoginAlert(vars as any);
    case "test_email":              return renderTestEmail(vars as any);
    default:
      throw new Error(`Unknown template key: ${key}`);
  }
}
