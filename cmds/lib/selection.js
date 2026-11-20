/**
 * Registri pilihan nomor bersama untuk command yang menampilkan daftar hasil
 * (pin, pixiv, yta). Setiap user di setiap chat hanya memiliki SATU pilihan aktif:
 * pencarian terbaru selalu menggantikan pencarian sebelumnya, sehingga balasan
 * angka seperti "1" atau "1, 2" tidak lagi tertangkap oleh command yang salah.
 */
const store = new Map();
const MAX_ENTRIES = 2000;

// Chat pribadi bisa datang sebagai @lid atau @s.whatsapp.net; di luar grup kunci memakai nomor saja.
function key(chatJid, senderNumber) {
  return `${String(chatJid).endsWith("@g.us") ? chatJid : "dm"}:${senderNumber}`;
}

function prune() {
  const now = Date.now();
  for (const [k, entry] of store) if (entry.expiresAt <= now) store.delete(k);
}

/** Simpan pilihan aktif milik `owner` (nama command). */
function set(chatJid, senderNumber, owner, data, ttlMs) {
  prune();
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key(chatJid, senderNumber), { owner, data, expiresAt: Date.now() + ttlMs });
}

/** Ambil data pilihan bila pilihan aktif user memang milik `owner`. */
function get(chatJid, senderNumber, owner) {
  prune();
  const entry = store.get(key(chatJid, senderNumber));
  return entry && entry.owner === owner ? entry.data : null;
}

/** Hapus pilihan aktif bila milik `owner`. */
function clear(chatJid, senderNumber, owner) {
  const k = key(chatJid, senderNumber);
  const entry = store.get(k);
  if (entry && (!owner || entry.owner === owner)) store.delete(k);
}

/**
 * Ubah teks menjadi daftar nomor unik. Menerima "1", "1, 2, 3", "#2", "no 2", "pilih 2".
 * Mengembalikan null bila teks bukan pilihan nomor.
 */
function parseNumbers(text, { multiple = true } = {}) {
  const value = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/^(pilih|nomor|no\.?|nomer|#)\s*/i, "")
    .replace(/[.)]$/, "")
    .trim();
  const pattern = multiple ? /^\d{1,2}(\s*[,\s]\s*\d{1,2})*$/ : /^\d{1,2}$/;
  if (!pattern.test(value)) return null;
  const numbers = [...new Set(value.split(/[\s,]+/).filter(Boolean).map(Number))];
  return numbers.length ? numbers : null;
}

module.exports = { set, get, clear, parseNumbers, _store: store };
