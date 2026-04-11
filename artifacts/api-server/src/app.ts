import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./jobs/scheduler";
import { seedDefaultCategories } from "./lib/seed.js";
import { seedCalendar2026, patchGanancias2026 } from "./lib/seed-calendar-2026.js";
import { seedModules, bootstrapSuperAdmin } from "./lib/seed-modules.js";

const app: Express = express();

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

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
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

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware());

app.use("/api", generalLimiter);
app.use("/api/users/:id/block", sensitiveActionsLimiter);
app.use("/api/users/:id/unblock", sensitiveActionsLimiter);
app.use("/api/users/:id/promote-super-admin", sensitiveActionsLimiter);
app.use("/api/modules/:key/toggle", sensitiveActionsLimiter);

app.use("/api", router);

startScheduler();
seedDefaultCategories();
seedCalendar2026().then(() => patchGanancias2026());
seedModules();
bootstrapSuperAdmin();

export default app;
