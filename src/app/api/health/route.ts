import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { dbDriver, getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: dbDriver() });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
