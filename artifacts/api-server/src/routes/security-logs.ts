import { Router, type IRouter } from "express";
import { desc, eq, and, gte, lte, like, or } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/security-logs", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { action, result, email, from, to, limit = "100" } = req.query as Record<string, string>;
    const conditions = [];
    if (action) conditions.push(like(securityLogsTable.action, `%${action}%`));
    if (result) conditions.push(eq(securityLogsTable.result, result));
    if (email) conditions.push(
      or(
        like(securityLogsTable.actorEmail, `%${email}%`),
        like(securityLogsTable.targetEmail, `%${email}%`)
      )!
    );
    if (from) conditions.push(gte(securityLogsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(securityLogsTable.createdAt, new Date(to)));

    const logs = await db.select().from(securityLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(securityLogsTable.createdAt))
      .limit(Math.min(parseInt(limit), 500));
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "Security logs fetch error");
    res.status(500).json({ error: "Error al cargar logs de seguridad" });
  }
});

export default router;
