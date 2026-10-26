/**
 * Create an explicitly labelled DEMO database with ~90 days of realistic sample
 * data (weigh-ins, meals built from USDA foods, goals, favorites). It never
 * touches your real data: by default it writes to ./data/pglite-demo, refuses
 * to run against DATABASE_URL, and refuses to write into a database that
 * already has records. The app shows a "Demo mode" banner for this database.
 *
 *   npm run demo           # seed (if needed) and start the app on the demo database
 *   npm run demo:seed      # seed only
 */
import "./env";
import path from "node:path";

const FORCE = process.argv.includes("--force");
if (process.env.DATABASE_URL && !process.argv.includes("--allow-database-url")) {
  console.error("Refusing to seed demo data into DATABASE_URL. Unset it (demo uses ./data/pglite-demo) or pass --allow-database-url for a dedicated demo database.");
  process.exit(1);
}
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = process.env.DEMO_PGLITE_DIR ?? "./data/pglite-demo";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261026);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

type Tpl = { title: string; foods: [query: string, grams: number][] };
const MEALS: Record<string, Tpl[]> = {
  Breakfast: [
    { title: "Eggs, toast & OJ", foods: [["egg whole fried with butter", 150], ["bread white toasted", 50], ["orange juice 100% freshly squeezed", 240]] },
    { title: "Oatmeal with banana", foods: [["oatmeal NFS", 300], ["banana raw", 118], ["milk reduced fat 2%", 120], ["coffee brewed", 240]] },
    { title: "Greek yogurt bowl", foods: [["yogurt greek nonfat milk plain", 227], ["blueberries raw", 100], ["cereal granola", 45]] },
  ],
  Lunch: [
    { title: "Chicken, rice & broccoli", foods: [["chicken breast grilled without sauce skin not eaten", 170], ["rice white cooked no added fat", 200], ["broccoli cooked no added fat", 90], ["olive oil", 7]] },
    { title: "Turkey sandwich & apple", foods: [["turkey sandwich on wheat", 230], ["apple raw", 182]] },
    { title: "Chicken caesar salad", foods: [["chicken caesar garden salad", 330], ["caesar dressing", 30], ["roll white soft", 40]] },
  ],
  Dinner: [
    { title: "Salmon, potato & green beans", foods: [["salmon baked or broiled", 180], ["potato baked peel eaten", 200], ["green beans cooked no added fat", 100], ["butter", 10]] },
    { title: "Spaghetti with meat sauce", foods: [["pasta cooked", 220], ["spaghetti sauce with meat", 250], ["cheese parmesan grated", 10]] },
    { title: "Cheese pizza", foods: [["pizza cheese from restaurant or fast food medium crust", 300]] },
    { title: "Beef tacos", foods: [["taco beef cheese lettuce soft", 300], ["salsa red", 60]] },
  ],
  Snack: [
    { title: "Almonds", foods: [["almonds", 35]] },
    { title: "Apple & peanut butter", foods: [["apple raw", 182], ["peanut butter", 32]] },
    { title: "String cheese", foods: [["mozzarella part skim", 56]] },
    { title: "Protein shake", foods: [["nutritional drink or shake high protein ready-to-drink", 330]] },
  ],
};

async function main() {
  const [{ getDb }, { countFoods, searchLocalFoods }, { importUsda }, meals, weights, settingsSvc, saved, { addDays, zonedToInstant, todayIn }, schema] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/foods/repo"),
    import("../src/lib/foods/import"),
    import("../src/lib/services/meals"),
    import("../src/lib/services/weights"),
    import("../src/lib/services/settings"),
    import("../src/lib/services/saved-meals"),
    import("../src/lib/time"),
    import("../src/lib/db/schema"),
  ]);
  const { createMealSchema, weightInputSchema } = await import("../src/lib/validation");
  const { count } = await import("drizzle-orm");
  const db = await getDb();
  console.log(`Demo database: ${path.resolve(process.env.PGLITE_DIR!)}`);

  const [{ n: mealCount }] = await db.select({ n: count() }).from(schema.meals);
  const [{ n: weightCount }] = await db.select({ n: count() }).from(schema.weightEntries);
  if ((Number(mealCount) > 0 || Number(weightCount) > 0) && !FORCE) {
    console.log("Demo database already has data — nothing to do (use --force to add more).");
    process.exit(0);
  }

  if ((await countFoods(db, "usda")) < 1000) {
    console.log("Importing USDA foods into the demo database…");
    await importUsda(db, path.resolve("./data/usda"));
  }

  const tz = process.env.DEMO_TIMEZONE ?? "America/Chicago";
  const s = await settingsSvc.updateSettings(db, { timezone: tz, weightUnit: "lb", startingWeight: { value: 192, unit: "lb" }, targetWeight: { value: 178, unit: "lb" }, onboarded: true });
  const { settings: settingsTable } = schema;
  const { eq } = await import("drizzle-orm");
  await db.update(settingsTable).set({ isDemo: true, startingWeightDate: addDays(todayIn(tz), -90) }).where(eq(settingsTable.id, 1));
  const st = await settingsSvc.getSettings(db);

  const today = todayIn(tz);
  const start = addDays(today, -90);
  await settingsSvc.setGoals(db, { calories: 2300, protein: 160, carbs: 240, fat: 75 }, start);
  await settingsSvc.setGoals(db, { calories: 2150, protein: 170, carbs: 215, fat: 70 }, addDays(today, -30));

  // Resolve template foods once.
  const cache = new Map<string, Awaited<ReturnType<typeof searchLocalFoods>>[number] | null>();
  const food = async (q: string) => {
    if (!cache.has(q)) cache.set(q, (await searchLocalFoods(db, q, 1))[0] ?? null);
    return cache.get(q)!;
  };
  const buildItems = async (tpl: Tpl, scale: number) => {
    const items = [];
    for (const [q, grams] of tpl.foods) {
      const f = await food(q);
      if (!f) continue;
      const g = Math.round(grams * scale);
      const portion = f.portions.find((p) => Math.abs(g / p.grams - Math.round(g / p.grams)) < 0.15 && Math.round(g / p.grams) >= 1);
      items.push({
        name: f.description.split(",").slice(0, 2).join(","),
        quantity: portion ? Math.round(g / portion.grams) : g,
        unit: portion ? portion.label : "g",
        gramsPerUnit: portion ? portion.grams : 1,
        nutrientsPer100g: Object.fromEntries(Object.entries(f.nutrientsPer100g).filter(([, v]) => typeof v === "number")) as Record<string, number>,
        nutrientSource: "database" as const,
        quantitySource: "user_stated" as const,
        foodId: f.id,
        sourceRef: { provider: f.source, fdcId: f.externalId ?? undefined, dataType: f.dataType, description: f.description },
        portions: f.portions,
      });
    }
    return items;
  };

  let mealsCreated = 0;
  let weighIns = 0;
  for (let i = 0; i <= 90; i++) {
    const date = addDays(start, i);
    // Weight: slow downward trend + water-weight wobble + noise.
    const base = 192 - i * 0.055 + Math.sin(i / 3.1) * 0.8;
    const morning = base + between(-0.7, 0.7);
    if (rand() < 0.88) {
      await weights.createWeight(db, weightInputSchema.parse({ value: Number(morning.toFixed(1)), unit: "lb", period: "morning", localDate: date, measuredAt: zonedToInstant(date, `0${6 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 59)).padStart(2, "0")}`, tz).toISOString() }), st);
      weighIns++;
    }
    if (rand() < 0.72) {
      await weights.createWeight(db, weightInputSchema.parse({ value: Number((morning + between(1.4, 3.2)).toFixed(1)), unit: "lb", period: "night", localDate: date, measuredAt: zonedToInstant(date, `22:${String(Math.floor(rand() * 59)).padStart(2, "0")}`, tz).toISOString() }), st);
      weighIns++;
    }
    if (i < 90 && rand() > 0.86) continue; // some days unlogged
    const plan: [string, string][] = [
      ["Breakfast", `0${7 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 59)).padStart(2, "0")}`],
      ["Lunch", `12:${String(Math.floor(rand() * 59)).padStart(2, "0")}`],
      ["Dinner", `1${8 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 59)).padStart(2, "0")}`],
    ];
    if (rand() < 0.7) plan.push(["Snack", `15:${String(Math.floor(rand() * 59)).padStart(2, "0")}`]);
    if (rand() < 0.25) plan.push(["Snack", `21:${String(Math.floor(rand() * 59)).padStart(2, "0")}`]);
    const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    for (const [cat, time] of plan) {
      if (i === 90 && time > nowLocal) continue; // today: only meals already eaten
      if (rand() < 0.07) continue; // occasionally a meal isn't logged
      const tpl = pick(MEALS[cat]);
      const items = await buildItems(tpl, between(0.9, 1.3));
      if (!items.length) continue;
      await meals.createMeal(db, createMealSchema.parse({ eatenAt: zonedToInstant(date, time, tz).toISOString(), localDate: date, category: cat, title: tpl.title, source: "manual", items }), st);
      mealsCreated++;
    }
  }
  const favTpl = MEALS.Breakfast[2];
  await saved.createSavedMeal(db, { name: favTpl.title, category: "Breakfast", items: createMealSchema.shape.items.parse(await buildItems(favTpl, 1)) });
  const favTpl2 = MEALS.Lunch[0];
  await saved.createSavedMeal(db, { name: favTpl2.title, category: "Lunch", items: createMealSchema.shape.items.parse(await buildItems(favTpl2, 1)) });
  console.log(`Demo data created: ${mealsCreated} meals, ${weighIns} weigh-ins, 2 goal versions, 2 saved meals. Marked as DEMO.`);
  void s;
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
