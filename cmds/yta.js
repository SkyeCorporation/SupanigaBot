const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_RESULTS = 10;
const MAX_DURATION_SECONDS = 10 * 60;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 8 * 60_000;
const SELECTION_TTL_MS = 10 * 60_000;
const MAX_ACTIVE_DOWNLOADS = 2;
const pendingSelections = new Map();
let activeDownloads = 0;

function run(binary, args, { timeout = 60_000, maxOutput = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${path.basename(binary)} melewati batas waktu.`));
    }, timeout);

    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutput) {
        child.kill("SIGKILL");
        finish(new Error("Output proses terlalu besar."));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutput) stderr = stderr.slice(-maxOutput);
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        finish(new Error(`${path.basename(binary)} tidak ditemukan di server. Pasang yt-dlp dan FFmpeg terlebih dahulu.`));
      } else finish(error);
    });
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 500);
        finish(new Error(detail || `${path.basename(binary)} keluar dengan kode ${code}.`));
      } else finish(null, { stdout, stderr });
    });
  });
}

function cleanText(value, maxLength = 180) {
  return String(value || "Tidak diketahui").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "durasi tidak diketahui";
  const value = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function selectionKey(event) {
  return `${event.chatJid}:${event.senderNumber}`;
}

function isAllowedLicense(license) {
  return /creative commons|cc[- ]by|cc0|public domain/i.test(String(license || ""));
}

function safeYouTubeUrl(entry) {
  const candidate = entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function sanitizeFilename(title) {
  const base = String(title || "audio").normalize("NFKD").replace(/[^\p{L}\p{N}._ -]/gu, "").trim().slice(0, 80);
  return `${base || "audio"}.mp3`;
}

function pruneSelections() {
  const now = Date.now();
  for (const [key, value] of pendingSelections) {
    if (value.expiresAt <= now) pendingSelections.delete(key);
  }
}

module.exports = {
  config: {
    name: "yta",
    aliases: [],
    cooldown: 5,
    description: "Cari video YouTube dan kirim audio MP3 berlisensi Creative Commons",
    usage: "yta <judul lagu> lalu balas dengan nomor hasil",
    category: "Media",
    price: 0,
    role: 0,
  },
  hasPendingSelection(chatJid, senderNumber) {
    pruneSelections();
    return pendingSelections.has(`${chatJid}:${senderNumber}`);
  },
  onStart: async function ({ api, args, event }) {
    pruneSelections();
    const key = selectionKey(event);
    const pending = pendingSelections.get(key);
    const selectionText = String(event.body || "").trim();

    if (!args.length && event.replyToBot && /^\d{1,2}$/.test(selectionText) && pending) {
      const selectedNumber = Number(selectionText);
      if (selectedNumber < 1 || selectedNumber > pending.results.length) {
        return api.reply(`Pilih nomor 1-${pending.results.length} dengan membalas daftar hasil YTA.`);
      }
      if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) return api.reply("⏳ Antrean unduhan sedang penuh. Coba lagi sebentar.");

      const entry = pending.results[selectedNumber - 1];
      const videoUrl = safeYouTubeUrl(entry);
      if (!videoUrl) {
        pendingSelections.delete(key);
        return api.reply("❌ Tautan hasil pencarian tidak valid.");
      }

      activeDownloads++;
      pendingSelections.delete(key);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supaniga-yta-"));
      try {
        await api.reply(`⬇️ Mengunduh audio hasil nomor ${selectedNumber}…`);
        const ytDlp = process.env.YTDLP_PATH || process.env.YT_DLP_PATH || "yt-dlp";
        const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
        const metadataResult = await run(ytDlp, [
          "--no-warnings", "--no-call-home", "--no-playlist", "--skip-download", "--dump-single-json", videoUrl,
        ], { timeout: SEARCH_TIMEOUT_MS });
        const metadata = JSON.parse(metadataResult.stdout);
        if (!isAllowedLicense(metadata.license)) {
          return api.reply("❌ Video ini tidak mencantumkan lisensi Creative Commons atau public domain. Saya hanya mengunduh audio yang secara eksplisit diizinkan untuk digunakan kembali.");
        }
        if (!Number.isFinite(Number(metadata.duration)) || Number(metadata.duration) <= 0 || Number(metadata.duration) > MAX_DURATION_SECONDS) {
          return api.reply(`❌ Durasi video harus maksimal ${formatDuration(MAX_DURATION_SECONDS)}.`);
        }

        const sourceTemplate = path.join(tempDir, "source.%(ext)s");
        await run(ytDlp, [
          "--no-warnings", "--no-call-home", "--no-playlist", "--no-progress",
          "--format", "bestaudio/best", "--max-filesize", `${MAX_SOURCE_BYTES}`,
          "--output", sourceTemplate, videoUrl,
        ], { timeout: DOWNLOAD_TIMEOUT_MS, maxOutput: 512 * 1024 });
        const sourceFile = fs.readdirSync(tempDir).map((name) => path.join(tempDir, name)).find((file) => file !== path.join(tempDir, "audio.mp3"));
        if (!sourceFile || !fs.statSync(sourceFile).isFile()) throw new Error("File audio hasil unduhan tidak ditemukan.");
        if (fs.statSync(sourceFile).size > MAX_SOURCE_BYTES) throw new Error("Audio sumber melewati batas ukuran unduhan.");

        await api.reply("🎧 Unduhan selesai. Mengonversi audio ke MP3…");
        const outputFile = path.join(tempDir, "audio.mp3");
        await run(ffmpeg, [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", sourceFile,
          "-vn", "-codec:a", "libmp3lame", "-b:a", "96k", "-fs", String(MAX_AUDIO_BYTES), outputFile,
        ], { timeout: 3 * 60_000, maxOutput: 512 * 1024 });
        const outputStats = fs.statSync(outputFile);
        if (!outputStats.isFile() || outputStats.size === 0 || outputStats.size > MAX_AUDIO_BYTES) {
          throw new Error("File MP3 kosong atau melebihi batas maksimum 15 MB.");
        }

        await api.reply("✅ Konversi selesai. Mengirim MP3 ke WhatsApp…");
        const audio = fs.readFileSync(outputFile);
        await api.sendMessage({
          audio,
          mimetype: "audio/mpeg",
          fileName: sanitizeFilename(metadata.title || entry.title),
          ptt: false,
        });
      } catch (error) {
        const detail = error.message || "Terjadi kesalahan yang tidak diketahui.";
        await api.reply(`❌ Gagal memproses audio: ${detail.slice(0, 700)}`).catch(() => {});
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        activeDownloads = Math.max(0, activeDownloads - 1);
      }
      return;
    }

    const query = args.join(" ").trim();
    if (!query) return api.reply("Masukkan judul lagu. Contoh: *.yta judul lagu*");
    if (query.length > 200) return api.reply("Judul pencarian terlalu panjang (maksimal 200 karakter).");

    try {
      await api.reply("🔎 Mencari video YouTube…");
      const ytDlp = process.env.YTDLP_PATH || process.env.YT_DLP_PATH || "yt-dlp";
      const result = await run(ytDlp, [
        "--no-warnings", "--no-call-home", "--flat-playlist", "--skip-download", "--dump-single-json", `ytsearch${MAX_RESULTS}:${query}`,
      ], { timeout: SEARCH_TIMEOUT_MS, maxOutput: 4 * 1024 * 1024 });
      const search = JSON.parse(result.stdout);
      const results = (search.entries || [])
        .filter((entry) => safeYouTubeUrl(entry) && Number.isFinite(Number(entry.duration)) && Number(entry.duration) > 0 && Number(entry.duration) <= MAX_DURATION_SECONDS)
        .slice(0, MAX_RESULTS);
      if (!results.length) return api.reply(`Tidak ada hasil berdurasi maksimal ${formatDuration(MAX_DURATION_SECONDS)}. Coba judul lain.`);

      pendingSelections.set(key, { results, expiresAt: Date.now() + SELECTION_TTL_MS });
      for (let index = 0; index < results.length; index++) {
        const entry = results[index];
        const caption = [
          `*${index + 1}. ${cleanText(entry.title)}*`,
          `Channel: ${cleanText(entry.channel || entry.uploader)}`,
          `Durasi: ${formatDuration(Number(entry.duration))}`,
          `URL: ${safeYouTubeUrl(entry)}`,
        ].join("\n");
        const thumbnail = String(entry.thumbnail || "");
        if (/^https:\/\//i.test(thumbnail)) {
          try {
            await api.sendMessage({ image: { url: thumbnail }, caption });
            continue;
          } catch {
            // Provide the search result as text if the thumbnail host cannot be fetched.
          }
        }
        await api.sendMessage(caption);
      }
      await api.reply("Balas pesan daftar ini dengan nomor 1-10 untuk memilih audio. Hasil hanya tersedia 10 menit; unduhan dibatasi untuk video berlisensi Creative Commons/public domain.");
    } catch (error) {
      const detail = error.message || "Terjadi kesalahan yang tidak diketahui.";
      await api.reply(`❌ Pencarian gagal: ${detail.slice(0, 700)}`).catch(() => {});
    }
  },
};
