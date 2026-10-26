import { route } from "@/lib/api";
import { recentMeals } from "@/lib/services/meals";

export const GET = route(async (_req, { db }) => ({ meals: await recentMeals(db) }));
