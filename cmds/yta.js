/**
 * YTA — YouTube audio.
 * - `yta <judul>`  : tampilkan 10 hasil YouTube, user cukup ketik angka (tanpa reply).
 * - `yta <link>`   : langsung unduh audio dan kirim ke WhatsApp.
 * Pencarian memakai node module `yt-search`; unduhan memakai yt-dlp (binary resmi,
 * diunduh otomatis saat pertama dipakai) lalu diubah ke MP3 dengan ffmpeg agar pasti
 * bisa diputar di WhatsApp. ffmpeg dicari berurutan: FFMPEG_PATH, @ffmpeg-installer/ffmpeg,
 * ffmpeg di sistem, lalu unduh otomatis. Bila semuanya gagal, audio dikirim apa adanya (M4A). File disimpan sementara di folder bot `tmp/yta/`
 * dan dihapus setelah terkirim (juga dibersihkan saat bot start).
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const yts = require("yt-search");
const zlib = require("node:zlib");

const MAX_RESULTS = 10;
const MAX_AUDIO_MB = 50;
const MAX_DURATION_SEC = 30 * 60;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const BINARY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const pendingSelections = new Map();

const BIN_DIR = path.join(os.homedir(), ".cache", "supanigabot");
const WORK_DIR = path.join(__dirname, "..", "tmp", "yta");
// Sisa unduhan lama (mis. bot mati di tengah unduhan) dibuang saat command dimuat.
// Hanya yang lebih dari 1 jam, supaya reload tidak menghapus unduhan yang sedang jalan.
try {
  for (const name of fs.readdirSync(WORK_DIR)) {
    const target = path.join(WORK_DIR, name);
    if (Date.now() - fs.statSync(target).mtimeMs > 60 * 60 * 1000) fs.rmSync(target, { recursive: true, force: true });
  }
} catch {}
const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
let binaryPromise = null;

function selectionKey(chatJid, senderNumber) {
  return `${chatJid}:${senderNumber}`;
}
function clean(value, maxLength = 140) {
  return String(value || "Unknown").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}
function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 700);
}
function prune() {
  const now = Date.now();
  for (const [key, value] of pendingSelections) if (value.expiresAt <= now) pendingSelections.delete(key);
}

/** Ambil ID video dari link YouTube (watch, youtu.be, shorts, music, embed, live). */
function youtubeId(input) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function releaseAsset() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux") return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  throw new Error(`Platform ${process.platform}/${process.arch} tidak didukung yt-dlp otomatis. Isi YTDLP_PATH.`);
}

async function downloadBinary(target) {
  const response = await fetch(RELEASE + releaseAsset(), { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Gagal mengunduh yt-dlp (HTTP ${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024 * 1024) throw new Error("File yt-dlp yang diunduh tidak valid.");
  await fsp.mkdir(BIN_DIR, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, buffer, { mode: 0o755 });
  await fsp.rename(temp, target);
}

/** Pakai YTDLP_PATH bila diisi, kalau tidak unduh binary resmi ke ~/.cache/supanigabot. */
async function ytdlpBinary() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (!binaryPromise) {
    binaryPromise = (async () => {
      const target = path.join(BIN_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
      const stat = await fsp.stat(target).catch(() => null);
      if (!stat) await downloadBinary(target);
      else if (Date.now() - stat.mtimeMs > BINARY_MAX_AGE_MS) {
        // YouTube sering berubah; perbarui mingguan, tapi tetap pakai versi lama bila gagal.
        await downloadBinary(target).catch((error) => console.warn(`[yta] Update yt-dlp gagal: ${errorText(error)}`));
      }
      return target;
    })().catch((error) => { binaryPromise = null; throw error; });
  }
  return binaryPromise;
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const lines = String(stderr || "").split("\n").map((line) => line.trim()).filter(Boolean);
        const reason = lines.reverse().find((line) => line.startsWith("ERROR")) || lines[0] || error.message;
        if (/confirm you.re not a bot/i.test(reason)) {
          return reject(new Error("YouTube memblokir IP server bot (minta verifikasi bukan bot). Isi YTDLP_COOKIES dengan file cookies.txt YouTube, atau jalankan bot di jaringan lain."));
        }
        return reject(new Error(error.killed ? "Unduhan melewati batas waktu." : reason.replace(/^ERROR:\s*/, "")));
      }
      resolve(String(stdout));
    });
  });
}

const FFMPEG_RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/";
let ffmpegPromise = null;

/** true bila file ffmpeg benar-benar bisa dijalankan. */
function ffmpegWorks(file) {
  return new Promise((resolve) => {
    execFile(file, ["-hide_banner", "-version"], { timeout: 15000, windowsHide: true }, (error) => resolve(!error));
  });
}

/** Binary siap pakai dari npm (@ffmpeg-installer), tanpa skrip install tambahan. */
function installerPath() {
  try {
    const file = require("@ffmpeg-installer/ffmpeg").path;
    return file && fs.existsSync(file) ? file : null;
  } catch { return null; }
}

async function downloadFfmpeg(target) {
  const arch = { x64: "x64", arm64: "arm64", ia32: "ia32", arm: "arm" }[process.arch];
  if (!arch || !["win32", "linux", "darwin"].includes(process.platform)) throw new Error(`Platform ${process.platform}/${process.arch} tidak didukung`);
  const response = await fetch(`${FFMPEG_RELEASE}ffmpeg-${process.platform}-${arch}.gz`, { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Gagal mengunduh ffmpeg (HTTP ${response.status})`);
  const binary = zlib.gunzipSync(Buffer.from(await response.arrayBuffer()));
  if (binary.length < 5 * 1024 * 1024) throw new Error("File ffmpeg yang diunduh tidak valid.");
  await fsp.mkdir(BIN_DIR, { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, binary, { mode: 0o755 });
  await fsp.rename(temp, target);
}

/** Cari ffmpeg yang bisa jalan. Mengembalikan null bila tidak ada (audio dikirim tanpa konversi). */
async function ffmpegBinary() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const cached = path.join(BIN_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      const candidates = [process.env.FFMPEG_PATH, installerPath(), "ffmpeg", fs.existsSync(cached) ? cached : null].filter(Boolean);
      for (const file of candidates) if (await ffmpegWorks(file)) return file;
      try {
        await downloadFfmpeg(cached);
        if (await ffmpegWorks(cached)) return cached;
      } catch (error) {
        console.warn(`[yta] ffmpeg otomatis gagal: ${errorText(error)}`);
      }
      console.warn("[yta] ffmpeg tidak tersedia, audio dikirim sebagai M4A tanpa konversi.");
      return null;
    })();
    // Hasil null tidak disimpan permanen, supaya dicoba lagi di permintaan berikutnya.
    ffmpegPromise.then((file) => { if (!file) ffmpegPromise = null; });
  }
  return ffmpegPromise;
}

/**
 * Unduh audio ke tmp/yta/<acak>/ di folder bot dan ubah ke MP3.
 * Mengembalikan path file; pemanggil WAJIB memanggil cleanup() setelah selesai.
 */
async function downloadAudio(videoId) {
  const binary = await ytdlpBinary();
  const ffmpeg = await ffmpegBinary();
  await fsp.mkdir(WORK_DIR, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(WORK_DIR, `${videoId}-`));
  const cleanup = () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const args = [
      "--no-playlist", "--no-warnings", "--no-progress", "--no-part", "--no-cache-dir",
      ...(ffmpeg
        ? ["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "128K", "--ffmpeg-location", ffmpeg]
        : ["-f", "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]"]),
      "--max-filesize", `${MAX_AUDIO_MB}M`,
      "--match-filter", `duration <= ${MAX_DURATION_SEC} & !is_live`,
      "--js-runtimes", `node:${process.execPath}`,
      "-o", path.join(dir, "audio.%(ext)s"),
      "--print", "after_move:%(title)s\t%(duration)s\t%(filepath)s",
      "--no-simulate",
    ];
    const cookies = process.env.YTDLP_COOKIES;
    if (cookies) {
      if (!fs.existsSync(cookies)) throw new Error(`File cookies YTDLP_COOKIES tidak ditemukan: ${cookies}`);
      args.push("--cookies", cookies);
    }
    args.push(`https://www.youtube.com/watch?v=${videoId}`);
    const stdout = await run(binary, args, 5 * 60 * 1000);
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) throw new Error(`Video tidak diunduh. Mungkin lebih dari ${MAX_DURATION_SEC / 60} menit, live, atau lebih dari ${MAX_AUDIO_MB} MB.`);
    const [title, duration, filepath] = line.split("\t");
    if (!filepath || !fs.existsSync(filepath)) throw new Error("File audio hasil unduhan tidak ditemukan.");
    const { size } = await fsp.stat(filepath);
    if (!size) throw new Error("File audio kosong.");
    if (size > MAX_AUDIO_MB * 1024 * 1024) throw new Error(`Audio lebih dari ${MAX_AUDIO_MB} MB.`);
    const ext = path.extname(filepath).slice(1).toLowerCase();
    return { filepath, cleanup, ext, title: clean(title, 120), duration: Math.round(Number(duration)) || 0 };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(s).padStart(2, "0")).join(":");
}

async function sendAudio(api, videoId) {
  await api.reply("Mengunduh audio, mohon tunggu...");
  const result = await downloadAudio(videoId);
  const ext = result.ext === "mp3" ? "mp3" : "m4a";
  const fileName = `${clean(result.title, 70).replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
  try {
    // Kirim langsung dari file (bukan buffer) supaya tidak menumpuk di memori.
    const mimetype = ext === "mp3" ? "audio/mpeg" : "audio/mp4";
    const audio = { audio: { url: result.filepath }, mimetype, fileName, ptt: false };
    if (result.duration) audio.seconds = result.duration;
    await api.sendMessage(audio);
    await api.reply(`${result.title}\nDurasi: ${formatDuration(result.duration)}\nhttps://youtu.be/${videoId}`);
  } finally {
    await result.cleanup();
  }
}

module.exports = {
  config: {
    name: "yta",
    aliases: [],
    cooldown: 5,
    description: "Cari lagu YouTube atau kirim link, lalu bot mengirim audionya",
    usage: "yta <judul | link YouTube>, lalu ketik nomor 1-10",
    category: "Media",
    price: 0,
    role: 0,
  },
  _youtubeId: youtubeId,
  _sendAudio: sendAudio,
  _workDir: WORK_DIR,
  _ffmpegBinary: ffmpegBinary,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    prune();
    return /^\d{1,2}$/.test(String(text).trim()) && pendingSelections.has(selectionKey(chatJid, senderNumber));
  },
  onReply: async function ({ api, event, text }) {
    prune();
    const key = selectionKey(event.chatJid, event.senderNumber);
    const pending = pendingSelections.get(key);
    if (!pending) return false;
    const index = Number(String(text).trim()) - 1;
    const video = pending.results[index];
    if (!video) {
      await api.reply(`Nomor tidak tersedia. Pilih 1-${pending.results.length}.`);
      return true;
    }
    pendingSelections.delete(key);
    try {
      await sendAudio(api, video.videoId);
    } catch (error) {
      const detail = errorText(error);
      console.error(`[yta] ${detail}`);
      await api.reply(`YTA gagal: ${detail}`).catch(() => {});
    }
    return true;
  },
  onStart: async function ({ api, args, event, prefix }) {
    prune();
    const query = args.join(" ").trim();
    if (!query) return api.reply(`Gunakan: ${prefix}yta <judul lagu | link YouTube>\nContoh: ${prefix}yta cruel angel thesis`);
    if (query.length > 200) return api.reply("Teks terlalu panjang (maksimal 200 karakter).");

    try {
      const linkId = youtubeId(query);
      if (linkId) return await sendAudio(api, linkId);
      if (/^https?:\/\//i.test(query)) return api.reply("Link itu bukan link video YouTube yang valid.");

      await api.reply(`Mencari "${clean(query, 80)}" di YouTube...`);
      const found = await yts({ query, pages: 1 });
      const results = (found.videos || []).filter((v) => v.videoId && v.seconds > 0).slice(0, MAX_RESULTS);
      if (!results.length) return api.reply("Tidak ada video YouTube untuk kata kunci itu.");

      const lines = results.map((v, i) => `${i + 1}. ${clean(v.title, 90)}\n    ${clean(v.author?.name, 50)} | ${v.timestamp || formatDuration(v.seconds)}`);
      await api.reply(`*Hasil YouTube: ${clean(query, 60)}*\n\n${lines.join("\n\n")}\n\nKetik nomor 1-${results.length} untuk mengunduh audio.\nBerlaku 10 menit.`);
      pendingSelections.set(selectionKey(event.chatJid, event.senderNumber), {
        results: results.map((v) => ({ videoId: v.videoId, title: v.title })),
        expiresAt: Date.now() + SELECTION_TTL_MS,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[yta] ${detail}`);
      await api.reply(`YTA gagal: ${detail}`).catch(() => {});
    }
  },
};
