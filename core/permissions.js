/**
 * Aturan izin & respon bot (pure function, mudah dites).
 *
 * Role command:
 *   0 = semua user
 *   1 = admin grup
 *   2 = moderator bot
 *   3 = admin bot
 */
import { normalizeNumber } from "./number.js";

export const ROLE = Object.freeze({ USER: 0, GROUP_ADMIN: 1, MODERATOR: 2, ADMIN: 3 });

export const ROLE_NAMES = Object.freeze({
  0: "Semua User",
  1: "Admin Grup",
  2: "Moderator Bot",
  3: "Admin Bot",
});

function inList(list, number) {
  const n = normalizeNumber(number);
  if (!n || !Array.isArray(list)) return false;
  return list.some((x) => normalizeNumber(x) === n);
}

/** Level role tertinggi yang dimiliki user. */
export function getRoleLevel({ number, isGroupAdmin = false, config }) {
  if (inList(config?.admin, number)) return ROLE.ADMIN;
  if (inList(config?.moderator, number)) return ROLE.MODERATOR;
  if (isGroupAdmin) return ROLE.GROUP_ADMIN;
  return ROLE.USER;
}

/**
 * Apakah bot boleh merespon pesan ini?
 * - Admin & moderator bot selalu direspon.
 * - User yang dibanned tidak direspon.
 * - Grup yang dibanned / belum diregist hanya merespon admin & moderator bot.
 */
export function shouldRespond({ roleLevel, user, group, isGroup }) {
  if (roleLevel >= ROLE.MODERATOR) return { ok: true };
  if (user?.status?.banned) return { ok: false, reason: "user_banned" };
  if (isGroup) {
    if (!group) return { ok: false, reason: "group_unregistered" };
    if (group.status?.banned) return { ok: false, reason: "group_banned" };
    if (!group.status?.regist) return { ok: false, reason: "group_unregistered" };
  }
  return { ok: true };
}

/** Apakah role user cukup untuk command dengan role tertentu. */
export function hasPermission(roleLevel, requiredRole = 0) {
  return Number(roleLevel) >= Number(requiredRole || 0);
}

