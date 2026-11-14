import path from "node:path";
import { fileURLToPath } from "node:url";

/** Root project (folder tempat index.js berada). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SESSION_DIR = path.join(ROOT, "session");
export const DATABASE_DIR = path.join(ROOT, "database");
export const CMDS_DIR = path.join(ROOT, "cmds");
export const DASHBOARD_DIR = path.join(ROOT, "public", "dashboard");
