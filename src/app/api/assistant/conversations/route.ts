import { route } from "@/lib/api";
import { listConversations } from "@/lib/ai/assistant";

export const GET = route(async (_req, { db }) => ({ conversations: await listConversations(db) }));
