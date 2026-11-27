/**
 * Database SQL (SQLite via better-sqlite3).
 * File: ./database/supaniga.db — dibuat otomatis.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_DIR } from "./paths.js";
import { normalizeNumber } from "./number.js";
import { applyExp, expToNext, roundMoney } from "./level.js";

let db = null;

export function initDatabase(file = process.env.DATABASE_FILE || path.join(DATABASE_DIR, "supaniga.db")) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userID       INTEGER PRIMARY KEY AUTOINCREMENT,
      nomor        TEXT    NOT NULL UNIQUE,
      nama         TEXT    NOT NULL DEFAULT 'Unknown',
      money        INTEGER NOT NULL DEFAULT 0,
      banned       INTEGER NOT NULL DEFAULT 0,
      bannedReason TEXT,
      createdAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wa_groups (
      gid          INTEGER PRIMARY KEY AUTOINCREMENT,
      groupID      TEXT    NOT NULL UNIQUE,
      groupName    TEXT    NOT NULL DEFAULT 'Unknown',
      regist       INTEGER NOT NULL DEFAULT 0,
      banned       INTEGER NOT NULL DEFAULT 0,
      bannedReason TEXT,
      createdAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Migrasi: kolom level & EXP untuk database lama.
  const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  if (!columns.has("level")) db.exec("ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1");
  if (!columns.has("exp")) db.exec("ALTER TABLE users ADD COLUMN exp INTEGER NOT NULL DEFAULT 0");
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database belum diinisialisasi");
  return db;
}

/* ---------- bentuk data ---------- */

function toUser(row) {
  if (!row) return null;
  return {
    nomor: row.nomor,
    nama: row.nama,
    userID: row.userID,
    money: roundMoney(row.money),
    level: row.level ?? 1,
    exp: row.exp ?? 0,
    expToNext: expToNext(row.level ?? 1),
    status: { banned: !!row.banned, bannedReason: row.bannedReason || null },
    createdAt: row.createdAt,
  };
}

function toGroup(row) {
  if (!row) return null;
  return {
    groupID: row.groupID,
    groupName: row.groupName,
    gid: row.gid,
    status: { regist: !!row.regist, banned: !!row.banned, bannedReason: row.bannedReason || null },
    createdAt: row.createdAt,
  };
}

/* ---------- usersData ---------- */

export const usersData = {
  async get(nomor) {
    const n = normalizeNumber(nomor);
    if (!n) return null;
    return toUser(getDb().prepare("SELECT * FROM users WHERE nomor = ?").get(n));
  },
  async getByID(userID) {
    return toUser(getDb().prepare("SELECT * FROM users WHERE userID = ?").get(Number(userID)));
  },
  async create(nomor, nama = "Unknown") {
    const n = normalizeNumber(nomor);
    if (!n) throw new Error("Nomor tidak valid");
    getDb().prepare("INSERT OR IGNORE INTO users (nomor, nama) VALUES (?, ?)").run(n, nama || "Unknown");
    return this.get(n);
  },
  async getOrCreate(nomor, nama) {
    return (await this.get(nomor)) || this.create(nomor, nama);
  },
  /** Update sebagian data: { nama, money, status: { banned, bannedReason } } */
  async set(nomor, data = {}) {
    const n = normalizeNumber(nomor);
    const current = await this.getOrCreate(n);
    const next = {
      nama: data.nama ?? current.nama,
      money: roundMoney(data.money ?? current.money),
      banned: data.status?.banned ?? current.status.banned,
      bannedReason: data.status?.bannedReason !== undefined ? data.status.bannedReason : current.status.bannedReason,
    };
    getDb()
      .prepare(
        "UPDATE users SET nama=?, money=?, banned=?, bannedReason=?, updatedAt=CURRENT_TIMESTAMP WHERE nomor=?",
      )
      .run(next.nama, next.money, next.banned ? 1 : 0, next.bannedReason || null, n);
    return this.get(n);
  },
  async addMoney(nomor, amount) {
    const u = await this.getOrCreate(nomor);
    getDb().prepare("UPDATE users SET money=ROUND(money + ?, 2), updatedAt=CURRENT_TIMESTAMP WHERE nomor=?")
      .run(roundMoney(amount), u.nomor);
    return this.get(u.nomor);
  },
  async subtractMoney(nomor, amount) {
    const value = roundMoney(amount);
    if (!Number.isFinite(Number(amount)) || value < 0) {
      throw Object.assign(new Error("Harga tidak valid."), { code: "INVALID_AMOUNT" });
    }
    const u = await this.getOrCreate(nomor);
    const result = getDb().prepare("UPDATE users SET money=ROUND(money - ?, 2), updatedAt=CURRENT_TIMESTAMP WHERE nomor=? AND ROUND(money, 2) >= ?")
      .run(value, u.nomor, value);
    if (!result.changes) {
      throw Object.assign(new Error("Saldo tidak mencukupi."), { code: "INSUFFICIENT_FUNDS" });
    }
    return this.get(u.nomor);
  },
  /** Tambah EXP; mengembalikan { user, leveledUp } (leveledUp = jumlah kenaikan level). */
  async addExp(nomor, amount) {
    const u = await this.getOrCreate(nomor);
    const next = applyExp(u.level, u.exp, amount);
    getDb()
      .prepare("UPDATE users SET level=?, exp=?, updatedAt=CURRENT_TIMESTAMP WHERE nomor=?")
      .run(next.level, next.exp, u.nomor);
    return { user: await this.get(u.nomor), leveledUp: next.leveledUp };
  },
  /**
   * Transfer uang antar user secara atomik.
   * Error (properti `code`): INVALID_AMOUNT, SELF_TRANSFER, SENDER_NOT_FOUND, TARGET_NOT_FOUND, INSUFFICIENT_FUNDS.
   */
  async transfer(fromNomor, toNomor, amount) {
    const value = Number(amount);
    const fail = (code, message) => Object.assign(new Error(message), { code });
    if (!Number.isSafeInteger(value) || value <= 0) throw fail("INVALID_AMOUNT", "Jumlah harus bilangan bulat lebih dari 0.");
    const from = normalizeNumber(fromNomor);
    const to = normalizeNumber(toNomor);
    if (!from) throw fail("SENDER_NOT_FOUND", "Pengirim tidak ditemukan.");
    if (!to) throw fail("TARGET_NOT_FOUND", "Penerima tidak ditemukan.");
    if (from === to) throw fail("SELF_TRANSFER", "Tidak dapat mengirim uang ke diri sendiri.");
    const database = getDb();
    const run = database.transaction(() => {
      const sender = database.prepare("SELECT * FROM users WHERE nomor = ?").get(from);
      const target = database.prepare("SELECT * FROM users WHERE nomor = ?").get(to);
      if (!sender) throw fail("SENDER_NOT_FOUND", "Pengirim tidak ditemukan.");
      if (!target) throw fail("TARGET_NOT_FOUND", "Penerima tidak ditemukan.");
      if (sender.money < value) throw fail("INSUFFICIENT_FUNDS", "Saldo tidak mencukupi.");
      database.prepare("UPDATE users SET money = ROUND(money - ?, 2), updatedAt=CURRENT_TIMESTAMP WHERE nomor = ?").run(value, from);
      database.prepare("UPDATE users SET money = ROUND(money + ?, 2), updatedAt=CURRENT_TIMESTAMP WHERE nomor = ?").run(value, to);
    });
    run();
    return { from: await this.get(from), to: await this.get(to) };
  },
  async ban(nomor, reason = null) {
    return this.set(nomor, { status: { banned: true, bannedReason: reason } });
  },
  async unban(nomor) {
    return this.set(nomor, { status: { banned: false, bannedReason: null } });
  },
  async getAll() {
    return getDb().prepare("SELECT * FROM users ORDER BY userID").all().map(toUser);
  },
  async count() {
    const r = getDb().prepare("SELECT COUNT(*) total, SUM(banned) banned FROM users").get();
    return { total: r.total || 0, banned: r.banned || 0 };
  },
};

/* ---------- groupsData ---------- */

export const groupsData = {
  async get(groupID) {
    if (!groupID) return null;
    return toGroup(getDb().prepare("SELECT * FROM wa_groups WHERE groupID = ?").get(groupID));
  },
  async getByGid(gid) {
    return toGroup(getDb().prepare("SELECT * FROM wa_groups WHERE gid = ?").get(Number(gid)));
  },
  async create(groupID, groupName = "Unknown") {
    getDb()
      .prepare("INSERT OR IGNORE INTO wa_groups (groupID, groupName) VALUES (?, ?)")
      .run(groupID, groupName || "Unknown");
    return this.get(groupID);
  },
  async getOrCreate(groupID, groupName) {
    const g = await this.get(groupID);
    if (g) {
      if (groupName && groupName !== g.groupName) return this.set(groupID, { groupName });
      return g;
    }
    return this.create(groupID, groupName);
  },
  /** Update sebagian data: { groupName, status: { regist, banned, bannedReason } } */
  async set(groupID, data = {}) {
    const current = await this.getOrCreate(groupID);
    const next = {
      groupName: data.groupName ?? current.groupName,
      regist: data.status?.regist ?? current.status.regist,
      banned: data.status?.banned ?? current.status.banned,
      bannedReason: data.status?.bannedReason !== undefined ? data.status.bannedReason : current.status.bannedReason,
    };
    getDb()
      .prepare(
        "UPDATE wa_groups SET groupName=?, regist=?, banned=?, bannedReason=?, updatedAt=CURRENT_TIMESTAMP WHERE groupID=?",
      )
      .run(next.groupName, next.regist ? 1 : 0, next.banned ? 1 : 0, next.bannedReason || null, groupID);
    return this.get(groupID);
  },
  async regist(groupID) {
    return this.set(groupID, { status: { regist: true } });
  },
  async unregist(groupID) {
    return this.set(groupID, { status: { regist: false } });
  },
  async ban(groupID, reason = null) {
    return this.set(groupID, { status: { banned: true, bannedReason: reason } });
  },
  async unban(groupID) {
    return this.set(groupID, { status: { banned: false, bannedReason: null } });
  },
  async getAll() {
    return getDb().prepare("SELECT * FROM wa_groups ORDER BY gid").all().map(toGroup);
  },
  async count() {
    const r = getDb()
      .prepare("SELECT COUNT(*) total, SUM(regist) regist, SUM(banned) banned FROM wa_groups")
      .get();
    return { total: r.total || 0, regist: r.regist || 0, banned: r.banned || 0 };
  },
};
