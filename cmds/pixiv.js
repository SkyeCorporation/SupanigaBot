// ====================== PIXIV COOKIE ======================
const PIXIV_COOKIE = "PHPSESSID=131203295_f2x2uEtrUrKp8KaqU3UAolsLlKClzc6S";
// ==========================================================

const pin = require("./pin.js");
const { ProxyAgent, fetch: undiciFetch } = require("undici");

const MAX_RESULTS = 8;
const MAX_PAGES = 10;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SELECTION_RE = /^\d{1,2}(\s*,\s*\d{1,2})*$/;
const searches = new Map();

// ====================== PROXY HARDCODED ======================
const PROXY_URL = "http://ramylxhg:fgqixyhrzmzg@45.38.107.97:6014";
// =============================================================

let proxyAgent = null;
try {
  proxyAgent = new ProxyAgent(PROXY_URL);
  console.log("[pixiv] Proxy aktif (hardcoded)");
} catch (e) {
  console.error("[pixiv] Gagal membuat proxy agent:", e.message);
}

async function doFetch(url, options = {}) {
  const opts = { ...options };
  if (proxyAgent) {
    opts.dispatcher = proxyAgent;
    return undiciFetch(url, opts);
  }
  return fetch(url, opts);
}

function keyFor(chatJid, senderNumber) {
  return (String(chatJid || "").endsWith("@g.us") ? chatJid : "dm") + ":" + String(senderNumber || "");
}

function prune() {
  const now = Date.now();
  for (const [key, result] of searches) {
    if (result.expiresAt <= now) searches.delete(key);
  }
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

function getCookie() {
  const raw = String(PIXIV_COOKIE || "").trim();
  if (!raw) return "";
  return raw.includes("=") ? raw : "PHPSESSID=" + raw;
}

function headers(useCookie = false, extra = {}) {
  const h = {
    "User-Agent": UA,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.pixiv.net/",
    "Origin": "https://www.pixiv.net",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  if (useCookie) {
    const cookie = getCookie();
    if (cookie) h["Cookie"] = cookie;
  }

  return Object.assign(h, extra);
}

async function pixivApi(pathAndQuery, useCookie = false) {
  const url = "https://www.pixiv.net/ajax/" + pathAndQuery;
  console.log("[pixiv] Request:", url, "| Cookie:", useCookie ? "ON" : "OFF");

  const response = await doFetch(url, {
    method: "GET",
    headers: headers(useCookie),
    signal: AbortSignal.timeout(25000),
  });

  const text = await response.text();
  console.log("[pixiv] Status:", response.status);

  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error("[pixiv] Bukan JSON:", text.slice(0, 300));
    throw new Error("Pixiv merespons bukan JSON (HTTP " + response.status + ")");
  }

  if (!response.ok || json.error) {
    console.error("[pixiv] API Error:", JSON.stringify(json, null, 2));
    throw new Error(json?.message || "Pixiv error HTTP " + response.status);
  }

  return json.body;
}

const IMAGE_HOSTS = ["i.pximg.net", "i.pixiv.re", "i.pixiv.nl"];
let preferredHost = null;

function imageHosts() {
  const custom = String(process.env.PIXIV_IMAGE_PROXY || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const hosts = [custom, preferredHost].concat(IMAGE_HOSTS).filter(Boolean);
  return [...new Set(hosts)];
}

async function fetchImage(url, maxBytes) {
  const direct = new URL(url).hostname === "i.pximg.net";
  const opts = {
    headers: direct ? headers(false, { Accept: "image/*" }) : { "User-Agent": UA, Accept: "image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  };

  const response = await doFetch(url, opts);
  if (!response.ok) throw new Error("HTTP " + response.status);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error("bukan gambar (" + (mime || "content-type kosong") + ")");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("gambar terlalu besar");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error("gambar kosong atau terlalu besar");
  return { buffer, mime };
}

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
      const msg = error?.cause?.code || (error?.name === "TimeoutError" ? "timeout" : errorText(error));
      errors.push(host + ": " + msg);
    }
    if (original.hostname !== "i.pximg.net") break;
  }
  throw new Error(errors.join("; "));
}

function previewUrl(thumb) {
  const m = String(thumb).match(/\/img\/(\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d+_p0)_(?:square|custom)1200\.(\w+)$/);
  return m ? "https://i.pximg.net/c/540x540_70/img-master/img/" + m[1] + "_master1200." + m[2] : thumb;
}

function isAllowed(work, adult) {
  if (!work || !work.id) return false;
  // R-18G tetap diblokir
  if (Number(work.xRestrict) === 2) return false;
  if (!adult) return Number(work.xRestrict) === 0;
  return Number(work.xRestrict) === 1;
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

async function searchPixiv(keyword, options) {
  const page = options.page || 1;
  const adult = !!options.adult;
  const popular = !!options.popular;
  const noAi = !!options.noAi;

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

  const body = await pixivApi("search/artworks/" + encodeURIComponent(keyword) + "?" + params.toString(), adult);

  const list = [];
  if (popular && page === 1) {
    list.push(...(body.popular?.permanent || []), ...(body.popular?.recent || []));
  }
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

async function sendWork(api, item, number, useCookie = false) {
  const pages = await pixivApi("illust/" + item.id + "/pages?lang=en", useCookie);
  const list = (Array.isArray(pages) ? pages : []).slice(0, MAX_PAGES);
  if (!list.length) throw new Error("Halaman karya tidak ditemukan.");

  let sent = 0;
  let lastError = null;

  for (let index = 0; index < list.length; index++) {
    const pageInfo = list[index];
    let image = null;
    const urls = [pageInfo.urls?.original, pageInfo.urls?.regular, pageInfo.urls?.small].filter(Boolean);

    for (const url of urls) {
      try {
        image = await downloadImage(url);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!image) continue;

    let head;
    if (index === 0) {
      head = (number ? number + ". " : "") + item.title + "\nArtis: " + (item.user || "-") + "\n";
      if (item.pages > 1) {
        head += "Halaman: " + item.pages;
        if (item.pages > MAX_PAGES) head += " (dikirim " + MAX_PAGES + " pertama)";
        head += "\n";
      }
      if (item.type === 2) head += "Animasi (ugoira), dikirim frame pertama\n";
      if (item.ai) head += "Karya AI\n";
      head += "https://www.pixiv.net/artworks/" + item.id;
    } else {
      head = item.title + " - halaman " + (index + 1);
    }

    await api.sendMessage({ image: image.buffer, caption: head });
    sent++;
  }

  if (!sent) {
    throw new Error("Semua gambar gagal diambil" + (lastError ? " (" + errorText(lastError) + ")" : "") + ".");
  }
}

function workId(text) {
  const value = String(text || "").trim();
  if (/^\d{5,12}$/.test(value)) return value;
  const match = value.match(/pixiv\.net\/(?:[a-z]{2}\/)?(?:artworks\/|member_illust\.php\?.*illust_id=)(\d{5,12})/i);
  return match ? match[1] : null;
}

module.exports = {
  config: {
    name: "pixiv",
    aliases: ["pix"],
    cooldown: 8,
    description: "Cari ilustrasi Pixiv, lalu pilih dengan ketik nomor",
    usage: "pixiv <kata kunci> [-halaman] [-populer] [-noai] [-r18] | pixiv <ID/link>",
    category: "Media",
    price: 0,
    role: 0,
  },

  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    try {
      prune();
      return !!parseSelection(text) && searches.has(keyFor(chatJid, senderNumber));
    } catch (e) {
      return false;
    }
  },

  pendingSince(chatJid, senderNumber) {
    try {
      return searches.get(keyFor(chatJid, senderNumber))?.createdAt || 0;
    } catch (e) {
      return 0;
    }
  },

  onStart: async function (ctx) {
    try {
      console.log("[pixiv] onStart | Proxy: Hardcoded");

      const { api, event, args, prefix } = ctx;

      prune();
      const flags = new Set();
      let page = 1;
      const words = [];

      for (const arg of (args || [])) {
        const flag = String(arg).toLowerCase().match(/^-(\d{1,2}|populer|popular|r18|noai)$/);
        if (!flag) {
          words.push(arg);
          continue;
        }
        if (/^\d+$/.test(flag[1])) page = Number(flag[1]);
        else flags.add(flag[1] === "popular" ? "populer" : flag[1]);
      }

      const keyword = words.join(" ").trim();
      const adult = flags.has("r18");

      const usage = "Gunakan: " + (prefix || ".") + "pixiv <kata kunci> [-halaman] [-populer] [-noai] [-r18]\natau " + (prefix || ".") + "pixiv <ID / link karya>\nContoh: " + (prefix || ".") + "pixiv 初音ミク -populer";

      if (!keyword || keyword.length > 100 || page < 1 || page > 50) {
        return api.reply(usage);
      }

      if (adult && !getCookie()) {
        return api.reply("Mode -r18 butuh cookie. Pastikan PIXIV_COOKIE di baris 1 sudah diisi dengan benar.");
      }

      const id = workId(keyword);
      if (id) {
        const work = await pixivApi("illust/" + id + "?lang=en", adult);
        const tags = (work.tags?.tags || []).map((t) => t.tag);
        const info = Object.assign({}, work, {
          id: work.illustId || id,
          tags,
          url: work.urls?.thumb || "",
        });
        const isAdult = Number(work.xRestrict) > 0;
        if (!isAllowed(info, isAdult || adult)) return api.reply("Karya ini tidak bisa dikirim oleh bot.");
        return await sendWork(api, toItem(info), null, isAdult || adult);
      }

      await api.reply('Mencari "' + clean(keyword, 60) + '" di Pixiv' + (adult ? " (R-18)" : "") + "...");

      const result = await searchPixiv(keyword, {
        page,
        adult,
        popular: flags.has("populer"),
        noAi: flags.has("noai"),
      });

      const items = result.items;
      const total = result.total;

      if (!items.length) {
        const hint = adult
          ? " Pastikan cookie masih valid dan akun sudah mengaktifkan konten R-18."
          : " Coba tag bahasa Jepang, contoh 初音ミク.";
        return api.reply('Tidak ada karya Pixiv untuk "' + clean(keyword, 60) + '" di halaman ' + page + "." + hint);
      }

      const downloads = await Promise.allSettled(
        items.map((item) => downloadImage(item.preview).catch(() => downloadImage(item.thumb)))
      );

      const shown = [];
      const buffers = [];
      const reasons = [];

      downloads.forEach((res, i) => {
        if (res.status === "fulfilled") {
          shown.push(items[i]);
          buffers.push(res.value.buffer);
        } else {
          reasons.push(errorText(res.reason));
        }
      });

      if (!shown.length) {
        throw new Error("Semua gambar gagal diambil dari Pixiv (" + (reasons[0] || "tanpa detail") + ").");
      }

      if (!pin || typeof pin._renderGrid !== "function") {
        throw new Error("pin.js tidak memiliki fungsi _renderGrid");
      }

      const grid = await pin._renderGrid(buffers);

      const chatJid = event.chatJid || "";
      const senderNumber = event.senderNumber || "";

      searches.set(keyFor(chatJid, senderNumber), {
        items: shown,
        adult,
        createdAt: Date.now(),
        expiresAt: Date.now() + RESULT_TTL,
      });

      const tagList = [];
      if (flags.has("populer")) tagList.push("populer");
      if (adult) tagList.push("R-18");
      if (flags.has("noai")) tagList.push("tanpa AI");

      let caption = "*Pixiv: " + clean(keyword, 60) + "*";
      if (page > 1) caption += " (halaman " + page + ")";
      if (tagList.length) caption += " [" + tagList.join(", ") + "]";
      caption += "\n";

      shown.forEach((item, i) => {
        caption += (i + 1) + ". " + item.title;
        if (item.pages > 1) caption += " (" + item.pages + " hal)";
        caption += " - " + item.user + "\n";
      });

      caption += "\n" + total.toLocaleString("id-ID") + " karya ditemukan. Ketik nomor untuk menerima gambar aslinya.\nContoh: 1 atau 1, 2, 3\nBerlaku 15 menit.";

      await api.sendMessage({
        image: grid,
        caption: caption,
      });
    } catch (error) {
      console.error("[pixiv] ========== ERROR ==========");
      console.error(error);
      console.error("[pixiv] ===========================");
      try {
        await ctx.api.reply("Pixiv gagal: " + errorText(error));
      } catch (e) {}
    }
  },

  onReply: async function (ctx) {
    try {
      const { api, event, text } = ctx;
      prune();
      const key = keyFor(event.chatJid, event.senderNumber);
      const result = searches.get(key);
      const numbers = parseSelection(text);
      if (!result || !numbers) return false;

      const invalid = numbers.filter((n) => n < 1 || n > result.items.length);
      if (invalid.length) {
        await api.reply("Nomor " + invalid.join(", ") + " tidak tersedia. Pilih 1-" + result.items.length + ", pisahkan dengan koma.");
        return true;
      }

      searches.delete(key);
      const failed = [];
      const useCookie = !!result.adult;

      for (const n of numbers) {
        try {
          await sendWork(api, result.items[n - 1], n, useCookie);
        } catch (error) {
          failed.push(n + " (" + errorText(error) + ")");
        }
      }

      if (failed.length) {
        await api.reply("Gagal mengirim karya nomor " + failed.join("; "));
      }
      return true;
    } catch (error) {
      console.error("[pixiv] onReply error:", error);
      return false;
    }
  },
};
