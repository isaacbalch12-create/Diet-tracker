import { readJson, route } from "@/lib/api";
import { createExercise, exerciseInputSchema, listExercises } from "@/lib/services/training";

export const GET = route(async (_req, { db }) => ({ exercises: await listExercises(db) }));

export const POST = route(async (req, { db }) => ({ exercise: await createExercise(db, await readJson(req, exerciseInputSchema)) }));
