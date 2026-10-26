import { route } from "@/lib/api";
import { deleteCustomFood, ensurePortions, getFood } from "@/lib/foods/repo";
import { uuidSchema } from "@/lib/validation";

type P = { id: string };

export const GET = route<P>(async (_req, { db }, { id }) => {
  const food = await ensurePortions(db, await getFood(db, uuidSchema.parse(id)));
  const { searchVector: _sv, ...rest } = food;
  void _sv;
  return { food: rest };
});

export const DELETE = route<P>(async (_req, { db }, { id }) => {
  await deleteCustomFood(db, uuidSchema.parse(id));
  return { ok: true };
});
