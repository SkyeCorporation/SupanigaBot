/**
 * ╔══════════════════════════════════════════════╗
 *   Supaniga MX's — Penguin 1.0.0 Pro
 *   Bot WhatsApp NodeJS (Baileys) + Database SQL
 *   Fullstack Developer: Demian (Luxion)
 * ╚══════════════════════════════════════════════╝
 *
 * Jalankan:  npm install  lalu  npm start
 */
import { installConsole, log } from "./core/logger.js";
import { loadConfig, config } from "./core/config.js";
import { initDatabase } from "./core/database.js";
import { loadCommands } from "./core/commands.js";
import { startWeb } from "./core/web.js";
import { startBot } from "./core/bot.js";

installConsole();

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  log.error(`Butuh Node.js 20 atau lebih baru (sekarang ${process.version}).`);
  process.exit(1);
}

log.system("Supaniga MX's — Penguin 1.0.0 Pro");
log.system("Fullstack Developer: Demian (Luxion)");

loadConfig();
log.info(`Prefix: "${config.prefix}" • Admin: ${config.admin.length} • Moderator: ${config.moderator.length}`);
if (config.admin.length === 0) log.warn('Belum ada nomor admin di config.json → isi "admin": ["62xxxxxxxxxx"]');

initDatabase();
log.success("Database SQL siap (database/supaniga.db)");

loadCommands();
startWeb();
startBot().catch((err) => log.error(`Gagal memulai bot: ${err.message}`));

process.on("unhandledRejection", (err) => log.error(`Unhandled: ${err?.message || err}`));
process.on("uncaughtException", (err) => log.error(`Uncaught: ${err?.message || err}`));
