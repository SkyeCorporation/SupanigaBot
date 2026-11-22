/**
 * YTA Ringan — pakai Cobalt API (lebih ringan dari yt-dlp)
 * - Tidak menjalankan yt-dlp & ffmpeg di server
 * - Hanya download file audio final lalu kirim
 * - Semua cache dihapus baik sukses maupun error
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const selection = require("./lib/selection");

const MAX_RESULTS = 10;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const WORK_DIR = path.join(__dirname, "..", "tmp", "yta");
const MAX_AUDIO_MB = 25;

try { fs.mkdirSync(WORK_DIR, { recursive: true }); } catch {}

// Bersihkan sisa cache lama saat command dimuat
(async () => {
  try {
    const files = await fsp.readdir(WORK_DIR);
    for (const name of files) {
      const full = path.join(WORK_DIR, name);
      const stat = await fsp.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
        await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {}
})();

function clean(text, max = 120) {
  return String(text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function errorText(err) {
  return String(err?.message || err || "Unknown error").replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function youtubeId(input) {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function searchVideos(query) {
  const yts = require("yt-search");
  const found = await yts({ query, pages: 1 });
  return (found.videos || [])
    .filter(v => v.videoId && v.seconds > 0 && v.seconds < 60 * 30)
    .slice(0, MAX_RESULTS)
    .map(v => ({
      videoId: v.videoId,
      title: v.title,
      author: v.author?.name || "",
      seconds: v.seconds,
      timestamp: v.timestamp || "",
    }));
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Ambil audio pakai Cobalt API
 */
async function getAudioFromCobalt(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const res = await fetch("https://api.cobalt.tools/api/json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      url: watchUrl,
      isAudioOnly: true,
      aFormat: "mp3",
      filenameStyle: "basic",
    }),
    signal: AbortSignal.timeout(30000),
  });

  const data = await res.json();

  if (data.status === "error") {
    throw new Error(data.text || "Cobalt gagal memproses video");
  }

  const audioUrl = data.url || data.audio || data.tunnel;
  if (!audioUrl) throw new Error("Tidak mendapatkan link audio dari Cobalt");

  return audioUrl;
}

/**
 * Download ke folder sementara + pastikan selalu dibersihkan
 */
async function downloadToTemp(url, videoId) {
  const dir = await fsp.mkdtemp(path.join(WORK_DIR, `${videoId}-`));
  const filePath = path.join(dir, "audio.mp3");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`Gagal download audio (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 10000) throw new Error("File audio terlalu kecil");
    if (buffer.length > MAX_AUDIO_MB * 1024 * 1024) {
      throw new Error(`Audio lebih dari ${MAX_AUDIO_MB}MB`);
    }

    await fsp.writeFile(filePath, buffer);

    return {
      filepath: filePath,
      cleanup: async () => {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (err) {
    // Pastikan folder dihapus juga saat error download
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Bersihkan semua folder di dalam WORK_DIR (dipanggil saat error fatal)
 */
async function cleanAllCache() {
  try {
    const files = await fsp.readdir(WORK_DIR);
    await Promise.all(
      files.map(name =>
        fsp.rm(path.join(WORK_DIR, name), { recursive: true, force: true }).catch(() => {})
      )
    );
  } catch {}
}

async function sendAudio(api, videoId, title = "") {
  await api.reply("Mengunduh audio (versi ringan)...");

  let cleanup = null;

  try {
    const audioUrl = await getAudioFromCobalt(videoId);
    const result = await downloadToTemp(audioUrl, videoId);
    cleanup = result.cleanup;

    await api.sendMessage({
      audio: { url: result.filepath },
      mimetype: "audio/mpeg",
      fileName: `${clean(title || videoId, 60)}.mp3`,
      ptt: false,
    });

    await api.reply(
      `${title ? `*${clean(title, 80)}*\n` : ""}https://youtu.be/${videoId}`
    );
  } catch (err) {
    // Hapus cache yang sedang diproses
    if (cleanup) await cleanup();
    // Hapus semua sisa cache lain juga
    await cleanAllCache();
    throw err;
  } finally {
    // Pastikan file yang sukses juga dihapus
    if (cleanup) await cleanup();
  }
}

module.exports = {
  config: {
    name: "yta",
    aliases: ["play"],
    cooldown: 8,
    description: "Download audio YouTube (versi ringan)",
    usage: "yta <judul | link>",
    category: "Media",
    price: 0,
    role: 0,
  },

  hasPendingSelection(chatJid, senderNumber, _, text = "") {
    return !!selection.parseNumbers(text, { multiple: false }) && !!selection.get(chatJid, senderNumber, "yta");
  },

  async onReply({ api, event, text }) {
    const pending = selection.get(event.chatJid, event.senderNumber, "yta");
    const numbers = selection.parseNumbers(text, { multiple: false });
    if (!pending || !numbers) return false;

    const video = pending.results[numbers[0] - 1];
    if (!video) {
      await api.reply(`Nomor tidak tersedia. Pilih 1-${pending.results.length}`);
      return true;
    }

    selection.clear(event.chatJid, event.senderNumber, "yta");

    try {
      await sendAudio(api, video.videoId, video.title);
    } catch (err) {
      console.error("[yta]", errorText(err));
      await cleanAllCache(); // pastikan bersih saat error
      await api.reply(`Gagal: ${errorText(err)}`);
    }
    return true;
  },

  async onStart({ api, args, event, prefix }) {
    const query = args.join(" ").trim();
    if (!query) {
      return api.reply(`Contoh:\n${prefix}yta cruel angel thesis\n${prefix}yta https://youtu.be/xxxxx`);
    }

    try {
      const id = youtubeId(query);
      if (id) return await sendAudio(api, id);

      if (/^https?:\/\//i.test(query)) {
        return api.reply("Link bukan YouTube yang valid.");
      }

      await api.reply(`Mencari "${clean(query, 60)}"...`);
      const results = await searchVideos(query);
      if (!results.length) return api.reply("Tidak ditemukan.");

      const lines = results.map((v, i) =>
        `${i + 1}. ${clean(v.title, 70)}\n    ${clean(v.author, 40)} • ${v.timestamp || formatDuration(v.seconds)}`
      );

      selection.set(event.chatJid, event.senderNumber, "yta", {
        results: results.map(v => ({ videoId: v.videoId, title: v.title })),
      }, SELECTION_TTL_MS);

      await api.reply(
        `*Hasil pencarian:*\n\n${lines.join("\n\n")}\n\nKetik nomor 1-${results.length}`
      );
    } catch (err) {
      console.error("[yta]", errorText(err));
      await cleanAllCache(); // bersih saat error
      await api.reply(`Error: ${errorText(err)}`);
    }
  },
};
