const fs = require("node:fs/promises");
const MAX_RESULTS = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const searches = new Map();

function keyFor(chatJid, senderNumber, messageId) {
  return `${chatJid}:${senderNumber}:${messageId}`;
}
function prune() {
  const now = Date.now();
  for (const [key, result] of searches) if (result.expiresAt <= now) searches.delete(key);
}
function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 600);
}

async function searchImages(keyword, page) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", generator: "search",
    gsrsearch: keyword, gsrnamespace: "6", gsrlimit: String(MAX_RESULTS),
    gsrqiprofile: "engine_autoselect", prop: "imageinfo", iiprop: "url", iiurlwidth: "720",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "user-agent": "SupanigaBot/1.0 (image search; contact repository owner)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Wikimedia Commons API merespons HTTP ${response.status}`);
  const data = await response.json();
  const pages = data.query?.pages || [];
  const results = pages.map((item) => {
    const info = item.imageinfo?.[0];
    return { title: item.title?.replace(/^File:/, "") || "Image", url: info?.thumburl || info?.url };
  }).filter((item) => {
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" && (url.hostname === "upload.wikimedia.org" || url.hostname.endsWith(".wikimedia.org"));
    } catch { return false; }
  });
  const offset = (page - 1) * MAX_RESULTS;
  return results.slice(offset, offset + MAX_RESULTS);
}

async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "SupanigaBot/1.0" } });
  if (!response.ok) throw new Error(`Unduh gambar HTTP ${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error(`URL bukan gambar (${mime || "content-type kosong"})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Ukuran gambar melebihi 8 MB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error(`Gambar kosong atau melebihi 8 MB (${buffer.length} byte)`);
  return buffer;
}

module.exports = {
  config: {
    name: "pin",
    cooldown: 8,
    description: "Cari gambar dari Wikimedia Commons dan kirim hasil foto",
    usage: "pin <kata kunci> [-halaman]",
    category: "Media",
    price: 0,
    role: 0,
  },
  hasPendingSelection(chatJid, senderNumber, quotedMessageId) {
    prune();
    return searches.has(keyFor(chatJid, senderNumber, quotedMessageId));
  },
  onStart: async function ({ api, event, args, prefix }) {
    prune();
    const raw = args.join(" ").trim();
    const pageMatch = raw.match(/\s+-(\d+)\s*$/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    const keyword = (pageMatch ? raw.slice(0, pageMatch.index) : raw).trim();
    if (!keyword || keyword.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 20) {
      return api.reply(`Gunakan: ${prefix}pin <kata kunci> [-halaman]\nContoh: ${prefix}pin kucing -2`);
    }

    await api.reply(`🔎 Mencari gambar *${keyword}*…`);
    try {
      const found = await searchImages(keyword, page);
      if (!found.length) return api.reply(`Tidak ada hasil gambar untuk “${keyword}” di halaman ${page}. Coba kata kunci lain.`);

      const images = [];
      const errors = [];
      for (const item of found) {
        try {
          const image = await downloadImage(item.url);
          images.push({ ...item, image });
        } catch (error) {
          errors.push(`${item.title}: ${errorText(error)}`);
        }
      }
      if (!images.length) {
        const details = errors.slice(0, 2).join("; ") || "Tidak ada hasil yang dapat diunduh.";
        throw new Error(`Semua gambar gagal diambil. ${details}`);
      }

      // Send each photo with its visible number, rather than a collage that can
      // silently turn failed downloads into blank placeholder tiles.
      for (let index = 0; index < images.length; index++) {
        const item = images[index];
        await api.sendMessage({ image: item.image, caption: `📌 *${index + 1}. ${item.title.slice(0, 180)}*\nSumber: Wikimedia Commons` });
      }
      const selection = await api.reply(`Hasil gambar untuk *${keyword}* (${images.length} foto). Balas pesan ini dengan angka 1-${images.length} untuk mengirim ulang foto pilihan.\nSumber: Wikimedia Commons.`);
      if (!selection?.key?.id) throw new Error("WhatsApp tidak memberi ID pesan daftar pilihan.");
      searches.set(keyFor(api.chatJid, event.senderNumber, selection.key.id), {
        images: images.map(({ title, url }) => ({ title, url })),
        expiresAt: Date.now() + RESULT_TTL,
      });
      if (errors.length) await api.reply(`Catatan: ${errors.length} dari ${found.length} gambar tidak dapat dimuat. Contoh: ${errors[0]}`).catch(() => {});
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pin] ${detail}`);
      await api.reply(`❌ Pencarian PIN gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text, quotedMessageId }) {
    prune();
    const result = searches.get(keyFor(event.chatJid, event.senderNumber, quotedMessageId));
    if (!result) return false;
    if (!/^\d{1,2}$/.test(String(text).trim())) {
      await api.reply(`Balas pesan pilihan dengan angka 1-${result.images.length}.`);
      return true;
    }
    const index = Number(String(text).trim()) - 1;
    const item = result.images[index];
    if (!item) {
      await api.reply(`Nomor tidak tersedia. Pilih 1-${result.images.length}.`);
      return true;
    }
    try {
      const image = await downloadImage(item.url);
      await api.sendMessage({ image, caption: `📌 ${item.title.slice(0, 180)}\nSumber: Wikimedia Commons` });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pin] ${detail}`);
      await api.reply(`❌ Gagal mengirim gambar nomor ${index + 1}: ${detail}`).catch(() => {});
    }
    return true;
  },
};
