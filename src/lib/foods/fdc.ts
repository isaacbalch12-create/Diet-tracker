/**
 * Minimal USDA FoodData Central API client (https://fdc.nal.usda.gov/api-guide).
 * Used as a fallback when the local food table has no good match, and for
 * branded products. The API key stays on the server.
 */
import { env } from "../env";
import { type FdcApiFood, type NormalizedFood, normalizeFdcApiFood } from "./usda";

export class FdcError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "FdcError";
  }
}

const BASE = "https://api.nal.usda.gov/fdc/v1";

async function fdcFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(env.fdcApiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch (err) {
    throw new FdcError(`USDA FoodData Central is unreachable (${(err as Error).message})`, null);
  }
  if (res.status === 429) {
    throw new FdcError(
      env.fdcApiKeyIsDemo
        ? "USDA API rate limit reached (the shared DEMO_KEY allows very few requests). Add a free FDC_API_KEY."
        : "USDA API rate limit reached. Try again later.",
      429,
    );
  }
  if (res.status === 403) throw new FdcError("USDA API rejected the API key (check FDC_API_KEY).", 403);
  if (!res.ok) throw new FdcError(`USDA API error ${res.status}`, res.status);
  return res.json();
}

export async function searchFdc(query: string, opts: { branded?: boolean; pageSize?: number } = {}): Promise<NormalizedFood[]> {
  const dataType = opts.branded ? ["Branded"] : ["Foundation", "SR Legacy", "Survey (FNDDS)"];
  const body = { query, dataType, pageSize: opts.pageSize ?? 10, requireAllWords: false };
  const data = (await fdcFetch("/foods/search", { method: "POST", body: JSON.stringify(body) })) as { foods?: FdcApiFood[] };
  return (data.foods ?? []).map(normalizeFdcApiFood).filter((f): f is NormalizedFood => f !== null);
}

export async function getFdcFood(fdcId: string): Promise<NormalizedFood | null> {
  const data = (await fdcFetch(`/food/${encodeURIComponent(fdcId)}`)) as FdcApiFood;
  return normalizeFdcApiFood(data);
}
