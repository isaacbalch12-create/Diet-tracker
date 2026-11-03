/**
 * `api` (src/lib/client/api.ts) has no PUT. This mirrors its request handling so
 * errors surface as the same ApiError shape everywhere.
 */
import { ApiError } from "@/lib/client/api";

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  if (res.status === 401 && typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "error", err?.details);
  }
  return data as T;
}

/** The id of the workout that blocks starting/reopening another one (409 workout_in_progress). */
export function inProgressConflict(err: unknown): { message: string; workoutId: string | null } | null {
  if (!(err instanceof ApiError) || err.code !== "workout_in_progress") return null;
  const details = err.details as { workoutId?: unknown } | undefined;
  return { message: err.message, workoutId: typeof details?.workoutId === "string" ? details.workoutId : null };
}

/** Errors that are worth retrying automatically (offline, server hiccup). */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}
