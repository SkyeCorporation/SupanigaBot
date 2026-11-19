/**
 * PIXIV — cari ilustrasi/manga di Pixiv.
 * - `pixiv <kata kunci> [-halaman]` : satu kolase 8 karya bernomor, lalu ketik nomor (bisa 1, 2, 3).
 * - `pixiv <ID | link artworks>`    : langsung kirim karya itu (semua halaman, maks 10).
 * Fitur khusus:
 *   -populer : urutkan populer (karya populer gratis; urutan populer penuh butuh akun Premium)
 *   -r18     : karya R-18 (butuh login lewat PIXIV_COOKIE, hanya di chat pribadi)
 *   -noai    : sembunyikan karya buatan AI
 * Login Pixiv lewat env PIXIV_COOKIE (nilai cookie PHPSESSID dari browser).
 */
const pin = require("./pin.js");

const MAX_RESULTS = 8;
const MAX_PAGES = 10;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SELECTION_RE = /^\d{1,2}(\s*,\s*\d{1,2})*$/;
// Karya R-18 dengan tag yang mengarah ke anak di bawah umur selalu dibuang.
const BLOCKED_ADULT_TAGS = /ロリ|ようじょ|幼女|幼児|児童|ショタ|小学生|中学生|子供|こども|loli|shota|child|kid\b|underage|toddler/i;
const searches = new Map();

// Chat pribadi bisa datang sebagai @lid atau @s.whatsapp.net; kunci pakai nomor saja.
function keyFor(chatJid, senderNumber) {
  return `${String(chatJid).endsWith("@g.us") ? chatJid : "dm"}:${senderNumber}`;
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
function parseSelection(text) {
  const value = String(text || "").trim();
  if (!SELECTION_RE.test(value)) return null;
  return [...new Set(value.split(",").map((part) => Number(part.trim())))];
}

/** Cookie login dari env PIXIV_COOKIE: boleh nilai PHPSESSID saja atau header cookie lengkap. */
function pixivCookie() {
  const raw = String(process.env.PIXIV_COOKIE || "").trim();
  if (!raw) return "";
  return raw.includes("=") ? raw : `PHPSESSID=${raw}`;
}

function headers(extra = {}) {
  const cookie = pixivCookie();
  return {
    "user-agent": UA,
    referer: "https://www.pixiv.net/",
    "accept-language": "id,en;q=0.9,ja;q=0.8",
    ...(cookie ? { cookie } : {}),
    ...extra,
  };
}

async function pixivApi(pathAndQuery) {
  const response = await fetch(`https://www.pixiv.net/ajax/${pathAndQuery}`, {
    headers: headers({ accept: "application/json" }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || json.error) {
    throw new Error(json?.message || `Pixiv merespons HTTP ${response.status}`);
  }
  return json.body;
}

// Server gambar Pixiv (i.pximg.net) sering diblokir provider internet (mis. di Indonesia)
// atau menolak tanpa referer. Bila gagal, bot otomatis memakai mirror gambar publik.
// PIXIV_IMAGE_PROXY (opsional) = host mirror sendiri, dicoba paling awal.
const IMAGE_HOSTS = ["i.pximg.net", "i.pixiv.re", "i.pixiv.nl"];
let preferredHost = null;

function imageHosts() {
  const custom = String(process.env.PIXIV_IMAGE_PROXY || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const hosts = [custom, preferredHost, ...IMAGE_HOSTS].filter(Boolean);
  return [...new Set(hosts)];
}

async function fetchImage(url, maxBytes) {
  const direct = new URL(url).hostname === "i.pximg.net";
  const response = await fetch(url, {
    headers: direct ? headers({ accept: "image/*" }) : { "user-agent": UA, accept: "image/*" },
    ...(direct ? { referrer: "https://www.pixiv.net/" } : {}),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error(`bukan gambar (${mime || "content-type kosong"})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("gambar terlalu besar");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error("gambar kosong atau terlalu besar");
  return { buffer, mime };
}

/** Unduh gambar Pixiv: langsung dulu, lalu lewat mirror. Host yang berhasil diingat. */
async function downloadImage(url, maxBytes = MAX_IMAGE_BYTES) {
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
  throw new Error(errors.join("; "));
}

/** Thumbnail kotak 250px -> versi 540px yang tidak dipotong, untuk kolase. */
function previewUrl(thumb) {
  const m = String(thumb).match(/\/img\/(\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d+_p0)_(?:square|custom)1200\.(\w+)$/);
  return m ? `https://i.pximg.net/c/540x540_70/img-master/img/${m[1]}_master1200.${m[2]}` : thumb;
}

function isAllowed(work, adult) {
  if (!work?.id || Number(work.xRestrict) === 2) return false; // R-18G tidak pernah dikirim
  if (!adult) return Number(work.xRestrict) === 0;
  if (Number(work.xRestrict) !== 1) return false;
  return !BLOCKED_ADULT_TAGS.test([work.title, ...(work.tags || [])].join(" "));
}

function toItem(work) {
  return {
    id: String(work.id),
    title: clean(work.title || work.illustTitle || "Tanpa judul", 90),
    user: clean(work.userName, 50),
    pages: Number(work.pageCount) || 1,
    type: Number(work.illustType) || 0,
    ai: Number(work.aiType) === 2,
    preview: previewUrl(work.url),
    thumb: work.url,
  };
}

async function searchPixiv(keyword, { page, adult, popular, noAi }) {
  const params = new URLSearchParams({
    word: keyword,
    order: popular ? "popular_d" : "date_d",
    mode: adult ? "r18" : "safe",
    p: String(page),
    s_mode: "s_tag",
    type: "all",
    lang: "en",
  });
  if (noAi) params.set("ai_type", "1");
  const body = await pixivApi(`search/artworks/${encodeURIComponent(keyword)}?${params}`);
  const list = [];
  // Bagian "populer" tersedia gratis; dipakai dulu untuk -populer di halaman 1.
  if (popular && page === 1) list.push(...(body.popular?.permanent || []), ...(body.popular?.recent || []));
  list.push(...(body.illustManga?.data || []));
  const seen = new Set();
  const items = [];
  for (const work of list) {
    if (!isAllowed(work, adult) || (noAi && Number(work.aiType) === 2) || seen.has(String(work.id))) continue;
    seen.add(String(work.id));
    items.push(toItem(work));
    if (items.length >= MAX_RESULTS) break;
  }
  return { items, total: Number(body.illustManga?.total) || items.length };
}

/** Kirim satu karya: semua halaman (maks MAX_PAGES), kualitas asli bila muat. */
async function sendWork(api, item, number) {
  const pages = await pixivApi(`illust/${item.id}/pages?lang=en`);
  const list = (Array.isArray(pages) ? pages : []).slice(0, MAX_PAGES);
  if (!list.length) throw new Error("Halaman karya tidak ditemukan.");
  let sent = 0;
  let lastError = null;
  for (const [index, pageInfo] of list.entries()) {
    let image;
    for (const url of [pageInfo.urls?.original, pageInfo.urls?.regular, pageInfo.urls?.small].filter(Boolean)) {
      try {
        image = await downloadImage(url);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!image) continue;
    const head =
      index === 0
        ? `${number ? `${number}. ` : ""}${item.title}\nArtis: ${item.user || "-"}\n` +
          `${item.pages > 1 ? `Halaman: ${item.pages}${item.pages > MAX_PAGES ? ` (dikirim ${MAX_PAGES} pertama)` : ""}` : ""}` +
          `${item.type === 2 ? "Animasi (ugoira), dikirim frame pertama\n" : ""}${item.ai ? "Karya AI\n" : ""}` +
          `https://www.pixiv.net/artworks/${item.id}`
        : `${item.title} - halaman ${index + 1}`;
    await api.sendMessage({ image: image.buffer, caption: head });
    sent++;
  }
  if (!sent) throw new Error(`Semua gambar gagal diambil${lastError ? ` (${errorText(lastError)})` : ""}.`);
}

function workId(text) {
  const value = String(text).trim();
  if (/^\d{5,12}$/.test(value)) return value;
  return value.match(/pixiv\.net\/(?:[a-z]{2}\/)?(?:artworks\/|member_illust\.php\?.*illust_id=)(\d{5,12})/i)?.[1] || null;
}

module.exports = {
  config: {
    name: "pixiv",
    aliases: ["pix"],
    cooldown: 8,
    description: "Cari ilustrasi Pixiv, lalu pilih dengan ketik nomor (bisa 1, 2, 3)",
    usage: "pixiv <kata kunci> [-halaman] [-populer] [-noai] [-r18] | pixiv <ID/link>",
    category: "Media",
    price: 0,
    role: 0,
  },
  _parseSelection: parseSelection,
  _searchPixiv: searchPixiv,
  _previewUrl: previewUrl,
  _isAllowed: isAllowed,
  _workId: workId,
  _sendWork: sendWork,
  _downloadImage: downloadImage,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    prune();
    return !!parseSelection(text) && searches.has(keyFor(chatJid, senderNumber));
  },
  pendingSince(chatJid, senderNumber) {
    return searches.get(keyFor(chatJid, senderNumber))?.createdAt || 0;
  },
  onStart: async function ({ api, event, args, prefix }) {
    prune();
    const flags = new Set();
    let page = 1;
    const words = [];
    for (const arg of args) {
      const flag = arg.toLowerCase().match(/^-(\d{1,2}|populer|popular|r18|noai)$/);
      if (!flag) {
        words.push(arg);
        continue;
      }
      if (/^\d+$/.test(flag[1])) page = Number(flag[1]);
      else flags.add(flag[1] === "popular" ? "populer" : flag[1]);
    }
    const keyword = words.join(" ").trim();
    const adult = flags.has("r18");
    const usage =
      `Gunakan: ${prefix}pixiv <kata kunci> [-halaman] [-populer] [-noai] [-r18]\n` +
      `atau ${prefix}pixiv <ID / link karya>\nContoh: ${prefix}pixiv 初音ミク -populer`;
    if (!keyword || keyword.length > 100 || page < 1 || page > 50) return api.reply(usage);
    if (adult && event.isGroup) return api.reply("Mode -r18 hanya bisa dipakai di chat pribadi dengan bot.");
    if (adult && !pixivCookie()) {
      return api.reply(
        "Mode -r18 butuh login Pixiv. Admin bot perlu mengisi PIXIV_COOKIE (cookie PHPSESSID akun Pixiv yang sudah mengaktifkan konten R-18) di hosting."
      );
    }

    try {
      const id = workId(keyword);
      if (id) {
        const work = await pixivApi(`illust/${id}?lang=en`);
        const tags = (work.tags?.tags || []).map((t) => t.tag);
        const info = { ...work, id: work.illustId || id, tags, url: work.urls?.thumb || "" };
        const isAdult = Number(work.xRestrict) > 0;
        if (isAdult && event.isGroup) return api.reply("Karya ini R-18 dan hanya bisa dikirim di chat pribadi.");
        if (!isAllowed(info, isAdult)) return api.reply("Karya ini tidak bisa dikirim oleh bot.");
        return await sendWork(api, toItem(info));
      }

      await api.reply(`Mencari "${clean(keyword, 60)}" di Pixiv...`);
      const { items, total } = await searchPixiv(keyword, {
        page,
        adult,
        popular: flags.has("populer"),
        noAi: flags.has("noai"),
      });
      if (!items.length) {
        const hint = adult
          ? " Pastikan akun di PIXIV_COOKIE sudah mengaktifkan konten R-18 di pengaturan Pixiv."
          : " Coba tag bahasa Jepang, contoh 初音ミク.";
        return api.reply(`Tidak ada karya Pixiv untuk "${clean(keyword, 60)}" di halaman ${page}.${hint}`);
      }
      const downloads = await Promise.allSettled(
        items.map((item) => downloadImage(item.preview).catch(() => downloadImage(item.thumb)))
      );
      const shown = [];
      const buffers = [];
      const reasons = [];
      downloads.forEach((result, i) => {
        if (result.status === "fulfilled") {
          shown.push(items[i]);
          buffers.push(result.value.buffer);
        } else {
          reasons.push(errorText(result.reason));
        }
      });
      if (!shown.length) {
        throw new Error(
          `Semua gambar gagal diambil dari Pixiv (${reasons[0] || "tanpa detail"}). Isi PIXIV_IMAGE_PROXY bila jaringan hosting memblokir gambar Pixiv.`
        );
      }

      const grid = await pin._renderGrid(buffers);
      searches.set(keyFor(event.chatJid, event.senderNumber), {
        items: shown,
        createdAt: Date.now(),
        expiresAt: Date.now() + RESULT_TTL,
      });
      const tags = [flags.has("populer") && "populer", adult && "R-18", flags.has("noai") && "tanpa AI"].filter(Boolean);
      await api.sendMessage({
        image: grid,
        caption:
          `*Pixiv: ${clean(keyword, 60)}*${page > 1 ? ` (halaman ${page})` : ""}${tags.length ? ` [${tags.join(", ")}]` : ""}\n` +
          shown.map((item, i) => `${i + 1}. ${item.title}${item.pages > 1 ? ` (${item.pages} hal)` : ""} - ${item.user}`).join("\n") +
          `\n\n${total.toLocaleString("id-ID")} karya ditemukan. Ketik nomor untuk menerima gambar aslinya.\nContoh: 1 atau 1, 2, 3\nBerlaku 15 menit.`,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pixiv] ${detail}`);
      await api.reply(`Pixiv gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text }) {
    prune();
    const key = keyFor(event.chatJid, event.senderNumber);
    const result = searches.get(key);
    const numbers = parseSelection(text);
    if (!result || !numbers) return false;
    const invalid = numbers.filter((n) => n < 1 || n > result.items.length);
    if (invalid.length) {
      await api.reply(`Nomor ${invalid.join(", ")} tidak tersedia. Pilih 1-${result.items.length}, pisahkan dengan koma.`);
      return true;
    }
    searches.delete(key);
    const failed = [];
    for (const n of numbers) {
      try {
        await sendWork(api, result.items[n - 1], n);
      } catch (error) {
        failed.push(`${n} (${errorText(error)})`);
      }
    }
    if (failed.length) await api.reply(`Gagal mengirim karya nomor ${failed.join("; ")}`).catch(() => {});
    return true;
  },
};
