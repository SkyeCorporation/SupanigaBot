/**
 * Logger + console dashboard.
 * PRIVASI: nomor WhatsApp orang lain TIDAK pernah ditulis ke console.
 * Hanya nomor bot yang terhubung yang boleh tampil; nomor lain otomatis disensor.
 */
import util from "node:util";
import { bus, state } from "./state.js";

const MAX_LINES = 500;
const buffer = [];
let seq = 0;

const COLORS = {
  info: "\x1b[36m",
  success: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  cmd: "\x1b[35m",
  msg: "\x1b[90m",
  system: "\x1b[34m",
};
const RESET = "\x1b[0m";

const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/** Sensor semua deretan angka mirip nomor telepon, kecuali nomor bot sendiri. */
export function sanitize(text) {
  return String(text).replace(/(?<![\d])\+?\d{9,15}(?![\d])/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (state.botNumber && digits === state.botNumber) return m;
    return "•".repeat(Math.min(digits.length, 12));
  });
}

function write(level, args) {
  const text = sanitize(
    args.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 3, colors: false }))).join(" "),
  );
  const entry = { id: ++seq, time: Date.now(), level, text };
  buffer.push(entry);
  if (buffer.length > MAX_LINES) buffer.shift();
  bus.emit("log", entry);
  const t = new Date(entry.time).toLocaleTimeString("id-ID", { hour12: false });
  const out = level === "error" ? original.error : level === "warn" ? original.warn : original.log;
  out(`${COLORS[level] || ""}[${t}] [${level.toUpperCase()}]${RESET} ${text}`);
}

export const log = {
  info: (...a) => write("info", a),
  success: (...a) => write("success", a),
  warn: (...a) => write("warn", a),
  error: (...a) => write("error", a),
  cmd: (...a) => write("cmd", a),
  msg: (...a) => write("msg", a),
  system: (...a) => write("system", a),
};

export function getLogs() {
  return buffer.slice();
}

/** Tulis langsung ke terminal tanpa masuk dashboard (misal QR ASCII). */
export function rawTerminal(text) {
  original.log(text);
}

/** Alihkan console bawaan agar ikut tersensor & tampil di dashboard. */
export function installConsole() {
  console.log = (...a) => write("info", a);
  console.info = (...a) => write("info", a);
  console.warn = (...a) => write("warn", a);
  console.error = (...a) => write("error", a);
}
