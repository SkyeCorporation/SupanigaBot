import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { normalizeNumber } from "./number.js";

const CONFIG_PATH = path.join(ROOT, "config.json");

const DEFAULTS = {
  prefix: ".",
  admin: [],
  moderator: [],
  botName: "Penguin",
  dashboard: { port: 3000, password: "#Supaniga123" },
};

/** Objek config yang dipakai di seluruh bot (diisi ulang saat reload). */
export const config = { ...DEFAULTS };

export function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error(`[config] Gagal membaca config.json: ${err.message}. Memakai default.`);
  }
  const merged = {
    ...DEFAULTS,
    ...raw,
    dashboard: { ...DEFAULTS.dashboard, ...(raw.dashboard || {}) },
  };
  merged.admin = (merged.admin || []).map(normalizeNumber).filter(Boolean);
  merged.moderator = (merged.moderator || []).map(normalizeNumber).filter(Boolean);
  merged.prefix = String(merged.prefix || ".");

  // Variabel environment (opsional) menimpa config.json — cocok untuk hosting.
  if (process.env.BOT_PREFIX) merged.prefix = process.env.BOT_PREFIX;
  if (process.env.DASHBOARD_PASSWORD) merged.dashboard.password = process.env.DASHBOARD_PASSWORD;

  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, merged);
  return config;
}

export function getPort() {
  return Number(process.env.PORT || process.env.SERVER_PORT || config.dashboard?.port || 3000);
}
