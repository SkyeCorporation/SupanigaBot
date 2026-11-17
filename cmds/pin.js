/**
 * PIN — cari foto dari Pinterest.
 * Bot mengirim SATU gambar kolase berisi 8 foto bernomor (anti spam), lalu user
 * cukup ketik angka di chat (tanpa reply). Bisa pilih beberapa dengan koma: 1, 2, 3
 */
const sharp = require("sharp");
const MAX_RESULTS = 8;
const PAGE_SIZE = 25;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SELECTION_RE = /^\d{1,2}(\s*,\s*\d{1,2})*$/;
const searches = new Map();

function keyFor(chatJid, senderNumber) {
  return `${chatJid}:${senderNumber}`;
}
function prune() {
  const now = Date.now();
  for (const [key, result] of searches) if (result.expiresAt <= now) searches.delete(key);
}
function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 600);
}
function clean(value, max = 120) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}
function isPinimg(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "i.pinimg.com" || url.hostname.endsWith(".pinimg.com"));
  } catch { return false; }
}

/** "1, 2, 3" -> [1, 2, 3] (unik, urut sesuai ketikan). */
function parseSelection(text) {
  const value = String(text || "").trim();
  if (!SELECTION_RE.test(value)) return null;
  return [...new Set(value.split(",").map((part) => Number(part.trim())))];
}

async function pinterestPage(keyword, bookmark) {
  const data = { options: { query: keyword, scope: "pins", page_size: PAGE_SIZE, bookmarks: bookmark ? [bookmark] : [] }, context: {} };
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(keyword)}`;
  const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "x-pinterest-pws-handler": "www/search/[scope].js",
      referer: "https://www.pinterest.com/",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Pinterest merespons HTTP ${response.status}`);
  const json = await response.json().catch(() => null);
  const res = json?.resource_response;
  if (!res) throw new Error("Respons Pinterest tidak bisa dibaca.");
  const pins = (res.data?.results || []).map((pin) => {
    const images = pin.images || {};
    const full = images.orig?.url || images["736x"]?.url;
    const preview = images["474x"]?.url || images["236x"]?.url || full;
    const title = clean(pin.title || pin.grid_title || pin.description || pin.auto_alt_text, 120) || "Foto Pinterest";
    const link = /^\d+$/.test(String(pin.id)) ? `https://www.pinterest.com/pin/${pin.id}/` : null;
    return { title, full, preview, link };
  }).filter((pin) => isPinimg(pin.full) && isPinimg(pin.preview));
  const next = res.bookmark && res.bookmark !== "-end-" ? res.bookmark : null;
  return { pins, next };
}

/** Kumpulkan hasil sampai halaman yang diminta (8 foto per halaman). */
async function searchPinterest(keyword, page) {
  const needed = page * MAX_RESULTS;
  const all = [];
  const seen = new Set();
  let bookmark = null;
  for (let i = 0; i < 12 && all.length < needed; i++) {
    const { pins, next } = await pinterestPage(keyword, bookmark);
    for (const pin of pins) if (!seen.has(pin.full)) { seen.add(pin.full); all.push(pin); }
    if (!next) break;
    bookmark = next;
  }
  return all.slice((page - 1) * MAX_RESULTS, needed);
}

async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": UA, referer: "https://www.pinterest.com/" } });
  if (!response.ok) throw new Error(`Unduh gambar HTTP ${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error(`URL bukan gambar (${mime || "content-type kosong"})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Ukuran gambar melebihi 8 MB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error(`Gambar kosong atau melebihi 8 MB (${buffer.length} byte)`);
  return { buffer, mime };
}


// Angka digambar sebagai garis SVG (bukan font) agar tetap tampil di server tanpa font.
const DIGITS = {
  0: "M20 8 C11 8 9 20 9 30 C9 40 11 52 20 52 C29 52 31 40 31 30 C31 20 29 8 20 8 Z",
  1: "M12 16 L22 8 V52",
  2: "M10 18 C10 6 30 6 30 18 C30 29 10 39 10 52 H31",
  3: "M10 13 C14 6 30 6 30 18 C30 26 23 29 18 29 C25 29 31 33 31 41 C31 54 14 56 9 47",
  4: "M26 52 V8 L8 38 H33",
  5: "M30 8 H13 L11 28 C14 25 18 24 21 24 C28 24 32 30 32 38 C32 50 22 54 16 52 C13 51 11 49 9 47",
  6: "M28 10 C14 7 9 22 9 36 C9 48 15 53 20 53 C27 53 31 47 31 40 C31 33 27 28 20 28 C14 28 9 33 9 38",
  7: "M9 8 H31 L17 52",
  8: "M20 29 C12 29 11 23 11 19 C11 12 15 8 20 8 C25 8 29 12 29 19 C29 23 28 29 20 29 C11 29 9 36 9 41 C9 48 14 53 20 53 C26 53 31 48 31 41 C31 36 29 29 20 29 Z",
  9: "M31 22 C31 27 26 32 20 32 C13 32 9 27 9 20 C9 13 14 8 20 8 C27 8 31 13 31 22 C31 38 27 52 12 51",
};
const TILE = 300;
const GAP = 14;
const PAD = 22;
const BADGE = 62;

function badgeSvg(number) {
  const digits = String(number).split("");
  const glyphW = 40 * 0.62;
  const startX = BADGE / 2 - (digits.length * glyphW) / 2;
  const paths = digits.map((d, i) =>
    `<path d="${DIGITS[d]}" transform="translate(${startX + i * glyphW} ${BADGE / 2 - 30 * 0.62}) scale(0.62)" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  ).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE}" height="${BADGE}">` +
    `<circle cx="${BADGE / 2}" cy="${BADGE / 2}" r="${BADGE / 2 - 3}" fill="#e60023" stroke="#ffffff" stroke-width="4"/>${paths}</svg>`,
  );
}

async function tileImage(buffer) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="22" ry="22"/></svg>`);
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.35" stop-color="#000" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="${TILE}" height="${TILE}" fill="url(#g)"/></svg>`,
  );
  return sharp(buffer)
    .resize(TILE, TILE, { fit: "cover", position: "centre" })
    .composite([{ input: shade }, { input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Satu gambar kolase: maksimal 4 kolom, tiap foto diberi lencana nomor. */
async function renderGrid(buffers) {
  const cols = Math.min(4, buffers.length);
  const rows = Math.ceil(buffers.length / 4);
  const width = PAD * 2 + cols * TILE + (cols - 1) * GAP;
  const height = PAD * 2 + rows * TILE + (rows - 1) * GAP;
  const tiles = await Promise.all(buffers.map(tileImage));
  const layers = [];
  tiles.forEach((tile, i) => {
    const left = PAD + (i % 4) * (TILE + GAP);
    const top = PAD + Math.floor(i / 4) * (TILE + GAP);
    layers.push({ input: tile, left, top });
    layers.push({ input: badgeSvg(i + 1), left: left + 12, top: top + 12 });
  });
  return sharp({ create: { width, height, channels: 3, background: "#111318" } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

module.exports = {
  config: {
    name: "pin",
    cooldown: 8,
    description: "Cari foto dari Pinterest, lalu pilih dengan ketik nomor (bisa 1, 2, 3)",
    usage: "pin <kata kunci> [-halaman]",
    category: "Media",
    price: 0,
    role: 0,
  },
  _parseSelection: parseSelection,
  _renderGrid: renderGrid,
  _searchPinterest: searchPinterest,
  _downloadImage: downloadImage,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    prune();
    return !!parseSelection(text) && searches.has(keyFor(chatJid, senderNumber));
  },
  onStart: async function ({ api, event, args, prefix }) {
    prune();
    const raw = args.join(" ").trim();
    const pageMatch = raw.match(/\s+-(\d+)\s*$/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    const keyword = (pageMatch ? raw.slice(0, pageMatch.index) : raw).trim();
    if (!keyword || keyword.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 10) {
      return api.reply(`Gunakan: ${prefix}pin <kata kunci> [-halaman]\nContoh: ${prefix}pin kucing -2`);
    }

    await api.reply(`Mencari "${keyword}" di Pinterest...`);
    try {
      const found = await searchPinterest(keyword, page);
      if (!found.length) return api.reply(`Tidak ada foto Pinterest untuk "${keyword}" di halaman ${page}. Coba kata kunci lain.`);

      const downloads = await Promise.allSettled(found.map((item) => downloadImage(item.preview)));
      const sent = [];
      const buffers = [];
      const errors = [];
      downloads.forEach((result, i) => {
        if (result.status === "fulfilled") { sent.push(found[i]); buffers.push(result.value.buffer); }
        else errors.push(errorText(result.reason));
      });
      if (!sent.length) throw new Error(`Semua foto gagal diambil. ${errors[0] || ""}`.trim());

      const grid = await renderGrid(buffers);
      searches.set(keyFor(event.chatJid, event.senderNumber), { keyword, images: sent, expiresAt: Date.now() + RESULT_TTL });
      await api.sendMessage({
        image: grid,
        caption:
          `*Pinterest: ${keyword}*${page > 1 ? ` (halaman ${page})` : ""}\n` +
          `${sent.length} foto. Ketik nomor untuk menerima versi aslinya.\n` +
          `Contoh: 1 atau 1, 2, 3\nBerlaku 15 menit.`,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pin] ${detail}`);
      await api.reply(`Pencarian PIN gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text }) {
    prune();
    const key = keyFor(event.chatJid, event.senderNumber);
    const result = searches.get(key);
    const numbers = parseSelection(text);
    if (!result || !numbers) return false;
    const invalid = numbers.filter((n) => n < 1 || n > result.images.length);
    if (invalid.length) {
      await api.reply(`Nomor ${invalid.join(", ")} tidak tersedia. Pilih 1-${result.images.length}, pisahkan dengan koma.`);
      return true;
    }
    searches.delete(key);
    const failed = [];
    for (const n of numbers) {
      const item = result.images[n - 1];
      try {
        const { buffer } = await downloadImage(item.full);
        await api.sendMessage({ image: buffer, caption: `${n}. ${item.title}\nSumber: Pinterest${item.link ? `\n${item.link}` : ""}` });
      } catch (error) {
        failed.push(`${n} (${errorText(error)})`);
      }
    }
    if (failed.length) await api.reply(`Gagal mengirim foto nomor ${failed.join("; ")}`).catch(() => {});
    return true;
  },
};
