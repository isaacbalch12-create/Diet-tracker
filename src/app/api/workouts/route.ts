import { NextResponse } from "next/server";
import { query, readJson, route } from "@/lib/api";
import { createWorkout, createWorkoutSchema, listWorkouts } from "@/lib/services/training";
import { isLocalDate } from "@/lib/time";

export const GET = route(async (req, { db, settings }) => {
  const q = query(req);
  const d = (k: string) => {
    const v = q.get(k);
    return v && isLocalDate(v) ? v : undefined;
  };
  const limit = Number(q.get("limit") ?? "") || undefined;
  return { workouts: await listWorkouts(db, settings, { start: d("start"), end: d("end"), exerciseId: q.get("exerciseId") ?? undefined, q: q.get("q") ?? undefined, limit }) };
});

export const POST = route(async (req, { db, settings, today }) => {
  const { workout, created } = await createWorkout(db, await readJson(req, createWorkoutSchema), settings, today);
  return NextResponse.json({ workout, created }, { status: created ? 201 : 200 });
});
