import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import session from "express-session";
import ConnectPg from "connect-pg-simple";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { startScheduler } from "./jobs/scheduler.js";
import { seedDefaultCategories } from "./lib/seed.js";
import { seedCalendar2026, patchCalendar2026FullRules } from "./lib/seed-calendar-2026.js";
import { seedModules, bootstrapSuperAdmin } from "./lib/seed-modules.js";
import { seedWidgetCatalog } from "./lib/studio-widget-catalog.js";
import { seedDashboardTemplates } from "./lib/studio-templates.js";

// ── Startup timestamp para uptime en /health ──────────────────────────────────
const STARTED_AT = new Date().toISOString();

// ── CJS/ESM interop: connect-pg-simple ───────────────────────────────────────
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
      // sameSite "none" + secure:true requerido para cookies cross-domain
      // (frontend en Vercel, backend en Railway — dominios distintos en producción).
      // En desarrollo local se usa "lax" para evitar requerir HTTPS.
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
      sameSite:
        process.env.NODE_ENV === "production"
          ? ("none" as const)
          : ("lax" as const),
    },
  } satisfies session.SessionOptions,
);

const app: Express = express();

// ── Trust proxy ───────────────────────────────────────────────────────────────
// Railway y Vercel ponen un proxy delante del servidor.
// Necesario para que express-rate-limit use la IP real del cliente
// y para que las cookies secure funcionen correctamente.
app.set("trust proxy", 1);

// ── Logging HTTP ──────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    // Silenciar logs del healthcheck para no ensuciar los logs de Railway
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : null;

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, curl, Railway healthcheck)
      if (!origin) return callback(null, true);
      // Sin restricción de origins si ALLOWED_ORIGINS no está configurada
      if (!ALLOWED_ORIGINS) return callback(null, true);
      if (ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed))) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} bloqueado por CORS`));
    },
  }),
);

// ── GET /health ───────────────────────────────────────────────────────────────
// CRÍTICO: debe registrarse ANTES del rate limiter, session y auth middleware.
// Railway usa este endpoint para determinar que el servicio levantó correctamente.
// No requiere autenticación. No toca la DB (responde aunque la DB esté caída).
// railway.json: "healthcheckPath": "/health"
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "mycontroldash-api",
    environment: process.env.NODE_ENV ?? "development",
    startedAt: STARTED_AT,
    timestamp: new Date().toISOString(),
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  // Skipear /health para no consumir cuota del limiter en healthchecks
  skip: (req) => req.path === "/health",
  message: {
    error: "Demasiadas solicitudes. Intentá de nuevo en 15 minutos.",
  },
});

const sensitiveActionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Límite de acciones sensibles alcanzado. Esperá 15 minutos.",
  },
});

// ── Clerk proxy ───────────────────────────────────────────────────────────────
// El backend actúa de proxy para Clerk para evitar CORS desde el frontend.
// CLERK_PROXY_PATH = "/__clerk" (configurado en .env)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Sesión y autenticación ────────────────────────────────────────────────────
app.use(sessionMiddleware);
app.use(clerkMiddleware());

// ── Rutas con rate limiting ───────────────────────────────────────────────────
app.use("/api", generalLimiter);

// Endpoints sensibles con límite más estricto
app.use("/api/users/:id/block",                sensitiveActionsLimiter);
app.use("/api/users/:id/unblock",              sensitiveActionsLimiter);
app.use("/api/users/:id/promote-super-admin",  sensitiveActionsLimiter);
app.use("/api/modules/:key/toggle",            sensitiveActionsLimiter);

// ── Router principal ──────────────────────────────────────────────────────────
app.use("/api", router);

// ── Error handler global ──────────────────────────────────────────────────────
// Captura cualquier error no manejado en las rutas y devuelve 500 estructurado
app.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    // Express requiere 4 parámetros en el error handler aunque next no se use
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, "Error no manejado en Express");
    res.status(500).json({
      error: "Error interno del servidor",
      ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
    });
  },
);

// ── Seeds y scheduler de background ──────────────────────────────────────────
// Todos los seeds se ejecutan con .catch() para que un fallo no rompa el startup.
// startScheduler() arranca los cron jobs (cotizaciones, noticias, alertas AFIP).
startScheduler();

seedDefaultCategories().catch((err: unknown) => {
  logger.error({ err }, "seedDefaultCategories falló");
});

seedCalendar2026()
  .then(() => patchCalendar2026FullRules())
  .catch((err: unknown) => {
    logger.error({ err }, "seedCalendar2026 falló");
  });

seedModules().catch((err: unknown) => {
  logger.error({ err }, "seedModules falló");
});

bootstrapSuperAdmin().catch((err: unknown) => {
  logger.error({ err }, "bootstrapSuperAdmin falló");
});

seedWidgetCatalog().catch((err: unknown) => {
  logger.error({ err }, "seedWidgetCatalog falló");
});

seedDashboardTemplates().catch((err: unknown) => {
  logger.error({ err }, "seedDashboardTemplates falló");
});

export default app;
