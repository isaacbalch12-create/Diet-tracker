// Starts the app against the demo database (./data/pglite-demo), never your real data.
import { spawn } from "node:child_process";

const env = { ...process.env, PGLITE_DIR: process.env.DEMO_PGLITE_DIR ?? "./data/pglite-demo" };
delete env.DATABASE_URL;
const child = spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
