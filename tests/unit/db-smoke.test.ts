import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createMemoryDb } from "@/lib/db";
import { foods } from "@/lib/db/schema";

describe("database", () => {
  it("migrates an in-memory database and supports full-text search", async () => {
    const db = await createMemoryDb();
    await db.insert(foods).values([
      { source: "usda", dataType: "sr_legacy", externalId: "1", description: "Egg, whole, cooked, fried", nutrientsPer100g: { calories: 196 } },
      { source: "usda", dataType: "sr_legacy", externalId: "2", description: "Bread, white, toasted", nutrientsPer100g: { calories: 293 } },
    ]);
    const rows = await db
      .select({ description: foods.description })
      .from(foods)
      .where(sql`${foods.searchVector} @@ websearch_to_tsquery('english', ${"fried eggs"})`);
    expect(rows.map((r) => r.description)).toEqual(["Egg, whole, cooked, fried"]);
  });
});
