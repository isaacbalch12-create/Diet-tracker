import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { AppError } from "../errors";

/** Server-side refusal fallback (routes a declined request to Anthropic's recommended model). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The subset of the SDK the app uses — lets tests inject a scripted client. */
export type AnthropicLike = Pick<Anthropic, "beta">;

let cached: Anthropic | null = null;

export function aiConfigured(): boolean {
  return !!env.anthropicApiKey;
}

export function getAnthropic(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new AppError(503, "ai_not_configured", "AI features need an ANTHROPIC_API_KEY on the server. You can still log foods by searching the database or entering them manually.");
  }
  cached ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 180_000 });
  return cached;
}

/** Extra request fields for the refusal fallback (can be disabled with ANTHROPIC_FALLBACKS=off). */
export function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  return env.anthropicFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {};
}

/** Translate SDK errors into user-facing errors without leaking internals. */
export function toAiError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AppError(503, "ai_auth", "The AI service rejected the API key. Check ANTHROPIC_API_KEY on the server.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(429, "ai_rate_limited", "The AI service is rate-limiting requests right now. Wait a minute and try again.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AppError(502, "ai_bad_request", `The AI service could not process this request (${err.message.slice(0, 200)}).`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError(503, "ai_unreachable", "Couldn't reach the AI service. Check the server's internet connection and try again.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError(503, "ai_unavailable", `The AI service is temporarily unavailable (status ${err.status ?? "unknown"}). Try again shortly.`);
  }
  return new AppError(500, "ai_error", "The AI analysis failed unexpectedly. Try again, or add foods manually.");
}
