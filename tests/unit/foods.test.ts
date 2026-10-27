import { beforeAll, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import { createCustomFood, queryTokens, searchFoods, searchLocalFoods, upsertUsdaFoods } from "@/lib/foods/repo";
import { eachRow, normalizeFdcApiFood, normalizePortionLabel, parseUsdaCsv } from "@/lib/foods/usda";

const files = {
  "food.csv": `"fdc_id","data_type","description","food_category_id","publication_date"
"1","survey_fndds_food","Egg, whole, fried with oil","2502","2022-10-28"
"2","survey_fndds_food","Fried eggplant","6410","2022-10-28"
"3","survey_fndds_food","Milk, human","9602","2022-10-28"`,
  "food_nutrient.csv": `"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"
"10","1","208","192","","","","","","",""
"11","1","203","13.6","","","","","","",""
"12","1","204","14.8","","","","","","",""
"13","1","205","0.83","","","","","","",""
"14","1","307","207","","","","","","",""
"15","2","1008","218","","","","","","",""
"16","2","2047","999","","","","","","",""`,
  "food_portion.csv": `"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"
"1","1","1","","9999","1 egg","","55.0","","",""
"2","1","2","","9999","Quantity not specified","90000","55.0","","",""
"3","1","3","","9999","1 cup","","135.0","","",""`,
  "wweia_food_category.csv": `"wweia_food_category","wweia_food_category_description"
"2502","Eggs and omelets"`,
};

describe("USDA parsing", () => {
  const parsed = parseUsdaCsv(files, "fndds");

  it("maps nutrient ids and legacy numbers to canonical keys", () => {
    const egg = parsed.find((f) => f.externalId === "1")!;
    expect(egg.nutrientsPer100g).toEqual({ calories: 192, protein: 13.6, fat: 14.8, carbs: 0.83, sodium: 207 });
    expect(egg.category).toBe("Eggs and omelets");
  });

  it("prefers Energy (1008) over Atwater energy when both exist", () => {
    expect(parsed.find((f) => f.externalId === "2")!.nutrientsPer100g.calories).toBe(218);
  });

  it("skips foods without energy values and unhelpful portions", () => {
    expect(parsed.find((f) => f.externalId === "3")).toBeUndefined();
    expect(parsed.find((f) => f.externalId === "1")!.portions).toEqual([
      { label: "egg", grams: 55 },
      { label: "cup", grams: 135 },
    ]);
  });

  it("reads RFC 4180 CSV: quotes, escaped quotes, embedded delimiters, CRLF, BOM and blank lines", () => {
    const csv = '\ufeff"a","b","c"\r\n"1","x, ""quoted""","line\nbreak"\r\n\r\n2,plain,\n3,,"last"';
    const out: Record<string, string>[] = [];
    eachRow(csv, (r) => out.push(r));
    expect(out).toEqual([
      { a: "1", b: 'x, "quoted"', c: "line\nbreak" },
      { a: "2", b: "plain", c: "" },
      { a: "3", b: "", c: "last" },
    ]);
  });

  it("normalizes API foods including branded servings", () => {
    const f = normalizeFdcApiFood({
      fdcId: 99,
      description: "Protein bar",
      dataType: "Branded",
      brandOwner: "Acme",
      servingSize: 60,
      servingSizeUnit: "g",
      householdServingFullText: "1 bar",
      foodNutrients: [
        { nutrientId: 1008, value: 350 },
        { nutrientId: 1003, value: 33.3 },
      ],
    })!;
    expect(f.dataType).toBe("branded");
    expect(f.portions[0]).toEqual({ label: "serving (1 bar)", grams: 60 });
    expect(f.nutrientsPer100g.protein).toBe(33.3);
    expect(normalizePortionLabel("1 large")).toBe("large");
    expect(normalizePortionLabel("0.5 cup")).toBe("0.5 cup");
  });
});

describe("food search", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createMemoryDb();
    await upsertUsdaFoods(db, parseUsdaCsv(files, "fndds"));
  });

  it("tokenizes queries safely", () => {
    expect(queryTokens("2 fried eggs & toast; DROP TABLE")).toEqual(["fried", "eggs", "toast", "drop", "table"]);
    expect(queryTokens("low-fat milk")).toEqual(["low", "fat", "milk"]);
  });

  it("ranks whole-word matches above prefix matches", async () => {
    const r = await searchLocalFoods(db, "fried egg");
    expect(r[0].description).toBe("Egg, whole, fried with oil");
  });

  it("does not let common or stemmed words swamp the specific food", async () => {
    const extra = ["Oatmeal, NFS", "Cookie, oatmeal", "Chard, cooked", "Taro, cooked", "Rice, cooked, NFS"].map((description, i) => ({
      externalId: `9${i}`,
      dataType: "fndds" as const,
      description,
      brand: null,
      category: null,
      nutrientsPer100g: { calories: 100 },
      portions: [],
    }));
    await upsertUsdaFoods(db, extra);
    // "cooked" stems to "cook"; a stemmed prefix would also match "cookie".
    for (const q of ["oatmeal cooked", "cooked oatmeal"]) {
      const r = await searchLocalFoods(db, q);
      expect(r[0].description, q).toBe("Oatmeal, NFS");
    }
    expect((await searchLocalFoods(db, "rice cooked"))[0].description).toBe("Rice, cooked, NFS");
    // The word being typed still matches as a prefix; unknown words are dropped.
    expect((await searchLocalFoods(db, "oatm"))[0].description).toBe("Oatmeal, NFS");
    expect((await searchLocalFoods(db, "xyzzy oatmeal"))[0].description).toBe("Oatmeal, NFS");
  });

  it("upserts idempotently by FDC id", async () => {
    await upsertUsdaFoods(db, parseUsdaCsv(files, "fndds"));
    const r = await searchLocalFoods(db, "egg", 10);
    expect(r.filter((x) => x.externalId === "1")).toHaveLength(1);
  });

  it("stores custom foods per 100 g and ranks them in search", async () => {
    const f = await createCustomFood(db, { description: "Homemade fried egg sandwich", servingGrams: 150, nutrientsPerServing: { calories: 420, protein: 21 } });
    expect(f.nutrientsPer100g.calories).toBeCloseTo(280, 6);
    const r = await searchFoods(db, "egg sandwich", { allowApi: false });
    expect(r.results[0].id).toBe(f.id);
  });
});
