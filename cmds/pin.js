const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const PAGE_SIZE = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_BYTES = 5 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const searches = new Map();

function cleanExpired() {
  const now = Date.now();
  for (const [key, value] of searches) {
    if (value.expiresAt <= now) searches.delete(key);
  }
}

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "i.pinimg.com" || url.hostname.endsWith(".pinimg.com"));
  } catch {
    return false;
  }
}

function originalImageUrl(value) {
  if (!validImageUrl(value)) return null;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/^\/(?:\d+x\d+|\d+x|\d+x\d+_\w+)\//, "/originals/");
  return url.href;
}

function extractImageUrls(html) {
  const normalized = html
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\u003[dD]/g, "=");
  const matches = normalized.match(/https?:\/\/i\.pinimg\.com\/(?:originals|\d+x(?:\d+)?(?:_\w+)?)\/[^"'<>\\\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\\\s]*)?/gi) || [];
  return [...new Set(matches.map((item) => item.replace(/[),]+$/, "")))].filter(validImageUrl);
}

async function getSearchResults(keyword, page) {
  // pinterest-unofficial is optional: it is not consistently published on the
  // public npm registry. When available, use it; otherwise use Pinterest's
  // public search page so the command still works without an undocumented API.
  try {
    const pinterestModule = require("pinterest-unofficial");
    const Pinterest = pinterestModule.default || pinterestModule;
    const client = typeof Pinterest === "function" ? new Pinterest() : Pinterest;
    if (typeof client.search === "function") {
      const result = await client.search(keyword, { limit: PAGE_SIZE, page });
      const rows = Array.isArray(result) ? result : result?.results || result?.pins || result?.data || [];
      const urls = rows.map((row) => row?.image?.url || row?.image_url || row?.images?.orig?.url || row?.url).filter(validImageUrl);
      if (urls.length) return [...new Set(urls)].slice(0, PAGE_SIZE);
    }
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }

  const query = new URLSearchParams({ q: keyword, rs: "typed", start: String((page - 1) * PAGE_SIZE) });
  const response = await fetch(`https://www.pinterest.com/search/pins/?${query}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; SupanigaBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Pinterest merespons HTTP ${response.status}`);

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SEARCH_BYTES) {
        await reader.cancel();
        throw new Error("Respons pencarian Pinterest terlalu besar");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const urls = extractImageUrls(Buffer.concat(chunks).toString("utf8"));
  const offset = (page - 1) * PAGE_SIZE;
  return urls.slice(offset, offset + PAGE_SIZE);
}

async function downloadImage(url, maxBytes = MAX_IMAGE_BYTES) {
  if (!validImageUrl(url)) throw new Error("URL gambar tidak diizinkan");
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
    throw new Error("Gambar gagal diakses");
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize && declaredSize > maxBytes) throw new Error("Ukuran gambar terlalu besar");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Ukuran gambar melebihi batas");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function escapeXml(text) {
  return String(text).slice(0, 100).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

async function renderCollage(urls, keyword, page) {
  const tileWidth = 240;
  const tileHeight = 170;
  const gap = 12;
  const padding = 28;
  const headerHeight = 104;
  const footerHeight = 58;
  const width = padding * 2 + tileWidth * 5 + gap * 4;
  const height = headerHeight + tileHeight * 2 + gap + footerHeight;
  const tempFile = path.join(os.tmpdir(), `supaniga-pin-${process.pid}-${Date.now()}.jpg`);

  const tiles = await Promise.all(urls.map(async (url, index) => {
    const left = padding + (index % 5) * (tileWidth + gap);
    const top = headerHeight + Math.floor(index / 5) * (tileHeight + gap);
    try {
      const source = await downloadImage(url);
      const image = await sharp(source, { limitInputPixels: 40_000_000 })
        .rotate().resize(tileWidth, tileHeight, { fit: "cover", position: "attention" }).jpeg({ quality: 82 }).toBuffer();
      const label = Buffer.from(`<svg width="56" height="56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="25" fill="#07111f" fill-opacity=".9" stroke="#22d3ee" stroke-width="3"/><text x="28" y="37" text-anchor="middle" font-family="Arial" font-size="27" font-weight="700" fill="white">${index + 1}</text></svg>`);
      return [{ input: image, left, top }, { input: label, left: left + 10, top: top + 10 }];
    } catch {
      const placeholder = Buffer.from(`<svg width="${tileWidth}" height="${tileHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#172338"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="18" fill="#9fb3c8">Gambar ${index + 1} gagal dimuat</text></svg>`);
      return [{ input: placeholder, left, top }];
    }
  }));

  const header = Buffer.from(`<svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#08101d"/><text x="${padding}" y="42" font-family="Arial" font-size="26" font-weight="700" fill="#22d3ee">SUPANIGA MX</text><text x="${padding}" y="78" font-family="Arial" font-size="20" fill="#e6edf7">${escapeXml(keyword)}</text></svg>`);
  const footer = Buffer.from(`<svg width="${width}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#08101d"/><text x="${width - padding}" y="37" text-anchor="end" font-family="Arial" font-size="17" fill="#a3e635">HALAMAN ${page} · BALAS 1–${urls.length} UNTUK MEMILIH</text></svg>`);
  try {
    await sharp({ create: { width, height, channels: 3, background: "#05070d" } })
      .composite([{ input: header, left: 0, top: 0 }, ...tiles.flat(), { input: footer, left: 0, top: height - footerHeight }])
      .jpeg({ quality: 86, mozjpeg: true }).toFile(tempFile);
    return tempFile;
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

function selectionKey(chatJid, senderNumber, messageId) {
  return `${chatJid}:${senderNumber}:${messageId}`;
}

module.exports = {
  config: {
    name: "pin",
    cooldown: 8,
    description: "Cari gambar Pinterest dan pilih dari collage",
    usage: "pin <keyword> [-halaman]",
    category: "media",
    price: 0,
    role: 0,
  },
  hasPendingSelection(chatJid, senderNumber, quotedMessageId) {
    cleanExpired();
    return searches.has(selectionKey(chatJid, senderNumber, quotedMessageId));
  },
  onStart: async function ({ api, event, args, prefix }) {
    cleanExpired();
    const raw = args.join(" ").trim();
    const pageMatch = raw.match(/\s+-(\d+)\s*$/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    const keyword = (pageMatch ? raw.slice(0, pageMatch.index) : raw).trim();
    if (!keyword || keyword.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 100) {
      await api.reply(`Gunakan: ${prefix}pin <keyword> [-halaman]\nContoh: ${prefix}pin nasi goreng -2`);
      return;
    }

    const loading = await api.reply(`🔎 Mencari gambar *${keyword}* (halaman ${page})…`);
    let collagePath;
    try {
      const found = await getSearchResults(keyword, page);
      const images = found.map((url) => ({ url, original: originalImageUrl(url) })).filter((item) => item.original);
      if (!images.length) {
        await api.sock.sendMessage(api.chatJid, { text: `Tidak ada gambar yang tersedia untuk halaman ${page}.` }, { quoted: loading });
        return;
      }
      collagePath = await renderCollage(images.map((image) => image.url), keyword, page);
      const sent = await api.sock.sendMessage(api.chatJid, {
        image: await fs.readFile(collagePath),
        caption: `📌 *${keyword}* · halaman ${page}\nBalas pesan gambar ini dengan angka 1–${images.length} untuk mengirim gambar asli.`,
      }, { quoted: loading });
      searches.set(selectionKey(api.chatJid, event.senderNumber, sent.key.id), {
        images,
        expiresAt: Date.now() + RESULT_TTL,
      });
    } catch (error) {
      await api.sock.sendMessage(api.chatJid, { text: `Gagal mencari atau membuat collage: ${error.message}` }, { quoted: loading }).catch(() => {});
    } finally {
      if (collagePath) await fs.rm(collagePath, { force: true }).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text, quotedMessageId }) {
    cleanExpired();
    const key = selectionKey(event.chatJid, event.senderNumber, quotedMessageId);
    const result = searches.get(key);
    if (!result) return false;
    if (!/^\d{1,2}$/.test(text.trim())) {
      await api.reply("Balas collage dengan nomor gambar yang tersedia.");
      return true;
    }
    const index = Number(text.trim()) - 1;
    const selected = result.images[index];
    if (!selected) {
      await api.reply(`Nomor gambar tidak tersedia. Pilih 1–${result.images.length}.`);
      return true;
    }
    try {
      await api.reply("⏳ Mengambil gambar asli…");
      const image = await downloadImage(selected.original);
      await api.sendMessage({ image, caption: `📌 Gambar ${index + 1} · ${result.images.length} hasil` });
    } catch {
      await api.reply("Gambar ini tidak dapat dimuat. Coba pilih gambar lain atau jalankan pencarian ulang.");
    }
    return true;
  },
};
