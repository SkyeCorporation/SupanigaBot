/**
 * PIXIV — cari ilustrasi dari Pixiv.
 * Bot mengirim SATU gambar kolase bertema futuristic space berisi 8 karya bernomor,
 * lalu user cukup mengetik nomornya di chat (tanpa reply). Beberapa karya: 1, 2, 3
 *
 *   .pixiv <kata kunci> [-halaman] [-adult]
 *   .pixiv nakano miku -1 -adult   -> halaman 1 versi adult (R-18)
 *
 * Mode adult membutuhkan sesi akun Pixiv yang mengaktifkan tampilan R-18, diisi pada
 * environment variable PIXIV_COOKIE (nilai PHPSESSID atau string cookie lengkap).
 */
const selection = require("./lib/selection");
const { renderCollage } = require("./lib/collage");

const PER_PAGE = 8;
const PIXIV_PAGE_SIZE = 60;
const MAX_PAGE = 50;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Pengaman: karya dengan penanda anak di bawah umur tidak pernah ditampilkan pada mode adult.
const BLOCKED_TAGS = /loli|shota|ロリ|ようじょ|ショタ|幼女|幼児|児童|小学生|中学生|子供|こども|toddler|underage|child|kid(?!nap)/i;

function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 600);
}
function clean(value, max = 120) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}
function isPximg(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "i.pximg.net" || url.hostname.endsWith(".pximg.net"));
  } catch { return false; }
}

function headers(extra = {}) {
  const cookie = String(process.env.PIXIV_COOKIE || process.env.PIXIV_PHPSESSID || "").trim();
  const h = { "user-agent": UA, referer: "https://www.pixiv.net/", accept: "application/json", "accept-language": "en-US,en;q=0.9", ...extra };
  if (cookie) h.cookie = cookie.includes("=") ? cookie : `PHPSESSID=${cookie}`;
  return h;
}

/** "nakano miku -2 -adult" -> { keyword, page, adult } (flag boleh di posisi mana pun). */
function parseArgs(args) {
  let page = 1;
  let adult = false;
  const words = [];
  for (const token of args) {
    const lower = String(token).toLowerCase();
    if (lower === "-adult" || lower === "-r18" || lower === "-18") adult = true;
    else if (/^-\d+$/.test(lower)) page = Number(lower.slice(1));
    else words.push(token);
  }
  return { keyword: words.join(" ").trim(), page, adult };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Pixiv merespons HTTP ${response.status}`);
  const json = await response.json().catch(() => null);
  if (!json || json.error) throw new Error(json?.message || "Respons Pixiv tidak bisa dibaca.");
  return json.body;
}

async function searchPage(keyword, mode, p, searchMode) {
  const q = encodeURIComponent(keyword);
  const url = `https://www.pixiv.net/ajax/search/illustrations/${q}?word=${q}&order=date_d&mode=${mode}&p=${p}&s_mode=${searchMode}&type=illust&lang=en`;
  const body = await fetchJson(url);
  const data = body?.illust?.data || body?.illustManga?.data || [];
  return { items: data, total: body?.illust?.total ?? body?.illustManga?.total ?? 0 };
}

/** "…/c/250x250_80_a2/img-master/…_p0_square1200.jpg" -> pratinjau 540px (rasio asli). */
function previewUrl(thumb) {
  const upgraded = String(thumb)
    .replace(/\/c\/[^/]+\/(img-master|custom-thumb)\//, "/c/540x540_70/img-master/")
    .replace(/_(square|custom)1200\./, "_master1200.");
  return isPximg(upgraded) ? upgraded : thumb;
}

/** Ambil 8 karya untuk halaman kolase yang diminta. */
async function searchPixiv(keyword, page, adult) {
  const mode = adult ? "r18" : "safe";
  const start = (page - 1) * PER_PAGE;
  const firstPage = Math.floor(start / PIXIV_PAGE_SIZE) + 1;
  const offset = start % PIXIV_PAGE_SIZE;
  let collected = [];
  for (const searchMode of ["s_tag", "s_tc"]) {
    collected = [];
    for (let p = firstPage; p < firstPage + 2 && collected.length < offset + PER_PAGE; p++) {
      const { items } = await searchPage(keyword, mode, p, searchMode);
      collected.push(...items);
      if (items.length < PIXIV_PAGE_SIZE) break;
    }
    if (collected.length > offset) break;
  }
  const works = collected.slice(offset).filter((item) => {
    if (!/^\d+$/.test(String(item.id)) || !isPximg(item.url)) return false;
    if (item.isMasked || item.isUnlisted) return false;
    if (adult) {
      if (Number(item.xRestrict) < 1) return false;
      if ((item.tags || []).some((tag) => BLOCKED_TAGS.test(tag)) || BLOCKED_TAGS.test(item.title || "")) return false;
    } else if (Number(item.xRestrict) > 0) {
      return false;
    }
    return true;
  });
  return works.slice(0, PER_PAGE).map((item) => ({
    id: String(item.id),
    title: clean(item.title, 100) || "Karya Pixiv",
    artist: clean(item.userName, 60),
    pages: Number(item.pageCount) || 1,
    preview: previewUrl(item.url),
    thumb: item.url,
    link: `https://www.pixiv.net/artworks/${item.id}`,
  }));
}

// Bila jaringan hosting memblokir i.pximg.net, gambar diambil lewat mirror publik.
// PIXIV_IMAGE_PROXY (opsional) = host mirror sendiri, dicoba paling awal.
const IMAGE_HOSTS = ["i.pximg.net", "i.pixiv.re", "i.pixiv.nl"];
let preferredHost = null;

function imageHosts() {
  const custom = String(process.env.PIXIV_IMAGE_PROXY || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return [...new Set([custom, preferredHost, ...IMAGE_HOSTS].filter(Boolean))];
}

async function fetchImage(url, maxBytes) {
  const direct = new URL(url).hostname === "i.pximg.net";
  const response = await fetch(url, {
    headers: direct ? { "user-agent": UA, referer: "https://www.pixiv.net/", accept: "image/*" } : { "user-agent": UA, accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error(`bukan gambar (${mime || "content-type kosong"})`);
  if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new Error("gambar terlalu besar");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error("gambar kosong atau terlalu besar");
  return { buffer, mime };
}

/** Unduh gambar Pixiv: langsung dulu, lalu lewat mirror. Host yang berhasil diingat. */
async function downloadImage(url, maxBytes = MAX_IMAGE_BYTES) {
  if (!isPximg(url)) throw new Error("URL gambar Pixiv tidak valid.");
  const original = new URL(url);
  const errors = [];
  for (const host of imageHosts()) {
    const target = new URL(original);
    if (original.hostname === "i.pximg.net") target.hostname = host;
    try {
      const image = await fetchImage(target.toString(), maxBytes);
      preferredHost = host;
      return image;
    } catch (error) {
      errors.push(`${host}: ${error?.cause?.code || (error?.name === "TimeoutError" && "timeout") || errorText(error)}`);
    }
    if (original.hostname !== "i.pximg.net") break;
  }
  throw new Error(`Unduh gambar gagal: ${errors.join("; ")}`);
}

/** Versi terbaik yang muat di WhatsApp: original, lalu regular bila original terlalu besar. */
async function downloadArtwork(id) {
  const pages = await fetchJson(`https://www.pixiv.net/ajax/illust/${id}/pages?lang=en`);
  const urls = pages?.[0]?.urls || {};
  let lastError = null;
  for (const url of [urls.original, urls.regular, urls.small]) {
    if (!url) continue;
    try { return await downloadImage(url); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Tautan gambar tidak ditemukan.");
}

module.exports = {
  config: {
    name: "pixiv",
    aliases: ["px"],
    cooldown: 10,
    description: "Mencari ilustrasi dari Pixiv dalam kolase bernomor; tambahkan -adult untuk versi dewasa",
    usage: "pixiv <kata kunci> [-halaman] [-adult], lalu ketik nomor karya (contoh: 1 atau 1, 2)",
    category: "Media",
    price: 0,
    role: 0,
  },
  _parseArgs: parseArgs,
  _searchPixiv: searchPixiv,
  _downloadImage: downloadImage,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    return !!selection.parseNumbers(text) && !!selection.get(chatJid, senderNumber, "pixiv");
  },
  onStart: async function ({ api, event, args, prefix }) {
    const { keyword, page, adult } = parseArgs(args);
    if (!keyword || keyword.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
      return api.reply(`Gunakan: ${prefix}pixiv <kata kunci> [-halaman] [-adult]\nContoh: ${prefix}pixiv nakano miku -1\nContoh adult: ${prefix}pixiv nakano miku -1 -adult`);
    }
    if (adult && !String(process.env.PIXIV_COOKIE || process.env.PIXIV_PHPSESSID || "").trim()) {
      return api.reply("Mode adult belum dikonfigurasi. Admin perlu mengisi PIXIV_COOKIE (PHPSESSID akun Pixiv dengan R-18 aktif) pada environment hosting.");
    }

    await api.reply(`Mencari "${keyword}" di Pixiv${adult ? " (adult)" : ""}...`);
    try {
      const found = await searchPixiv(keyword, page, adult);
      if (!found.length) {
        return api.reply(`Tidak ada karya Pixiv${adult ? " adult" : ""} untuk "${keyword}" di halaman ${page}. Silakan gunakan kata kunci lain, misalnya nama karakter dalam bahasa Inggris atau Jepang.`);
      }
      const downloads = await Promise.allSettled(found.map((item) => downloadImage(item.preview, 6 * 1024 * 1024).catch(() => downloadImage(item.thumb, 6 * 1024 * 1024))));
      const works = [];
      const buffers = [];
      const errors = [];
      downloads.forEach((result, i) => {
        if (result.status === "fulfilled") { works.push(found[i]); buffers.push(result.value.buffer); }
        else errors.push(errorText(result.reason));
      });
      if (!works.length) throw new Error(`Semua gambar gagal diambil. ${errors[0] || ""}`.trim());

      const grid = await renderCollage(buffers, {
        source: "Pixiv", query: keyword, page, badge: adult ? "R-18" : "",
        palette: adult ? ["PLASMA", "SOLAR", "CYAN-MAGENTA"] : ["ION-BLUE", "CYAN-MAGENTA", "AURORA", "QUANTUM"],
      });
      selection.set(event.chatJid, event.senderNumber, "pixiv", { keyword, adult, works }, RESULT_TTL);
      await api.sendMessage({
        image: grid,
        caption:
          `*Pixiv${adult ? " (adult)" : ""}: ${keyword}*${page > 1 ? ` (halaman ${page})` : ""}\n` +
          `${works.length} karya. Ketik nomor untuk menerima versi aslinya.\n` +
          `Contoh: 1 atau 1, 2, 3\nBerlaku 15 menit.`,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pixiv] ${detail}`);
      await api.reply(`Pencarian Pixiv gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text }) {
    const result = selection.get(event.chatJid, event.senderNumber, "pixiv");
    const numbers = selection.parseNumbers(text);
    if (!result || !numbers) return false;
    const invalid = numbers.filter((n) => n < 1 || n > result.works.length);
    if (invalid.length) {
      await api.reply(`Nomor ${invalid.join(", ")} tidak tersedia. Pilih 1-${result.works.length}, pisahkan dengan koma.`);
      return true;
    }
    selection.clear(event.chatJid, event.senderNumber, "pixiv");
    const failed = [];
    for (const n of numbers) {
      const work = result.works[n - 1];
      try {
        const { buffer } = await downloadArtwork(work.id);
        await api.sendMessage({
          image: buffer,
          caption: `${n}. ${work.title}\nArtis: ${work.artist || "-"}${work.pages > 1 ? `\nHalaman: 1 dari ${work.pages}` : ""}\nSumber: ${work.link}`,
        });
      } catch (error) {
        failed.push(`${n} (${errorText(error)})`);
      }
    }
    if (failed.length) await api.reply(`Gagal mengirim karya nomor ${failed.join("; ")}`).catch(() => {});
    return true;
  },
};
