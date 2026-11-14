/**
 * Loader command dari ./cmds (format CommonJS: module.exports = { config, onStart }).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CMDS_DIR } from "./paths.js";
import { log } from "./logger.js";

const require = createRequire(import.meta.url);

/** name/alias -> command */
export const commands = new Map();
/** daftar command unik */
export const commandList = [];

export function loadCommands() {
  commands.clear();
  commandList.length = 0;
  const files = fs.existsSync(CMDS_DIR) ? fs.readdirSync(CMDS_DIR).filter((f) => f.endsWith(".js")) : [];
  let ok = 0;
  for (const file of files) {
    const full = path.join(CMDS_DIR, file);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      const cmd = mod?.default || mod;
      const cfg = cmd?.config;
      if (!cfg?.name || typeof cmd.onStart !== "function") {
        log.warn(`Lewati ${file}: wajib punya config.name dan onStart()`);
        continue;
      }
      const normalized = {
        ...cmd,
        file,
        config: {
          name: String(cfg.name).toLowerCase(),
          aliases: (cfg.aliases || []).map((a) => String(a).toLowerCase()),
          cooldown: Number(cfg.cooldown ?? 3),
          description: cfg.description || "",
          usage: cfg.usage || "",
          category: cfg.category || "umum",
          price: Math.max(0, Number(cfg.price || 0)),
          role: Math.min(3, Math.max(0, Number(cfg.role || 0))),
        },
      };
      for (const key of [normalized.config.name, ...normalized.config.aliases]) {
        if (commands.has(key)) log.warn(`Nama command "${key}" bentrok (${file})`);
        commands.set(key, normalized);
      }
      commandList.push(normalized);
      ok++;
    } catch (err) {
      log.error(`Gagal memuat ${file}: ${err.message}`);
    }
  }
  commandList.sort((a, b) => a.config.role - b.config.role || a.config.name.localeCompare(b.config.name));
  log.system(`${ok} command dimuat dari ./cmds`);
  return ok;
}

export function publicCommands() {
  return commandList.map((c) => ({ ...c.config }));
}
