import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, externalFileSourcesTable } from "@workspace/db";

const router: IRouter = Router();

const VALID_TYPES = ["excel", "google_sheets", "csv", "other"] as const;
const VALID_STATUSES = ["pending", "connected", "error", "paused"] as const;

function validateSource(body: any): { error?: string } {
  if (!body || typeof body !== "object") return { error: "Body inválido" };
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return { error: "name debe ser un string no vacío" };
  }
  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return { error: `type debe ser uno de: ${VALID_TYPES.join(", ")}` };
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return { error: `status debe ser uno de: ${VALID_STATUSES.join(", ")}` };
  }
  if (body.url !== undefined && body.url !== "" && body.url !== null) {
    try { new URL(body.url); } catch { return { error: "URL inválida" }; }
  }
  return {};
}

router.get("/external-sources", async (_req, res): Promise<void> => {
  const sources = await db.select().from(externalFileSourcesTable).orderBy(externalFileSourcesTable.createdAt);
  res.json(sources);
});

router.post("/external-sources", async (req, res): Promise<void> => {
  const { error } = validateSource(req.body);
  if (error) { res.status(400).json({ error }); return; }
  const body = req.body;
  if (!body.name?.trim()) { res.status(400).json({ error: "name es requerido" }); return; }
  const [source] = await db.insert(externalFileSourcesTable).values({
    name: body.name.trim(),
    type: body.type ?? "excel",
    url: body.url ?? null,
    identifier: body.identifier ?? null,
    status: body.status ?? "pending",
    notes: body.notes ?? null,
    userId: body.userId ?? null,
  }).returning();
  res.status(201).json(source);
});

router.put("/external-sources/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { error } = validateSource(req.body);
  if (error) { res.status(400).json({ error }); return; }

  const body = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData["name"] = body.name.trim();
  if (body.type !== undefined) updateData["type"] = body.type;
  if (body.url !== undefined) updateData["url"] = body.url || null;
  if (body.identifier !== undefined) updateData["identifier"] = body.identifier;
  if (body.status !== undefined) updateData["status"] = body.status;
  if (body.notes !== undefined) updateData["notes"] = body.notes;

  const [updated] = await db.update(externalFileSourcesTable).set(updateData).where(eq(externalFileSourcesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/external-sources/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(externalFileSourcesTable).where(eq(externalFileSourcesTable.id, id));
  res.status(204).end();
});

export default router;
