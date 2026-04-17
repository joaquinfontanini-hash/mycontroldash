import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import session from "express-session";
import ConnectPg from "connect-pg-simple";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { startScheduler } from "./jobs/scheduler.js";
import { seedDefaultCategories } from "./lib/seed.js";
import { seedCalendar2026, patchCalendar2026FullRules } from "./lib/seed-calendar-2026.js";
import { seedModules, bootstrapSuperAdmin } from "./lib/seed-modules.js";
import { seedWidgetCatalog } from "./lib/studio-widget-catalog.js";
import { seedDashboardTemplates } from "./lib/studio-templates.js";

// CJS/ESM interop: connect-pg-simple expects the express-session module reference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PgSession = ConnectPg(session as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionMiddleware = (session as any)(
  {
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET ?? "fallback-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      // Fix 2: sameSite "none" required for cross-domain cookie delivery
      // (frontend y backend están en dominios distintos en Replit autoscale).
      // "none" requiere secure:true (cumplido en producción).
      // En dev usamos "lax" (mismo dominio, no necesita "none").
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? ("none" as const) : ("lax" as const),
    },
  } satisfies session.SessionOptions,
);

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : null;

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!ALLOWED_ORIGINS) return callback(null, true);
      if (ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/healthz",
  message: { error: "Demasiadas solicitudes. Intentá de nuevo en 15 minutos." },
});

const sensitiveActionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Límite de acciones sensibles alcanzado. Esperá 15 minutos." },
});

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(sessionMiddleware);

app.use(clerkMiddleware());

app.use("/api", generalLimiter);
app.use("/api/users/:id/block", sensitiveActionsLimiter);
app.use("/api/users/:id/unblock", sensitiveActionsLimiter);
app.use("/api/users/:id/promote-super-admin", sensitiveActionsLimiter);
app.use("/api/modules/:key/toggle", sensitiveActionsLimiter);

app.use("/api", router);

startScheduler();
seedDefaultCategories();
seedCalendar2026().then(() => patchCalendar2026FullRules());
seedModules();
bootstrapSuperAdmin();
seedWidgetCatalog();
seedDashboardTemplates();

export default app;
