/**
 * Utilitas nomor WhatsApp.
 * Sistem ini SELALU memakai nomor (contoh: 6281234567890), bukan ID/JID WhatsApp.
 */

/** Ubah input apa pun ("+62 812-3456", "0812...", "62812@s.whatsapp.net") menjadi digit nomor. */
export function normalizeNumber(input) {
  if (input === null || input === undefined) return null;
  let raw = String(input).trim();
  if (raw.includes("@")) raw = raw.split("@")[0];
  if (raw.includes(":")) raw = raw.split(":")[0];
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  // Format lokal Indonesia: 08xx -> 628xx
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (digits.length < 8 || digits.length > 16) return null;
  return digits;
}

/** JID nomor (xxx@s.whatsapp.net) -> nomor. JID lain (@lid, @g.us) -> null. */
export function pnJidToNumber(jid) {
  if (!jid || typeof jid !== "string") return null;
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return null;
  return normalizeNumber(jid);
}

/** Nomor -> JID untuk mengirim pesan. */
export function numberToJid(number) {
  const n = normalizeNumber(number);
  return n ? `${n}@s.whatsapp.net` : null;
}

/** Sembunyikan nomor untuk ditampilkan (dashboard/log). */
export function maskNumber(number) {
  const n = String(number || "");
  if (n.length < 6) return "••••";
  return `${n.slice(0, 4)}${"•".repeat(Math.max(3, n.length - 6))}${n.slice(-2)}`;
}

/**
 * Resolve JID pengirim (bisa @s.whatsapp.net atau @lid) menjadi nomor.
 * @param {any} sock socket baileys
 * @param {string} jid JID utama
 * @param {{ alt?: string, groupMeta?: any }} [opts]
 */
export async function resolveNumber(sock, jid, opts = {}) {
  if (!jid) return null;
  const direct = pnJidToNumber(jid);
  if (direct) return direct;

  const fromAlt = pnJidToNumber(opts.alt);
  if (fromAlt) return fromAlt;

  if (jid.endsWith("@lid")) {
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      const n = pnJidToNumber(pn);
      if (n) return n;
    } catch {
      /* abaikan */
    }
    const participants = opts.groupMeta?.participants || [];
    const p = participants.find((x) => x.id === jid || x.lid === jid);
    const n = pnJidToNumber(p?.phoneNumber) || pnJidToNumber(p?.id);
    if (n) return n;
  }
  return null;
}
