import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let baileysVersion = "unknown";
try {
  baileysVersion = require("baileys/package.json").version;
} catch {
  /* abaikan */
}

let lastCpu = snapshot();
function snapshot() {
  return os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

function cpuUsage() {
  const now = snapshot();
  const idle = now.idle - lastCpu.idle;
  const total = now.total - lastCpu.total;
  lastCpu = now;
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
}

function disk() {
  try {
    const s = fs.statfsSync(process.cwd());
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (!total || total > 2 ** 50) return null; // nilai tidak wajar (container tertentu)
    return { total, used: total - free, free };
  } catch {
    return null;
  }
}

export function systemInfo() {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  return {
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model?.trim() || "Unknown CPU",
    cpuCores: cpus.length,
    cpuSpeed: cpus[0]?.speed || 0,
    cpuUsage: Number(cpuUsage().toFixed(1)),
    loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
    memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
    process: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, pid: process.pid },
    disk: disk(),
    uptime: { system: os.uptime(), process: process.uptime() },
    node: process.version,
    baileys: baileysVersion,
    time: Date.now(),
  };
}
