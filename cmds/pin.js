/**
 * PIN — cari foto dari Pinterest.
 * Bot mengirim SATU gambar kolase bertema futuristic space berisi 8 foto bernomor,
 * lalu user cukup mengetik angka di chat (tanpa reply). Beberapa foto: 1, 2, 3
 */
const selection = require("./lib/selection");
const { renderCollage } = require("./lib/collage");
const MAX_RESULTS = 8;
const PAGE_SIZE = 25;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
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
  return selection.parseNumbers(text, { multiple: true });
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


module.exports = {
  config: {
    name: "pin",
    cooldown: 8,
    description: "Mencari foto dari Pinterest dan menampilkannya dalam kolase bernomor",
    usage: "pin <kata kunci> [-halaman], lalu ketik nomor foto (contoh: 1 atau 1, 2, 3)",
    category: "Media",
    price: 0,
    role: 0,
  },
  _parseSelection: parseSelection,
  _renderGrid: (buffers, info) => renderCollage(buffers, { source: "Pinterest", ...info }),
  _searchPinterest: searchPinterest,
  _downloadImage: downloadImage,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    return !!parseSelection(text) && !!selection.get(chatJid, senderNumber, "pin");
  },
  onStart: async function ({ api, event, args, prefix }) {
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
      if (!found.length) return api.reply(`Tidak ada foto Pinterest untuk "${keyword}" di halaman ${page}. Silakan gunakan kata kunci lain.`);

      const downloads = await Promise.allSettled(found.map((item) => downloadImage(item.preview)));
      const sent = [];
      const buffers = [];
      const errors = [];
      downloads.forEach((result, i) => {
        if (result.status === "fulfilled") { sent.push(found[i]); buffers.push(result.value.buffer); }
        else errors.push(errorText(result.reason));
      });
      if (!sent.length) throw new Error(`Semua foto gagal diambil. ${errors[0] || ""}`.trim());

      const grid = await renderCollage(buffers, { source: "Pinterest", query: keyword, page });
      selection.set(event.chatJid, event.senderNumber, "pin", { keyword, images: sent }, RESULT_TTL);
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
      await api.reply(`Pencarian Pinterest gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text }) {
    const result = selection.get(event.chatJid, event.senderNumber, "pin");
    const numbers = parseSelection(text);
    if (!result || !numbers) return false;
    const invalid = numbers.filter((n) => n < 1 || n > result.images.length);
    if (invalid.length) {
      await api.reply(`Nomor ${invalid.join(", ")} tidak tersedia. Pilih 1-${result.images.length}, pisahkan dengan koma.`);
      return true;
    }
    selection.clear(event.chatJid, event.senderNumber, "pin");
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
