import { route } from "@/lib/api";
import { trainingOverview } from "@/lib/services/training";

export const GET = route(async (_req, { db, settings, today }) => trainingOverview(db, settings, today));
