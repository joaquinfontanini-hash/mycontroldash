import { Router, type IRouter } from "express";
import { requireModule } from "../middleware/require-auth.js";

// ── Routers de infraestructura (sin guard de módulo) ──────────────────────────
import authRouter               from "./auth.js";
import tasksRouter              from "./tasks.js";
import shortcutsRouter          from "./shortcuts.js";
import fiscalRouter             from "./fiscal.js";
import travelRouter             from "./travel.js";
import newsRouter               from "./news.js";
import emailsRouter             from "./emails.js";
import weatherRouter            from "./weather.js";
import settingsRouter           from "./settings.js";
import usersRouter              from "./users.js";
import dashboardRouter          from "./dashboard.js";
import syncRouter               from "./sync.js";
import currencyRouter           from "./currency.js";
import dueDatesRouter           from "./due-dates.js";
import externalSourcesRouter    from "./external-sources.js";
import clientsRouter            from "./clients.js";
import annualCalendarsRouter    from "./annual-calendars.js";
import supplierBatchesRouter    from "./supplier-batches.js";
import modulesRouter            from "./modules.js";
import securityLogsRouter       from "./security-logs.js";
import financeRouter            from "./finance.js";
import goalsRouter              from "./goals.js";
import userSettingsRouter       from "./user-settings.js";
import contactsRouter           from "./contacts.js";
import chatRouter               from "./chat.js";
import registrationRequestsRouter from "./registration-requests.js";
import fiscalAdminRouter        from "./fiscal-admin.js";
import passwordResetRouter      from "./password-reset.js";
import adminEmailRouter         from "./admin-email.js";
import notificationsRouter      from "./notifications.js";
import inAppNotificationsRouter from "./in-app-notifications.js";
import preferencesRouter        from "./preferences.js";
import studioRouter             from "./studio.js";
import quotesRouter             from "./quotes.js";
import bcraRouter               from "./bcra.js";

// Nota: GET /health está registrado en app.ts ANTES de este router,
// antes del rate limiter y de cualquier auth middleware.
// No necesita un healthRouter separado aquí.

const router: IRouter = Router();

// ── Rutas públicas / de infraestructura (sin guard de módulo) ─────────────────
router.use(authRouter);
router.use(modulesRouter);
router.use(registrationRequestsRouter);
router.use(syncRouter);
router.use(currencyRouter);
router.use(bcraRouter);
router.use(externalSourcesRouter);
router.use(securityLogsRouter);
router.use(settingsRouter);
router.use(usersRouter);
router.use(userSettingsRouter);

// ── Email, notificaciones, reset de contraseña ────────────────────────────────
router.use(passwordResetRouter);               // POST /auth/forgot-password, GET+POST /auth/reset-password
router.use(adminEmailRouter);                  // GET/POST /admin/email-provider/*, GET /admin/email-logs
router.use(notificationsRouter);               // GET/PATCH /me/notification-preferences
router.use("/notifications", inAppNotificationsRouter); // GET /notifications, PATCH /:id/read
router.use("/me/preferences", preferencesRouter);       // GET/PUT /me/preferences/:key

// ── Rutas con guard de módulo ─────────────────────────────────────────────────
// Patrón: requireModule actúa como middleware de prefijo — verifica que el módulo
// esté activo y que el rol del usuario tenga acceso ANTES de llegar al sub-router.
// Los sub-routers se montan sin prefijo de path para que sus definiciones internas
// permanezcan correctas (evita doble-prefijo con Router({ mergeParams: true })).

// Guards de módulo por prefijo de ruta
router.use("/dashboard",                                   requireModule("dashboard"));
router.use("/tasks",                                       requireModule("tasks"));
router.use("/shortcuts",                                   requireModule("shortcuts"));
router.use("/fiscal",                                      requireModule("fiscal"));
router.use("/travel",                                      requireModule("travel"));
router.use("/news",                                        requireModule("news"));
router.use("/emails",                                      requireModule("emails"));
router.use("/weather",                                     requireModule("weather"));
router.use(["/due-dates", "/due-date-categories"],         requireModule("due-dates"));
router.use(["/tax-homologation", "/alert-logs", "/audit-logs"], requireModule("due-dates"));
router.use("/clients",                                     requireModule("clients"));
router.use("/annual-calendars",                            requireModule("tax-calendars"));
router.use("/supplier-batches",                            requireModule("supplier-batches"));
router.use("/finance",                                     requireModule("finance"));
router.use(["/daily-goals", "/strategy-goals"],            requireModule("goals"));
router.use("/contacts",                                    requireModule("contacts"));
router.use("/conversations",                               requireModule("chat"));
router.use("/studio",                                      requireModule("dashboard_studio"));
router.use("/quotes",                                      requireModule("quotes"));

// Sub-routers montados sin prefijo (sus rutas internas ya incluyen el path completo)
router.use(dashboardRouter);
router.use(tasksRouter);
router.use(shortcutsRouter);
router.use(fiscalRouter);
router.use(travelRouter);
router.use(newsRouter);
router.use(emailsRouter);
router.use(weatherRouter);
router.use(dueDatesRouter);
router.use(clientsRouter);
router.use(annualCalendarsRouter);
router.use(supplierBatchesRouter);
router.use(financeRouter);
router.use(goalsRouter);
router.use(contactsRouter);
router.use(chatRouter);
router.use(fiscalAdminRouter);
router.use(studioRouter);
router.use(quotesRouter);

export default router;
