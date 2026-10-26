import { route } from "@/lib/api";
import { deleteConversation, getConversation } from "@/lib/ai/assistant";
import { uuidSchema } from "@/lib/validation";

type P = { id: string };

export const GET = route<P>(async (_req, { db }, { id }) => getConversation(db, uuidSchema.parse(id)));

export const DELETE = route<P>(async (_req, { db }, { id }) => {
  await deleteConversation(db, uuidSchema.parse(id));
  return { ok: true };
});
