import { Router, type IRouter } from "express";
import { requireModule } from "../middleware/require-auth.js";
import authRouter from "./auth";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import shortcutsRouter from "./shortcuts";
import fiscalRouter from "./fiscal";
import travelRouter from "./travel";
import newsRouter from "./news";
import emailsRouter from "./emails";
import weatherRouter from "./weather";
import settingsRouter from "./settings";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import syncRouter from "./sync";
import currencyRouter from "./currency";
import dueDatesRouter from "./due-dates";
import externalSourcesRouter from "./external-sources";
import clientsRouter from "./clients";
import annualCalendarsRouter from "./annual-calendars";
import supplierBatchesRouter from "./supplier-batches";
import modulesRouter from "./modules";
import securityLogsRouter from "./security-logs";
import financeRouter from "./finance";
import goalsRouter from "./goals";
import userSettingsRouter from "./user-settings";
import contactsRouter from "./contacts";
import chatRouter from "./chat";
import registrationRequestsRouter from "./registration-requests";
import fiscalAdminRouter from "./fiscal-admin";
import passwordResetRouter from "./password-reset";
import adminEmailRouter from "./admin-email";
import notificationsRouter from "./notifications";
import inAppNotificationsRouter from "./in-app-notifications";
import preferencesRouter from "./preferences";
import studioRouter from "./studio";

const router: IRouter = Router();

// ── Public / infra routes (no module guard) ────────────────────────────────────
router.use(authRouter);
router.use(healthRouter);
router.use(modulesRouter);
router.use(registrationRequestsRouter);
router.use(syncRouter);
router.use(currencyRouter);
router.use(externalSourcesRouter);
router.use(securityLogsRouter);
router.use(settingsRouter);
router.use(usersRouter);
router.use(userSettingsRouter);

// ── Email, notifications, password reset (public + auth guarded) ───────────────
router.use(passwordResetRouter);             // POST /auth/forgot-password, GET+POST /auth/reset-password
router.use(adminEmailRouter);                // GET/POST /admin/email-provider/*, GET /admin/email-logs
router.use(notificationsRouter);             // GET/PATCH /me/notification-preferences
router.use("/notifications", inAppNotificationsRouter);   // GET /notifications, PATCH /:id/read
router.use("/me/preferences", preferencesRouter);         // GET/PUT /me/preferences/:key

// ── Module-guarded routes ──────────────────────────────────────────────────────
// Pattern: guard middleware applied to matching path prefix (no sub-router path
// stripping), then the actual sub-router mounted without a path prefix so that
// its own route definitions remain correct.

// Guards — only run when the request path starts with the given prefix
router.use("/dashboard", requireModule("dashboard"));
router.use("/tasks", requireModule("tasks"));
router.use("/shortcuts", requireModule("shortcuts"));
router.use("/fiscal", requireModule("fiscal"));
router.use("/travel", requireModule("travel"));
router.use("/news", requireModule("news"));
router.use("/emails", requireModule("emails"));
router.use("/weather", requireModule("weather"));
router.use(["/due-dates", "/due-date-categories"], requireModule("due-dates"));
router.use(["/tax-homologation", "/alert-logs", "/audit-logs"], requireModule("due-dates"));
router.use("/clients", requireModule("clients"));
router.use("/annual-calendars", requireModule("tax-calendars"));
router.use("/supplier-batches", requireModule("supplier-batches"));
router.use("/finance", requireModule("finance"));
router.use(["/daily-goals", "/strategy-goals"], requireModule("goals"));
router.use("/contacts", requireModule("contacts"));
router.use("/conversations", requireModule("chat"));
router.use("/studio", requireModule("dashboard_studio"));

// Sub-routers — mounted without path so their own route definitions are preserved
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

export default router;
