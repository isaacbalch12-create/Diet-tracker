// Load .env.local then .env for CLI scripts (Next.js loads these itself for the app).
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
