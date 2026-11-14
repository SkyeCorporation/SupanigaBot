/**
 * Database SQL (SQLite via better-sqlite3).
 * File: ./database/supaniga.db — dibuat otomatis.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_DIR } from "./paths.js";
import { normalizeNumber } from "./number.js";

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
    money: row.money,
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
      money: Math.trunc(Number(data.money ?? current.money)) || 0,
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
    return this.set(u.nomor, { money: u.money + Math.trunc(Number(amount) || 0) });
  },
  async subtractMoney(nomor, amount) {
    const u = await this.getOrCreate(nomor);
    return this.set(u.nomor, { money: u.money - Math.trunc(Number(amount) || 0) });
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
