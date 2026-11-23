import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { applyExp, expToNext, EXP_PER_COMMAND, EXP_PER_MESSAGE } from "../core/level.js";

const require = createRequire(import.meta.url);

test("EXP: +10 per command dan +3 per pesan", () => {
  assert.equal(EXP_PER_COMMAND, 10);
  assert.equal(EXP_PER_MESSAGE, 3);
});

test("Level naik saat EXP mencapai 100 x level", () => {
  assert.equal(expToNext(1), 100);
  assert.deepEqual(applyExp(1, 95, 10), { level: 2, exp: 5, leveledUp: 1 });
  assert.deepEqual(applyExp(1, 0, 99), { level: 1, exp: 99, leveledUp: 0 });
});

test("Transfer .pay memindahkan saldo dan menolak saldo kurang", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-db-"));
  const { initDatabase, usersData } = await import("../core/database.js");
  initDatabase(path.join(dir, "test.db"));
  await usersData.create("6281111111111", "A");
  await usersData.create("6282222222222", "B");
  await usersData.set("6281111111111", { money: 1000 });
  const { from, to } = await usersData.transfer("6281111111111", "6282222222222", 400);
  assert.equal(from.money, 600);
  assert.equal(to.money, 400);
  await assert.rejects(usersData.transfer("6281111111111", "6282222222222", 601), { code: "INSUFFICIENT_FUNDS" });
  await assert.rejects(usersData.transfer("6281111111111", "6281111111111", 1), { code: "SELF_TRANSFER" });
  await assert.rejects(usersData.transfer("6281111111111", "6282222222222", 0), { code: "INVALID_AMOUNT" });
});

test("Argumen .pay <ID> <jumlah>", () => {
  const pay = require("../cmds/pay.js");
  assert.deepEqual(pay._parsePayArgs(["12", "5.000"]), { id: 12, amount: 5000 });
  assert.equal(pay._parsePayArgs(["abc", "10"]), null);
});

test("Pilihan nomor: angka tunggal atau daftar, pencarian terbaru menggantikan yang lama", () => {
  const selection = require("../cmds/lib/selection.js");
  assert.deepEqual(selection.parseNumbers("1, 2, 3"), [1, 2, 3]);
  assert.deepEqual(selection.parseNumbers("2", { multiple: false }), [2]);
  assert.equal(selection.parseNumbers("halo"), null);
  selection.set("chat", "user", "pin", { a: 1 }, 60000);
  selection.set("chat", "user", "yta", { b: 2 }, 60000);
  assert.equal(selection.get("chat", "user", "pin"), null);
  assert.deepEqual(selection.get("chat", "user", "yta"), { b: 2 });
});

test("YTA menerima angka 1-10 hanya bila ada pencarian aktif", () => {
  const selection = require("../cmds/lib/selection.js");
  const yta = require("../cmds/yta.js");
  selection.clear("c2", "u2");
  assert.equal(yta.hasPendingSelection("c2", "u2", null, "1"), false);
  selection.set("c2", "u2", "yta", { results: [{ videoId: "x" }] }, 60000);
  assert.equal(yta.hasPendingSelection("c2", "u2", null, "1"), true);
});

test("AI: tag ekspresi dihapus dari teks dan dicocokkan ke nama file", () => {
  const ai = require("../cmds/ai.js");
  const parsed = ai._parseExpressionTag("*menatapmu datar* Begitu. [ekspresi: marah]");
  assert.equal(parsed.tag, "marah");
  assert.ok(!parsed.text.includes("[ekspresi"));
  const match = ai._matchExpression("marah", parsed.text, [{ name: "senang", file: "senang.png" }, { name: "marah", file: "marah.jpg" }]);
  assert.equal(match.file, "marah.jpg");
});

test("Pilihan di chat pribadi tetap cocok walau JID berbeda (@lid / @s.whatsapp.net)", () => {
  const selection = require("../cmds/lib/selection.js");
  selection.set("123@lid", "6283", "yta", { ok: 1 }, 60000);
  assert.deepEqual(selection.get("6283@s.whatsapp.net", "6283", "yta"), { ok: 1 });
  assert.deepEqual(selection.parseNumbers("2)", { multiple: false }), [2]);
});

test("Saldo per chat acak antara 0.4 dan 0.8", async () => {
  const { randomMessageMoney } = await import("../core/level.js");
  assert.equal(randomMessageMoney(() => 0), 0.4);
  assert.equal(randomMessageMoney(() => 0.999999), 0.8);
  for (let i = 0; i < 500; i++) {
    const value = randomMessageMoney();
    assert.ok(value >= 0.4 && value <= 0.8, `nilai ${value}`);
  }
});

test("Saldo desimal tersimpan tepat dua angka", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-money-"));
  const { initDatabase, usersData } = await import("../core/database.js");
  initDatabase(path.join(dir, "money.db"));
  await usersData.create("6283333333333", "C");
  await usersData.addMoney("6283333333333", 0.4);
  await usersData.addMoney("6283333333333", 0.7);
  const user = await usersData.addMoney("6283333333333", 0.1);
  assert.equal(user.money, 1.2);
});
