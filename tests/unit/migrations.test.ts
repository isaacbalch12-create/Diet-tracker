import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("migrations", () => {
  it("ships every Drizzle migration unchanged to Netlify Database's migrations folder", () => {
    const drizzleDir = path.resolve("drizzle");
    const netlifyDir = path.resolve("netlify/database/migrations");
    const files = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(fs.readdirSync(netlifyDir).filter((f) => f.endsWith(".sql")).sort()).toEqual(files);
    for (const f of files) {
      expect(fs.readFileSync(path.join(netlifyDir, f), "utf8")).toBe(fs.readFileSync(path.join(drizzleDir, f), "utf8"));
    }
  });
});
