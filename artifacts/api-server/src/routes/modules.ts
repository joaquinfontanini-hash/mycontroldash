import { Router, type IRouter, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, modulesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/require-auth.js";
import { logSecurityEvent, getClientIp } from "../lib/security-logger.js";
import { AuthenticatedRequest } from "../middleware/require-auth.js";

const router: IRouter = Router();

router.get("/modules", async (_req: Request, res: Response): Promise<void> => {
  try {
    const modules = await db.select().from(modulesTable).orderBy(modulesTable.orderIndex);
    res.json(modules);
  } catch (err) {
    logger.error({ err }, "Modules fetch error");
    res.status(500).json({ error: "Error al cargar módulos" });
  }
});

router.put("/modules/:key/toggle", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params.key as string;
    const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.key, key));
    if (!mod) { res.status(404).json({ error: "Módulo no encontrado" }); return; }
    const [updated] = await db.update(modulesTable)
      .set({ isActive: !mod.isActive })
      .where(eq(modulesTable.key, key))
      .returning();
    const actor = (req as AuthenticatedRequest).dbUser;
    await logSecurityEvent({
      actorClerkId: actor?.clerkId,
      actorEmail: actor?.email,
      action: updated.isActive ? "module_activated" : "module_deactivated",
      module: key,
      result: "success",
      metadata: { moduleName: mod.name },
      ipAddress: getClientIp(req as any),
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Module toggle error");
    res.status(500).json({ error: "Error al actualizar módulo" });
  }
});

router.put("/modules/:key/roles", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params.key as string;
    const { allowedRoles } = req.body;
    if (!Array.isArray(allowedRoles)) { res.status(400).json({ error: "allowedRoles debe ser un array" }); return; }
    const [updated] = await db.update(modulesTable)
      .set({ allowedRoles })
      .where(eq(modulesTable.key, key))
      .returning();
    if (!updated) { res.status(404).json({ error: "Módulo no encontrado" }); return; }
    const actor = (req as AuthenticatedRequest).dbUser;
    await logSecurityEvent({
      actorClerkId: actor?.clerkId,
      actorEmail: actor?.email,
      action: "module_roles_updated",
      module: key,
      result: "success",
      metadata: { allowedRoles },
      ipAddress: getClientIp(req as any),
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Module roles update error");
    res.status(500).json({ error: "Error al actualizar roles" });
  }
});

export default router;
