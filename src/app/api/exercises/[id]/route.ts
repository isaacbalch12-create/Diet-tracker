import { readJson, route } from "@/lib/api";
import { deleteExercise, exerciseDetail, exercisePatchSchema, updateExercise } from "@/lib/services/training";

export const GET = route<{ id: string }>(async (_req, { db, settings, today }, { id }) => exerciseDetail(db, decodeURIComponent(id), settings, today));

export const PATCH = route<{ id: string }>(async (req, { db }, { id }) => ({ exercise: await updateExercise(db, decodeURIComponent(id), await readJson(req, exercisePatchSchema)) }));

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => ({ result: await deleteExercise(db, decodeURIComponent(id)) }));
