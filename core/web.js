/**
 * Web dashboard (Express) — QR Code, spesifikasi hosting, console live.
 * Dilindungi sandi dari config.json (dashboard.password) atau env DASHBOARD_PASSWORD.
 */
import crypto from "node:crypto";
import express from "express";
import { config, getPort } from "./config.js";
import { DASHBOARD_DIR } from "./paths.js";
import { log, getLogs } from "./logger.js";
import { bus, publicStatus } from "./state.js";
import { systemInfo } from "./system.js";
import { publicCommands, loadCommands } from "./commands.js";
import { usersData, groupsData } from "./database.js";
import { logoutBot } from "./bot.js";

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
  const t = getToken(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) {
    sessions.delete(t);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
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
      engine: "SQLite (better-sqlite3)",
      users,
      groups,
      groupList: groupList.slice(-50).reverse(),
      admins: config.admin.length,
      moderators: config.moderator.length,
    },
    logs: getLogs(),
  };
}

export function startWeb() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, app: "supaniga-penguin" }));

  app.get("/api/session", (req, res) => res.json({ authenticated: isAuthed(req), app: APP_INFO }));

  app.post("/api/login", (req, res) => {
    const ip = req.ip || "unknown";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) {
      return res.status(429).json({ ok: false, error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil((f.until - Date.now()) / 60000)} menit lagi.` });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(password, config.dashboard.password)) {
      const count = (f?.count || 0) + 1;
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
    const t = getToken(req);
    if (t) sessions.delete(t);
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/overview", requireAuth, async (_req, res) => {
    res.json(await overview());
  });

  app.get("/api/system", requireAuth, (_req, res) => res.json(systemInfo()));

  app.post("/api/wa/logout", requireAuth, async (_req, res) => {
    log.warn("Logout sesi WhatsApp diminta dari dashboard");
    await logoutBot();
    res.json({ ok: true });
  });

  app.post("/api/cmds/reload", requireAuth, (_req, res) => {
    const total = loadCommands();
    res.json({ ok: true, total, commands: publicCommands() });
  });

  // Server-Sent Events: console live, status, spesifikasi
  app.get("/api/stream", requireAuth, (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onLog = (e) => send("log", e);
    const onStatus = (s) => send("status", s);
    const onStats = () => send("status", publicStatus());
    bus.on("log", onLog);
    bus.on("status", onStatus);
    bus.on("stats", onStats);
    const timer = setInterval(() => send("system", systemInfo()), 2000);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    send("status", publicStatus());
    req.on("close", () => {
      bus.off("log", onLog);
      bus.off("status", onStatus);
      bus.off("stats", onStats);
      clearInterval(timer);
      clearInterval(ping);
    });
  });

  app.use("/dashboard", express.static(DASHBOARD_DIR, { index: "index.html", maxAge: "1h" }));
  app.get("/", (_req, res) => res.redirect("/dashboard/"));

  const port = getPort();
  app.listen(port, "0.0.0.0", () => {
    log.success(`Dashboard web aktif di port ${port} → buka http://localhost:${port}/dashboard/`);
  });
  return app;
}
