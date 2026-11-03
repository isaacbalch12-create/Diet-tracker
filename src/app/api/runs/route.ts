import { NextResponse } from "next/server";
import { rangeFromQuery, readJson, route } from "@/lib/api";
import { createRun, earliestRunDate, runInputSchema, runningOverview } from "@/lib/services/running";

export const GET = route(async (req, { db, settings, today }) => runningOverview(db, rangeFromQuery(req, today, await earliestRunDate(db)), settings, today));

export const POST = route(async (req, { db, today }) => {
  const { run, created } = await createRun(db, await readJson(req, runInputSchema), today);
  return NextResponse.json({ run, created }, { status: created ? 201 : 200 });
});
