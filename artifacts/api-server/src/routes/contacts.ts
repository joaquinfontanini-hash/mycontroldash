import { Router, type IRouter, Request, Response } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, usersTable, userProfilesTable } from "@workspace/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/require-auth.js";
import { requireAdmin } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function getUsersWithProfiles() {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  const profiles = await db.select().from(userProfilesTable);
  const profileMap = new Map(profiles.map(p => [p.userId, p]));
  return users.map(u => ({ ...u, profile: profileMap.get(u.id) ?? null }));
}

router.get("/contacts", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await getUsersWithProfiles();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "contacts fetch error");
    res.status(500).json({ error: "Error al cargar contactos" });
  }
});

router.get("/contacts/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).dbUser.id;
  try {
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    res.json(profile ?? null);
  } catch (err) {
    logger.error({ err }, "contacts/me fetch error");
    res.status(500).json({ error: "Error al cargar perfil" });
  }
});

router.patch("/contacts/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).dbUser.id;
  const { phone, bio, avatarUrl, area } = req.body ?? {};

  const patch: Partial<{ phone: string; bio: string; avatarUrl: string; area: string }> = {};
  if (phone !== undefined) patch.phone = typeof phone === "string" ? phone.slice(0, 50) : "";
  if (bio !== undefined) patch.bio = typeof bio === "string" ? bio.slice(0, 500) : "";
  if (avatarUrl !== undefined) patch.avatarUrl = typeof avatarUrl === "string" ? avatarUrl.slice(0, 500) : "";
  if (area !== undefined) patch.area = typeof area === "string" ? area.slice(0, 100) : "";

  try {
    const [existing] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    if (existing) {
      const [updated] = await db
        .update(userProfilesTable)
        .set(patch)
        .where(eq(userProfilesTable.userId, userId))
        .returning();
      res.json(updated);
    } else {
      const [inserted] = await db
        .insert(userProfilesTable)
        .values({ userId, ...patch })
        .returning();
      res.json(inserted);
    }
  } catch (err) {
    logger.error({ err }, "contacts/me patch error");
    res.status(500).json({ error: "Error al guardar perfil" });
  }
});

router.patch("/contacts/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const targetId = parseInt(String(req.params.id ?? ""));
  if (isNaN(targetId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const { phone, bio, avatarUrl, area, name } = req.body ?? {};

  try {
    if (name !== undefined && typeof name === "string") {
      await db
        .update(usersTable)
        .set({ name: name.slice(0, 200) })
        .where(eq(usersTable.id, targetId));
    }

    const patch: Partial<{ phone: string; bio: string; avatarUrl: string; area: string }> = {};
    if (phone !== undefined) patch.phone = typeof phone === "string" ? phone.slice(0, 50) : "";
    if (bio !== undefined) patch.bio = typeof bio === "string" ? bio.slice(0, 500) : "";
    if (avatarUrl !== undefined) patch.avatarUrl = typeof avatarUrl === "string" ? avatarUrl.slice(0, 500) : "";
    if (area !== undefined) patch.area = typeof area === "string" ? area.slice(0, 100) : "";

    if (Object.keys(patch).length > 0) {
      const [existing] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, targetId));
      if (existing) {
        await db.update(userProfilesTable).set(patch).where(eq(userProfilesTable.userId, targetId));
      } else {
        await db.insert(userProfilesTable).values({ userId: targetId, ...patch });
      }
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, targetId));
    res.json({ ...user, profile: profile ?? null });
  } catch (err) {
    logger.error({ err }, "contacts/:id patch error");
    res.status(500).json({ error: "Error al actualizar contacto" });
  }
});

export default router;
