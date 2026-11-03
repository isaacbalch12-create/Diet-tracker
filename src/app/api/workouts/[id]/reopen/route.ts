import { route } from "@/lib/api";
import { reopenWorkout } from "@/lib/services/training";

export const POST = route<{ id: string }>(async (_req, { db }, { id }) => ({ workout: await reopenWorkout(db, id) }));
