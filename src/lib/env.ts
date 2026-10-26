/**
 * Server-side configuration. Never import this from client components: it reads
 * secrets from process.env.
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get databaseUrl() {
    return str("DATABASE_URL");
  },
  get pgliteDir() {
    return str("PGLITE_DIR") ?? "./data/pglite";
  },
  get anthropicApiKey() {
    return str("ANTHROPIC_API_KEY") ?? str("ANTHROPIC_AUTH_TOKEN");
  },
  get anthropicModel() {
    return str("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
  },
  /** Opt out of the server-side refusal fallback (e.g. when using a proxy that rejects it). */
  get anthropicFallbacks() {
    return str("ANTHROPIC_FALLBACKS") !== "off";
  },
  get fdcApiKey() {
    return str("FDC_API_KEY") ?? "DEMO_KEY";
  },
  get fdcApiKeyIsDemo() {
    return !str("FDC_API_KEY");
  },
  get appPassword() {
    return str("APP_PASSWORD");
  },
  get sessionSecret() {
    return str("SESSION_SECRET");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get imageStorage(): "db" | "s3" {
    return str("IMAGE_STORAGE") === "s3" ? "s3" : "db";
  },
  get s3() {
    return {
      endpoint: str("S3_ENDPOINT"),
      bucket: str("S3_BUCKET"),
      region: str("S3_REGION") ?? "auto",
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
    };
  },
};

/**
 * Auth mode:
 * - "password": APP_PASSWORD + SESSION_SECRET set → login required.
 * - "open": local development without a password (never allowed in production).
 * - "misconfigured": production build without credentials → everything is blocked.
 */
export function authMode(): "password" | "open" | "misconfigured" {
  if (env.appPassword && env.sessionSecret && env.sessionSecret.length >= 32) return "password";
  if (!env.isProduction && !env.appPassword) return "open";
  return "misconfigured";
}
