import { readJson, route } from "@/lib/api";
import { authMode, env } from "@/lib/env";
import { countFoods } from "@/lib/foods/repo";
import { goalTargets } from "@/lib/nutrition/goals";
import { goalsForDate, listGoals, toGoalVersion, updateSettings } from "@/lib/services/settings";
import { settingsInputSchema } from "@/lib/validation";

export const GET = route(async (_req, { db, settings, today }) => {
  const [current, history, usdaFoods, customFoods] = await Promise.all([goalsForDate(db, today), listGoals(db), countFoods(db, "usda"), countFoods(db, "custom")]);
  return {
    settings,
    today,
    goals: current ? toGoalVersion(current) : null,
    goalTargets: goalTargets(current ? toGoalVersion(current) : null),
    goalHistory: history.map(toGoalVersion),
    status: {
      aiConfigured: !!env.anthropicApiKey,
      aiModel: env.anthropicModel,
      usdaFoods,
      customFoods,
      fdcApiKeyIsDemo: env.fdcApiKeyIsDemo,
      authMode: authMode(),
      imageStorage: env.imageStorage,
      database: env.databaseUrl ? "postgres" : "embedded",
    },
  };
});

export const PATCH = route(async (req, { db }) => {
  const input = await readJson(req, settingsInputSchema);
  return { settings: await updateSettings(db, input) };
});
