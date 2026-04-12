import { Router, type IRouter, Request, Response } from "express";
import { eq, and, inArray, desc, or, isNull, isNotNull } from "drizzle-orm";
import {
  db, usersTable, userProfilesTable,
  conversationsTable, conversationParticipantsTable, messagesTable,
} from "@workspace/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/require-auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function assertParticipant(conversationId: number, userId: number): Promise<boolean> {
  const [p] = await db
    .select()
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId),
      ),
    );
  return !!p;
}

async function enrichConversations(convIds: number[], meId: number) {
  if (convIds.length === 0) return [];

  const allParticipants = await db
    .select()
    .from(conversationParticipantsTable)
    .where(inArray(conversationParticipantsTable.conversationId, convIds));

  const userIds = [...new Set(allParticipants.map(p => p.userId))];
  const users = userIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const profiles = userIds.length > 0
    ? await db.select().from(userProfilesTable).where(inArray(userProfilesTable.userId, userIds))
    : [];

  const userMap = new Map(users.map(u => [u.id, u]));
  const profileMap = new Map(profiles.map(p => [p.userId, p]));

  const lastMessages = convIds.length > 0
    ? await db
        .select()
        .from(messagesTable)
        .where(and(
          inArray(messagesTable.conversationId, convIds),
          eq(messagesTable.isDeleted, false),
        ))
        .orderBy(desc(messagesTable.createdAt))
    : [];

  const lastMsgMap = new Map<number, typeof lastMessages[0]>();
  for (const m of lastMessages) {
    if (!lastMsgMap.has(m.conversationId)) {
      lastMsgMap.set(m.conversationId, m);
    }
  }

  const unreadCounts = new Map<number, number>();
  for (const p of allParticipants) {
    if (p.userId !== meId) continue;
    const after = p.lastReadAt;
    const msgs = lastMessages.filter(
      m => m.conversationId === p.conversationId &&
           m.senderId !== meId &&
           (!after || m.createdAt > after),
    );
    unreadCounts.set(p.conversationId, msgs.length);
  }

  const myParticipant = new Map<number, typeof allParticipants[0]>();
  for (const p of allParticipants) {
    if (p.userId === meId) myParticipant.set(p.conversationId, p);
  }

  return convIds.map(cid => {
    const participants = allParticipants
      .filter(p => p.conversationId === cid)
      .map(p => ({
        ...p,
        user: (() => {
          const u = userMap.get(p.userId);
          if (!u) return null;
          return { ...u, profile: profileMap.get(p.userId) ?? null };
        })(),
      }));
    return {
      id: cid,
      participants,
      lastMessage: lastMsgMap.get(cid) ?? null,
      unreadCount: unreadCounts.get(cid) ?? 0,
      myParticipant: myParticipant.get(cid) ?? null,
    };
  });
}

router.get("/conversations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  try {
    const myConvs = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, meId));

    const convIds = myConvs.map(c => c.conversationId);
    if (convIds.length === 0) {
      res.json([]);
      return;
    }

    const conversations = await db
      .select()
      .from(conversationsTable)
      .where(inArray(conversationsTable.id, convIds))
      .orderBy(desc(conversationsTable.updatedAt));

    const enriched = await enrichConversations(conversations.map(c => c.id), meId);
    const convMap = new Map(conversations.map(c => [c.id, c]));

    const result = enriched.map(e => ({
      ...convMap.get(e.id),
      ...e,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "conversations fetch error");
    res.status(500).json({ error: "Error al cargar conversaciones" });
  }
});

router.post("/conversations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  const { targetUserId, type = "direct" } = req.body ?? {};

  if (!targetUserId || typeof targetUserId !== "number") {
    res.status(400).json({ error: "targetUserId es requerido" });
    return;
  }

  try {
    if (type === "direct") {
      const myConvs = await db
        .select()
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.userId, meId));
      const myConvIds = myConvs.map(c => c.conversationId);

      if (myConvIds.length > 0) {
        const theirConvs = await db
          .select()
          .from(conversationParticipantsTable)
          .where(
            and(
              eq(conversationParticipantsTable.userId, targetUserId),
              inArray(conversationParticipantsTable.conversationId, myConvIds),
            ),
          );

        for (const tc of theirConvs) {
          const [conv] = await db
            .select()
            .from(conversationsTable)
            .where(and(eq(conversationsTable.id, tc.conversationId), eq(conversationsTable.type, "direct")));
          if (conv) {
            const [enriched] = await enrichConversations([conv.id], meId);
            res.json({ ...conv, ...enriched, existing: true });
            return;
          }
        }
      }
    }

    const [conv] = await db.insert(conversationsTable).values({ type }).returning();
    if (!conv) throw new Error("Failed to create conversation");

    await db.insert(conversationParticipantsTable).values([
      { conversationId: conv.id, userId: meId },
      { conversationId: conv.id, userId: targetUserId },
    ]);

    const [enriched] = await enrichConversations([conv.id], meId);
    res.status(201).json({ ...conv, ...enriched, existing: false });
  } catch (err) {
    logger.error({ err }, "create conversation error");
    res.status(500).json({ error: "Error al crear conversación" });
  }
});

router.get("/conversations/unread", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  try {
    const myConvs = await db
      .select()
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, meId));

    let total = 0;
    for (const p of myConvs) {
      const after = p.lastReadAt;
      let msgs;
      if (after) {
        msgs = await db
          .select({ id: messagesTable.id })
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.conversationId, p.conversationId),
              eq(messagesTable.isDeleted, false),
            ),
          );
        msgs = msgs.filter(m => {
          return true;
        });
      }
      const allMsgs = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.conversationId, p.conversationId),
            eq(messagesTable.isDeleted, false),
          ),
        );
      const unread = allMsgs.filter(
        m => m.senderId !== meId && (!after || m.createdAt > after),
      );
      total += unread.length;
    }

    res.json({ total });
  } catch (err) {
    logger.error({ err }, "unread count error");
    res.status(500).json({ error: "Error al contar mensajes" });
  }
});

router.get("/conversations/:id/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  const convId = parseInt(String(req.params.id ?? ""));
  if (isNaN(convId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const isParticipant = await assertParticipant(convId, meId);
  if (!isParticipant) {
    res.status(403).json({ error: "Sin acceso a esta conversación" });
    return;
  }

  try {
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, convId),
        eq(messagesTable.isDeleted, false),
      ))
      .orderBy(desc(messagesTable.createdAt))
      .limit(100);

    const senderIds = [...new Set(msgs.map(m => m.senderId))];
    const senders = senderIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
      : [];
    const senderProfiles = senderIds.length > 0
      ? await db.select().from(userProfilesTable).where(inArray(userProfilesTable.userId, senderIds))
      : [];

    const senderMap = new Map(senders.map(u => [u.id, u]));
    const profileMap = new Map(senderProfiles.map(p => [p.userId, p]));

    const enriched = msgs
      .map(m => ({
        ...m,
        sender: senderMap.get(m.senderId)
          ? { ...senderMap.get(m.senderId)!, profile: profileMap.get(m.senderId) ?? null }
          : null,
        isMe: m.senderId === meId,
      }))
      .reverse();

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "messages fetch error");
    res.status(500).json({ error: "Error al cargar mensajes" });
  }
});

router.post("/conversations/:id/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  const convId = parseInt(String(req.params.id ?? ""));
  if (isNaN(convId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const isParticipant = await assertParticipant(convId, meId);
  if (!isParticipant) {
    res.status(403).json({ error: "Sin acceso a esta conversación" });
    return;
  }

  const { content } = req.body ?? {};
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "El mensaje no puede estar vacío" });
    return;
  }
  if (content.length > 5000) {
    res.status(400).json({ error: "Mensaje demasiado largo (máx 5000 caracteres)" });
    return;
  }

  try {
    const [msg] = await db
      .insert(messagesTable)
      .values({ conversationId: convId, senderId: meId, content: content.trim() })
      .returning();

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, convId));

    await db
      .update(conversationParticipantsTable)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, convId),
          eq(conversationParticipantsTable.userId, meId),
        ),
      );

    const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, meId));
    const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, meId));

    res.status(201).json({
      ...msg,
      sender: sender ? { ...sender, profile: profile ?? null } : null,
      isMe: true,
    });
  } catch (err) {
    logger.error({ err }, "send message error");
    res.status(500).json({ error: "Error al enviar mensaje" });
  }
});

router.put("/conversations/:id/read", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const meId = (req as AuthenticatedRequest).dbUser.id;
  const convId = parseInt(String(req.params.id ?? ""));
  if (isNaN(convId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const isParticipant = await assertParticipant(convId, meId);
  if (!isParticipant) {
    res.status(403).json({ error: "Sin acceso a esta conversación" });
    return;
  }

  try {
    await db
      .update(conversationParticipantsTable)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, convId),
          eq(conversationParticipantsTable.userId, meId),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "mark read error");
    res.status(500).json({ error: "Error al marcar como leído" });
  }
});

export default router;
