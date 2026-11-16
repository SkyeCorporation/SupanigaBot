/**
 * Web dashboard (Express) — QR Code, spesifikasi hosting, console live.
 * Dashboard file editor is deliberately limited to approved text files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config, getPort } from "./config.js";
import { ROOT, DASHBOARD_DIR } from "./paths.js";
import { log, getLogs } from "./logger.js";
import { bus, publicStatus } from "./state.js";
import { systemInfo } from "./system.js";
import { publicCommands, loadCommands } from "./commands.js";
import { usersData, groupsData } from "./database.js";
import { logoutBot } from "./bot.js";

const COOKIE = "penguin_sid";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EDIT_BYTES = 256 * 1024;
const sessions = new Map(); // token -> expiresAt
const failures = new Map(); // ip -> { count, until }

export const APP_INFO = {
  name: "Supaniga MX's",
  edition: "Penguin 1.0.0 Pro",
  version: "1.0.0",
  developer: "Demian (Luxion)",
  role: "Fullstack Developer",
};

function passwordMatches(input, expected) {
  const a = crypto.createHash("sha256").update(String(input), "utf8").digest();
  const b = crypto.createHash("sha256").update(String(expected), "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

function getToken(req) {
  const header = req.headers.cookie || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`));
  return m?.[1] || null;
}

function isAuthed(req) {
  const token = getToken(req);
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return res.status(403).json({ error: "Origin header wajib untuk operasi edit." });
  try {
    if (new URL(origin).origin !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "Origin tidak diizinkan." });
    }
  } catch {
    return res.status(403).json({ error: "Origin tidak valid." });
  }
  next();
}

// Only existing command plugins and dashboard assets are editable. Config,
// credentials, databases, dependencies, and server/auth code are excluded.
function isEditablePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length > 240) return false;
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized !== relativePath || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return /^cmds\/[A-Za-z0-9_.-]+\.js$/.test(normalized) ||
    /^public\/dashboard\/[A-Za-z0-9_.-]+\.(?:html|css|js)$/.test(normalized) ||
    normalized === "README.md";
}

function resolveEditableFile(relativePath) {
  if (!isEditablePath(relativePath)) throw Object.assign(new Error("File ini tidak termasuk daftar file yang boleh diedit."), { status: 400 });
  const absolute = path.resolve(ROOT, relativePath);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) throw Object.assign(new Error("Path di luar project ditolak."), { status: 400 });
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("Hanya file biasa yang dapat diedit; symlink dan direktori ditolak."), { status: 400 });
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(`${ROOT}${path.sep}`)) throw Object.assign(new Error("File berada di luar root project."), { status: 400 });
  return { absolute, stat };
}

function fileHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function listEditableFiles() {
  const files = [];
  for (const directory of ["cmds", "public/dashboard"]) {
    const absoluteDir = path.join(ROOT, directory);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relativePath = `${directory}/${entry.name}`;
      if (!isEditablePath(relativePath)) continue;
      try {
        const { absolute } = resolveEditableFile(relativePath);
        files.push({ path: relativePath, size: fs.statSync(absolute).size });
      } catch {
        // Ignore inaccessible or symlinked entries rather than exposing them.
      }
    }
  }
  const readme = path.join(ROOT, "README.md");
  if (fs.existsSync(readme)) {
    try {
      const { absolute } = resolveEditableFile("README.md");
      files.push({ path: "README.md", size: fs.statSync(absolute).size });
    } catch { /* ignore */ }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function overview() {
  const [users, groups, groupList] = await Promise.all([usersData.count(), groupsData.count(), groupsData.getAll()]);
  return {
    app: APP_INFO,
    prefix: config.prefix,
    status: publicStatus(),
    system: systemInfo(),
    commands: publicCommands(),
    database: {
      engine: "SQLite (better-sqlite3)", users, groups,
      groupList: groupList.slice(-50).reverse(), admins: config.admin.length, moderators: config.moderator.length,
    },
    logs: getLogs(),
  };
}

export function startWeb() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "300kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, app: "supaniga-penguin" }));
  app.get("/api/session", (req, res) => res.json({ authenticated: isAuthed(req), app: APP_INFO }));

  app.post("/api/login", (req, res) => {
    const ip = req.ip || "unknown";
    const failure = failures.get(ip);
    if (failure && failure.until > Date.now()) {
      return res.status(429).json({ ok: false, error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil((failure.until - Date.now()) / 60000)} menit lagi.` });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(password, config.dashboard.password)) {
      const count = (failure?.count || 0) + 1;
      failures.set(ip, { count, until: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      log.warn("Percobaan login dashboard gagal");
      return res.status(401).json({ ok: false, error: "Sandi salah." });
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    const secure = req.secure ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
    log.info("Login dashboard berhasil");
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    const token = getToken(req);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/overview", requireAuth, async (_req, res) => res.json(await overview()));
  app.get("/api/system", requireAuth, (_req, res) => res.json(systemInfo()));

  app.get("/api/files", requireAuth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ files: listEditableFiles(), maxBytes: MAX_EDIT_BYTES });
  });

  app.get("/api/files/content", requireAuth, (req, res) => {
    try {
      const { absolute, stat } = resolveEditableFile(req.query.path);
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: `File melebihi batas ${MAX_EDIT_BYTES} byte.` });
      const content = fs.readFileSync(absolute, "utf8");
      res.setHeader("Cache-Control", "no-store");
      res.json({ path: req.query.path, content, sha256: fileHash(content), size: stat.size });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || "Gagal membaca file." });
    }
  });

  app.put("/api/files/content", requireAuth, requireSameOrigin, (req, res) => {
    try {
      const relativePath = req.body?.path;
      const content = req.body?.content;
      const expectedHash = req.body?.sha256;
      if (typeof content !== "string") return res.status(400).json({ error: "Konten file harus berupa teks." });
      if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) return res.status(413).json({ error: `Ukuran file maksimal ${MAX_EDIT_BYTES} byte.` });
      if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) return res.status(400).json({ error: "Hash versi file tidak valid. Muat ulang file sebelum menyimpan." });

      const { absolute, stat } = resolveEditableFile(relativePath);
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: `File melebihi batas ${MAX_EDIT_BYTES} byte.` });
      const current = fs.readFileSync(absolute, "utf8");
      if (fileHash(current) !== expectedHash) return res.status(409).json({ error: "File berubah sejak dibuka. Muat ulang sebelum menyimpan agar perubahan tidak tertimpa." });

      const tempPath = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${crypto.randomBytes(8).toString("hex")}.tmp`);
      try {
        fs.writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx", mode: stat.mode & 0o777 });
        fs.renameSync(tempPath, absolute);
      } catch (error) {
        try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore cleanup error */ }
        throw error;
      }
      log.warn(`File project diedit dari dashboard: ${relativePath}`);
      res.json({ ok: true, path: relativePath, sha256: fileHash(content), size: Buffer.byteLength(content, "utf8") });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || "Gagal menyimpan file." });
    }
  });

  app.post("/api/wa/logout", requireAuth, async (_req, res) => {
    log.warn("Logout sesi WhatsApp diminta dari dashboard");
    await logoutBot();
    res.json({ ok: true });
  });
  app.post("/api/cmds/reload", requireAuth, (_req, res) => {
    const total = loadCommands();
    res.json({ ok: true, total, commands: publicCommands() });
  });

  app.get("/api/stream", requireAuth, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onLog = (entry) => send("log", entry);
    const onStatus = (status) => send("status", status);
    const onStats = () => send("status", publicStatus());
    bus.on("log", onLog); bus.on("status", onStatus); bus.on("stats", onStats);
    const timer = setInterval(() => send("system", systemInfo()), 2000);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    send("status", publicStatus());
    req.on("close", () => {
      bus.off("log", onLog); bus.off("status", onStatus); bus.off("stats", onStats);
      clearInterval(timer); clearInterval(ping);
    });
  });

  app.use("/dashboard", express.static(DASHBOARD_DIR, { index: "index.html", maxAge: "1h" }));
  app.get("/", (_req, res) => res.redirect("/dashboard/"));
  const port = getPort();
  app.listen(port, "0.0.0.0", () => log.success(`Dashboard web aktif di port ${port} → buka http://localhost:${port}/dashboard/`));
  return app;
}
