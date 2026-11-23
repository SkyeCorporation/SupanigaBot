/**
 * Sistem level & EXP (pure function, mudah dites).
 *  - Setiap command yang berhasil dijalankan memberi EXP_PER_COMMAND.
 *  - Pesan biasa memberi EXP_PER_MESSAGE, maksimal sekali per MESSAGE_EXP_COOLDOWN_MS per user.
 *  - Pesan biasa juga memberi saldo acak MONEY_PER_MESSAGE_MIN..MAX dengan jeda yang sama.
 *  - EXP yang dibutuhkan untuk naik dari level L ke L+1 adalah expToNext(L).
 */
export const EXP_PER_COMMAND = 10;
export const EXP_PER_MESSAGE = 3;
export const MESSAGE_EXP_COOLDOWN_MS = 60 * 1000;
export const MAX_LEVEL = 999;
/** Saldo per pesan biasa: acak antara MIN dan MAX, mengikuti jeda yang sama dengan EXP pesan. */
export const MONEY_PER_MESSAGE_MIN = 0.4;
export const MONEY_PER_MESSAGE_MAX = 0.8;

/** Bulatkan saldo ke 2 angka desimal (menghindari galat pecahan 0.1 + 0.2). */
export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Jumlah saldo acak untuk satu pesan: 0.4 sampai 0.8, dua angka desimal. */
export function randomMessageMoney(random = Math.random) {
  const min = Math.round(MONEY_PER_MESSAGE_MIN * 100);
  const max = Math.round(MONEY_PER_MESSAGE_MAX * 100);
  return (min + Math.floor(random() * (max - min + 1))) / 100;
}

/** EXP yang dibutuhkan untuk naik dari `level` ke level berikutnya. */
export function expToNext(level) {
  return 100 * Math.max(1, Math.trunc(Number(level) || 1));
}

/** Tambahkan EXP; mengembalikan { level, exp, leveledUp } setelah naik level berapa kali pun. */
export function applyExp(level, exp, amount) {
  let nextLevel = Math.max(1, Math.trunc(Number(level) || 1));
  let nextExp = Math.max(0, Math.trunc(Number(exp) || 0)) + Math.max(0, Math.trunc(Number(amount) || 0));
  let leveledUp = 0;
  while (nextLevel < MAX_LEVEL && nextExp >= expToNext(nextLevel)) {
    nextExp -= expToNext(nextLevel);
    nextLevel++;
    leveledUp++;
  }
  if (nextLevel >= MAX_LEVEL) nextExp = Math.min(nextExp, expToNext(MAX_LEVEL));
  return { level: nextLevel, exp: nextExp, leveledUp };
}
