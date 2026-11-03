import { route } from "@/lib/api";
import { templateFromWorkout } from "@/lib/services/training";

export const POST = route<{ id: string }>(async (_req, { db }, { id }) => ({ template: await templateFromWorkout(db, id) }));
