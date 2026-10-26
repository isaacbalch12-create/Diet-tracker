import { query, route } from "@/lib/api";
import { searchFoods } from "@/lib/foods/repo";

export const GET = route(async (req, { db }) => {
  const q = query(req);
  const text = (q.get("q") ?? "").trim().slice(0, 200);
  if (text.length < 2) return { results: [], usedApi: false, apiError: null };
  return searchFoods(db, text, { branded: q.get("branded") === "1", limit: 15 });
});
