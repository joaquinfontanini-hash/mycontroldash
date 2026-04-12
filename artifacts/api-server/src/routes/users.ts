import { Router, type IRouter, Request } from "express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdateUserBody, UpdateUserParams } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import { requireAdmin, requireSuperAdmin, AuthenticatedRequest } from "../middleware/require-auth.js";
import { logSecurityEvent, getClientIp } from "../lib/security-logger.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/users/me", async (req, res): Promise<void> => {
  const sessionUserId = req.session?.userId;
  if (sessionUserId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));
    if (!user || !user.isActive || user.isBlocked) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(user);
    return;
  }

  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
    res.json(users);
  } catch (err) {
    logger.error({ err }, "users list error");
    res.status(500).json({ error: "Error al cargar usuarios" });
  }
});

router.post("/users", async (req, res): Promise<void> => {
  const { clerkId, email, name } = req.body ?? {};
  if (!clerkId || typeof clerkId !== "string" || !email || typeof email !== "string") {
    res.status(400).json({ error: "clerkId y email son requeridos" });
    return;
  }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (existing) {
      res.json(existing);
      return;
    }
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
    const role = (superAdminEmail && email === superAdminEmail) ? "super_admin" : "viewer";
    const [user] = await db.insert(usersTable).values({
      clerkId,
      email,
      name: typeof name === "string" ? name : null,
      role,
    }).returning();
    await logSecurityEvent({
      actorClerkId: clerkId,
      actorEmail: email,
      action: "user_registered",
      result: "success",
      metadata: { role },
    });
    res.status(201).json(user);
  } catch (err) {
    logger.error({ err }, "user registration error");
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

router.patch("/users/:id", requireAdmin, async (req: Request, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = (req as AuthenticatedRequest).dbUser;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!target) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  if (target.role === "super_admin" && actor?.role !== "super_admin") {
    res.status(403).json({ error: "Solo el super_admin puede modificar a otro super_admin" });
    return;
  }
  if ((parsed.data as any).role === "super_admin" && actor?.role !== "super_admin") {
    res.status(403).json({ error: "Solo el super_admin puede otorgar ese rol" });
    return;
  }
  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await logSecurityEvent({
    actorClerkId: actor?.clerkId,
    actorEmail: actor?.email,
    targetClerkId: target.clerkId,
    targetEmail: target.email,
    action: "user_updated",
    result: "success",
    metadata: { changes: parsed.data },
    ipAddress: getClientIp(req),
  });
  res.json(user);
});

router.post("/users/:id/block", requireAdmin, async (req: Request, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { reason } = req.body;
    const actor = (req as AuthenticatedRequest).dbUser;
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!target) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    if (target.role === "super_admin") {
      res.status(403).json({ error: "No se puede bloquear al super_admin" });
      return;
    }
    if (actor?.id === id) {
      res.status(403).json({ error: "No podés bloquearte a vos mismo" });
      return;
    }
    const [updated] = await db.update(usersTable)
      .set({ isBlocked: true, blockedAt: new Date(), blockedReason: reason ?? null })
      .where(eq(usersTable.id, id))
      .returning();
    await logSecurityEvent({
      actorClerkId: actor?.clerkId,
      actorEmail: actor?.email,
      targetClerkId: target.clerkId,
      targetEmail: target.email,
      action: "user_blocked",
      result: "success",
      metadata: { reason },
      ipAddress: getClientIp(req),
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "block user error");
    res.status(500).json({ error: "Error al bloquear usuario" });
  }
});

router.post("/users/:id/unblock", requireAdmin, async (req: Request, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const actor = (req as AuthenticatedRequest).dbUser;
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!target) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    const [updated] = await db.update(usersTable)
      .set({ isBlocked: false, blockedAt: null, blockedReason: null })
      .where(eq(usersTable.id, id))
      .returning();
    await logSecurityEvent({
      actorClerkId: actor?.clerkId,
      actorEmail: actor?.email,
      targetClerkId: target.clerkId,
      targetEmail: target.email,
      action: "user_unblocked",
      result: "success",
      ipAddress: getClientIp(req),
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "unblock user error");
    res.status(500).json({ error: "Error al desbloquear usuario" });
  }
});

router.post("/users/:id/promote-super-admin", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const actor = (req as AuthenticatedRequest).dbUser;
    const [updated] = await db.update(usersTable)
      .set({ role: "super_admin" })
      .where(eq(usersTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    await logSecurityEvent({
      actorClerkId: actor?.clerkId,
      actorEmail: actor?.email,
      targetEmail: updated.email,
      action: "user_promoted_super_admin",
      result: "success",
      ipAddress: getClientIp(req),
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "promote super admin error");
    res.status(500).json({ error: "Error al promover usuario" });
  }
});

export default router;
