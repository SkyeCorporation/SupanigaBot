/**
 * Web dashboard (Express) — QR Code, spesifikasi hosting, console live.
 * File manager dashboard memakai core/files.js (path sensitif selalu ditolak).
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
import { runShell, shellEnabled } from "./shell.js";
import {
  listTree, readFile, writeFile, createEntry, renameEntry, deleteEntry, uploadFile,
  checkSyntax, resolvePath, mimeOf, MAX_TEXT_BYTES, MAX_UPLOAD_BYTES,
} from "./files.js";

const COOKIE = "penguin_sid";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
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
  app.use(express.json({ limit: "2mb" }));

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

  // ---------- File manager (seluruh folder bot, kecuali path yang dilindungi) ----------
  const sendError = (res, error, fallback) => res.status(error.status || 500).json({ error: error.message || fallback });
  const noStore = (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };

  app.get("/api/fs/tree", requireAuth, noStore, (_req, res) => {
    try { res.json({ ...listTree(), maxTextBytes: MAX_TEXT_BYTES, maxUploadBytes: MAX_UPLOAD_BYTES }); }
    catch (error) { sendError(res, error, "Gagal membaca daftar file."); }
  });

  app.get("/api/fs/file", requireAuth, noStore, (req, res) => {
    try { res.json(readFile(req.query.path)); }
    catch (error) { sendError(res, error, "Gagal membaca file."); }
  });

  // Isi mentah untuk pratinjau gambar dan unduhan. CSP sandbox mencegah file
  // (misalnya SVG) menjalankan skrip di origin dashboard.
  app.get("/api/fs/raw", requireAuth, noStore, (req, res) => {
    try {
      const { relative, absolute } = resolvePath(req.query.path);
      if (!fs.statSync(absolute).isFile()) return res.status(400).json({ error: "Yang dipilih bukan file." });
      res.setHeader("Content-Type", mimeOf(relative));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      if (req.query.download) res.attachment(path.posix.basename(relative));
      fs.createReadStream(absolute).on("error", (error) => sendError(res, error, "Gagal membaca file.")).pipe(res);
    } catch (error) { sendError(res, error, "Gagal membaca file."); }
  });

  app.post("/api/fs/check", requireAuth, requireSameOrigin, async (req, res) => {
    try {
      if (typeof req.body?.content !== "string") return res.status(400).json({ error: "Konten file harus berupa teks." });
      res.json(await checkSyntax(req.body.path, req.body.content));
    } catch (error) { sendError(res, error, "Gagal memeriksa sintaks."); }
  });

  app.put("/api/fs/file", requireAuth, requireSameOrigin, async (req, res) => {
    try {
      const { path: target, content, sha256: expectedHash, force, skipCheck } = req.body || {};
      if (typeof content !== "string") return res.status(400).json({ error: "Konten file harus berupa teks." });
      if (!skipCheck) {
        const check = await checkSyntax(target, content);
        if (!check.ok) return res.status(422).json({ error: "Sintaks tidak valid.", check });
      }
      const saved = writeFile(target, content, { expectedHash, force: force === true });
      log.warn(`File diedit dari dashboard: ${saved.path}`);
      res.json({ ok: true, ...saved });
    } catch (error) { sendError(res, error, "Gagal menyimpan file."); }
  });

  app.post("/api/fs/create", requireAuth, requireSameOrigin, (req, res) => {
    try {
      const type = req.body?.type === "dir" ? "dir" : "file";
      const created = createEntry(req.body?.path, type, typeof req.body?.content === "string" ? req.body.content : "");
      log.warn(`${type === "dir" ? "Folder" : "File"} dibuat dari dashboard: ${created.path}`);
      res.json({ ok: true, ...created });
    } catch (error) { sendError(res, error, "Gagal membuat file."); }
  });

  app.post("/api/fs/rename", requireAuth, requireSameOrigin, (req, res) => {
    try {
      const moved = renameEntry(req.body?.from, req.body?.to);
      log.warn(`Dashboard mengganti nama: ${moved.from} -> ${moved.to}`);
      res.json({ ok: true, ...moved });
    } catch (error) { sendError(res, error, "Gagal mengganti nama."); }
  });

  app.post("/api/fs/delete", requireAuth, requireSameOrigin, (req, res) => {
    try {
      const removed = deleteEntry(req.body?.path);
      log.warn(`Dashboard menghapus: ${removed.path}`);
      res.json({ ok: true, ...removed });
    } catch (error) { sendError(res, error, "Gagal menghapus."); }
  });

  app.post(
    "/api/fs/upload", requireAuth, requireSameOrigin,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      try {
        const saved = uploadFile(req.query.path, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { overwrite: req.query.overwrite === "1" });
        log.warn(`File diunggah dari dashboard: ${saved.path} (${saved.size} byte)`);
        res.json({ ok: true, ...saved });
      } catch (error) { sendError(res, error, "Gagal mengunggah file."); }
    },
  );

  // Shell admin: hanya untuk sesi dashboard yang sudah login dan dari origin yang sama.
  app.get("/api/shell", requireAuth, (_req, res) => res.json({ enabled: shellEnabled(), cwd: ROOT }));
  app.post("/api/shell", requireAuth, requireSameOrigin, async (req, res) => {
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    if (!command) return res.status(400).json({ error: "Perintah shell kosong." });
    if (command.length > 4000) return res.status(400).json({ error: "Perintah terlalu panjang (maksimal 4000 karakter)." });
    if (!shellEnabled()) return res.status(403).json({ error: "Fitur shell dinonaktifkan (DISABLE_SHELL)." });
    log.warn(`Shell dari dashboard: ${command.slice(0, 300)}`);
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await runShell(command));
    } catch (error) {
      res.status(500).json({ error: error.message || "Gagal menjalankan perintah." });
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

  app.use("/api", (error, _req, res, next) => {
    if (!error) return next();
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Ukuran data melebihi batas yang diizinkan." });
    res.status(error.status || 400).json({ error: error.message || "Permintaan tidak valid." });
  });

  app.use("/dashboard", express.static(DASHBOARD_DIR, {
    index: "index.html",
    maxAge: "1h",
    // HTML selalu divalidasi ulang agar versi aset (?v=) terbaru langsung dipakai.
    setHeaders: (res, filePath) => { if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); },
  }));
  app.get("/", (_req, res) => res.redirect("/dashboard/"));
  const port = getPort();
  app.listen(port, "0.0.0.0", () => log.success(`Dashboard web aktif di port ${port} → buka http://localhost:${port}/dashboard/`));
  return app;
}
