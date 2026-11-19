/**
 * YTA — YouTube audio.
 * - `yta <judul>`  : tampilkan 10 hasil YouTube, user cukup ketik angka (tanpa reply).
 * - `yta <link>`   : langsung unduh audio dan kirim ke WhatsApp.
 * - `yta cek`      : tampilkan status yt-dlp/ffmpeg di hosting.
 * Pencarian memakai node module `yt-search`; unduhan memakai yt-dlp (YTDLP_PATH, binary resmi
 * yang diunduh otomatis, yt-dlp sistem, atau versi Python) lalu diubah ke MP3 dengan ffmpeg agar pasti
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

const YTA_VERSION = "2026.11.18";
const ROOT_DIR = path.join(__dirname, "..");
const WORK_DIR = path.join(ROOT_DIR, "tmp", "yta");
// Folder sementara untuk proses yt-dlp sendiri (dipakai saat binary mengekstrak dirinya),
// supaya tidak bergantung pada /tmp hosting yang bisa penuh atau dikunci.
const PROC_TMP = path.join(ROOT_DIR, "tmp", "yta-proc");
// Sisa unduhan lama (mis. bot mati di tengah unduhan) dibuang saat command dimuat.
// Hanya yang lebih dari 1 jam, supaya reload tidak menghapus unduhan yang sedang jalan.
for (const dir of [WORK_DIR, PROC_TMP]) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const target = path.join(dir, name);
      if (Date.now() - fs.statSync(target).mtimeMs > 60 * 60 * 1000) fs.rmSync(target, { recursive: true, force: true });
    }
  } catch {}
}
const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const FFMPEG_RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/";
// Urutan client YouTube yang dicoba (null = bawaan yt-dlp).
const PLAYER_CLIENTS = [null, "web_embedded", "tv_simply"];
const EXE = process.platform === "win32" ? ".exe" : "";
let binDirPromise = null;
let ytdlpPromise = null;
let ffmpegPromise = null;

// Chat pribadi bisa datang sebagai @lid atau @s.whatsapp.net; kunci pakai nomor saja.
function selectionKey(chatJid, senderNumber) {
  return `${String(chatJid).endsWith("@g.us") ? chatJid : "dm"}:${senderNumber}`;
}
const PICK_RE = /^\s*(\d{1,2})\s*[.)]?\s*$/;
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

/** Folder binary: ~/.cache/supanigabot, atau tmp/bin di folder bot bila home tidak bisa ditulis. */
function binDir() {
  if (!binDirPromise) {
    binDirPromise = (async () => {
      for (const dir of [path.join(os.homedir(), ".cache", "supanigabot"), path.join(ROOT_DIR, "tmp", "bin")]) {
        try {
          await fsp.mkdir(dir, { recursive: true });
          await fsp.access(dir, fs.constants.W_OK);
          return dir;
        } catch {}
      }
      throw new Error("Tidak ada folder yang bisa ditulis untuk menyimpan yt-dlp/ffmpeg.");
    })().catch((error) => { binDirPromise = null; throw error; });
  }
  return binDirPromise;
}

function procEnv() {
  try { fs.mkdirSync(PROC_TMP, { recursive: true }); } catch {}
  return { ...process.env, TMPDIR: PROC_TMP, TMP: PROC_TMP, TEMP: PROC_TMP, PYTHONUTF8: "1" };
}

/** Jalankan program; true bila keluar normal. */
function works(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 60000, windowsHide: true, env: procEnv() }, (error, stdout) => resolve(error ? null : String(stdout).trim() || "ok"));
  });
}

/** Pastikan file bisa dieksekusi (npm kadang memasang binary tanpa izin eksekusi). */
function ensureExecutable(file) {
  if (process.platform === "win32") return;
  try { fs.accessSync(file, fs.constants.X_OK); } catch { try { fs.chmodSync(file, 0o755); } catch {} }
}

async function download(url, target, minBytes, gunzip = false) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} saat mengunduh ${path.basename(target)}`);
  let buffer = Buffer.from(await response.arrayBuffer());
  if (gunzip) buffer = zlib.gunzipSync(buffer);
  if (buffer.length < minBytes) throw new Error(`File ${path.basename(target)} yang diunduh tidak valid.`);
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, buffer, { mode: 0o755 });
  await fsp.rename(temp, target);
  ensureExecutable(target);
}

function ytdlpAsset() {
  if (process.platform === "win32") return process.arch === "ia32" ? "yt-dlp_x86.exe" : "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "yt-dlp_linux_aarch64";
    if (process.arch === "x64") return "yt-dlp_linux";
  }
  return null;
}

/**
 * Cari yt-dlp yang benar-benar bisa jalan, berurutan:
 * YTDLP_PATH, binary resmi yang diunduh otomatis (diperbarui mingguan),
 * yt-dlp di sistem, lalu versi Python (zipapp) bila ada python3.
 * Mengembalikan { cmd, pre, source, version }.
 */
function ytdlpBinary() {
  if (!ytdlpPromise) {
    ytdlpPromise = (async () => {
      const tried = [];
      const check = async (cmd, pre, source) => {
        const version = await works(cmd, [...pre, "--version"]);
        if (version) return { cmd, pre, source, version };
        tried.push(source);
        return null;
      };
      if (process.env.YTDLP_PATH) {
        const found = await check(process.env.YTDLP_PATH, [], "YTDLP_PATH");
        if (found) return found;
      }
      const dir = await binDir().catch(() => null);
      const asset = ytdlpAsset();
      if (dir && asset) {
        const target = path.join(dir, `yt-dlp${EXE}`);
        const stat = await fsp.stat(target).catch(() => null);
        try {
          if (!stat) await download(RELEASE + asset, target, 1024 * 1024);
          else if (Date.now() - stat.mtimeMs > BINARY_MAX_AGE_MS) {
            // YouTube sering berubah; perbarui mingguan, tapi tetap pakai versi lama bila gagal.
            await download(RELEASE + asset, target, 1024 * 1024).catch((error) => console.warn(`[yta] Update yt-dlp gagal: ${errorText(error)}`));
          }
          ensureExecutable(target);
          let found = await check(target, [], "unduhan otomatis");
          if (!found && stat) {
            // File lama rusak/terpotong: unduh ulang sekali.
            await download(RELEASE + asset, target, 1024 * 1024);
            found = await check(target, [], "unduhan otomatis");
          }
          if (found) return found;
        } catch (error) {
          tried.push(`unduhan otomatis (${errorText(error)})`);
        }
      }
      const system = await check(`yt-dlp${EXE}`, [], "yt-dlp sistem");
      if (system) return system;
      if (dir) {
        for (const python of process.platform === "win32" ? ["py", "python"] : ["python3", "python"]) {
          if (!(await works(python, ["--version"]))) continue;
          const zipapp = path.join(dir, "yt-dlp.pyz");
          try {
            if (!fs.existsSync(zipapp)) await download(RELEASE + "yt-dlp", zipapp, 1024 * 1024);
            const found = await check(python, [zipapp], `yt-dlp Python (${python})`);
            if (found) return found;
          } catch (error) {
            tried.push(`yt-dlp Python (${errorText(error)})`);
          }
          break;
        }
      }
      throw new Error(`yt-dlp tidak bisa dijalankan di hosting ini (dicoba: ${tried.join(", ") || "-"}). Isi YTDLP_PATH dengan yt-dlp yang bisa jalan.`);
    })().catch((error) => { ytdlpPromise = null; throw error; });
  }
  return ytdlpPromise;
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: procEnv() }, (error, stdout, stderr) => {
      if (error) {
        const lines = String(stderr || "").split("\n").map((line) => line.trim()).filter(Boolean);
        const reason = lines.reverse().find((line) => line.startsWith("ERROR")) || lines[0] || error.message;
        if (/confirm you.re not a bot/i.test(reason)) {
          return reject(Object.assign(new Error("YouTube memblokir IP server bot (minta verifikasi bukan bot). Isi YTDLP_COOKIES dengan file cookies.txt YouTube, atau jalankan bot di jaringan lain."), { retryable: true }));
        }
        const failure = new Error(error.killed ? "Unduhan melewati batas waktu." : reason.replace(/^ERROR:\s*/, ""));
        failure.retryable = /requested format is not available|page needs to be reloaded|po token|http error 403/i.test(reason);
        return reject(failure);
      }
      resolve(String(stdout));
    });
  });
}

/** Path lengkap program di PATH (yt-dlp butuh path asli untuk --ffmpeg-location, bukan nama saja). */
function whichSync(name) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir.replace(/^"|"$/g, ""), name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

/** Binary siap pakai dari npm (@ffmpeg-installer), tanpa skrip install tambahan. */
function installerPath() {
  try {
    const file = require("@ffmpeg-installer/ffmpeg").path;
    if (!file || !fs.existsSync(file)) return null;
    ensureExecutable(file);
    return file;
  } catch { return null; }
}

async function downloadFfmpeg(target) {
  const arch = { x64: "x64", arm64: "arm64", ia32: "ia32", arm: "arm" }[process.arch];
  if (!arch || !["win32", "linux", "darwin"].includes(process.platform)) throw new Error(`Platform ${process.platform}/${process.arch} tidak didukung`);
  await download(`${FFMPEG_RELEASE}ffmpeg-${process.platform}-${arch}.gz`, target, 5 * 1024 * 1024, true);
}

/**
 * Cari ffmpeg yang bisa jalan: FFMPEG_PATH, @ffmpeg-installer/ffmpeg, ffmpeg sistem, lalu unduh otomatis.
 * Mengembalikan { file, source } atau null (audio dikirim sebagai M4A tanpa konversi).
 */
function ffmpegBinary() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const dir = await binDir().catch(() => null);
      const cached = dir ? path.join(dir, `ffmpeg${EXE}`) : null;
      const candidates = [
        [process.env.FFMPEG_PATH, "FFMPEG_PATH"],
        [installerPath(), "npm @ffmpeg-installer"],
        [whichSync("ffmpeg"), "ffmpeg sistem"],
        [cached && fs.existsSync(cached) ? cached : null, "unduhan otomatis"],
      ];
      for (const [file, source] of candidates) if (file && (await works(file, ["-hide_banner", "-version"]))) return { file, source };
      if (cached) {
        try {
          await downloadFfmpeg(cached);
          if (await works(cached, ["-hide_banner", "-version"])) return { file: cached, source: "unduhan otomatis" };
        } catch (error) {
          console.warn(`[yta] ffmpeg otomatis gagal: ${errorText(error)}`);
        }
      }
      console.warn("[yta] ffmpeg tidak tersedia, audio dikirim sebagai M4A tanpa konversi.");
      return null;
    })();
    // Hasil null tidak disimpan permanen, supaya dicoba lagi di permintaan berikutnya.
    ffmpegPromise.then((found) => { if (!found) ffmpegPromise = null; });
  }
  return ffmpegPromise;
}

/**
 * Unduh audio ke tmp/yta/<acak>/ di folder bot dan ubah ke MP3.
 * Mengembalikan path file; pemanggil WAJIB memanggil cleanup() setelah selesai.
 */
async function downloadAudio(videoId) {
  const ytdlp = await ytdlpBinary();
  const ffmpeg = (await ffmpegBinary())?.file;
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
    // YouTube kadang menolak client bawaan dari IP hosting; coba client lain sebelum menyerah.
    let stdout;
    for (const [index, client] of PLAYER_CLIENTS.entries()) {
      try {
        const extra = client ? ["--extractor-args", `youtube:player_client=${client}`] : [];
        stdout = await run(ytdlp.cmd, [...ytdlp.pre, ...extra, ...args], 8 * 60 * 1000);
        break;
      } catch (error) {
        if (!error.retryable || index === PLAYER_CLIENTS.length - 1) throw error;
        console.warn(`[yta] ${videoId}: ${errorText(error)} -> coba client ${PLAYER_CLIENTS[index + 1]}`);
        for (const name of await fsp.readdir(dir).catch(() => [])) await fsp.rm(path.join(dir, name), { force: true, recursive: true }).catch(() => {});
      }
    }
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

async function statusText() {
  const [ytdlp, ffmpeg] = await Promise.all([
    ytdlpBinary().then((found) => `${found.source}, versi ${found.version}`).catch((error) => `GAGAL - ${errorText(error)}`),
    ffmpegBinary().then((found) => (found ? `${found.source} (audio MP3)` : "tidak ada (audio dikirim M4A)")).catch(() => "tidak ada (audio dikirim M4A)"),
  ]);
  return `*Status YTA*\nVersi: ${YTA_VERSION}\nSistem: ${process.platform}/${process.arch}, Node ${process.version}\nyt-dlp: ${ytdlp}\nffmpeg: ${ffmpeg}`;
}

// Siapkan yt-dlp dan ffmpeg sejak bot menyala, supaya permintaan pertama cepat
// dan masalah di hosting langsung terlihat di console.
setTimeout(() => {
  Promise.all([ytdlpBinary(), ffmpegBinary()])
    .then(([ytdlp, ffmpeg]) => console.log(`[yta] Siap v${YTA_VERSION}: yt-dlp ${ytdlp.version} (${ytdlp.source}), ffmpeg ${ffmpeg ? ffmpeg.source : "tidak ada, kirim M4A"}`))
    .catch((error) => console.warn(`[yta] Belum siap: ${errorText(error)}`));
}, 2000).unref?.();

module.exports = {
  config: {
    name: "yta",
    aliases: [],
    cooldown: 5,
    description: "Cari lagu YouTube atau kirim link, lalu bot mengirim audionya",
    usage: "yta <judul | link YouTube>, lalu ketik nomor 1-10. yta cek untuk status",
    category: "Media",
    price: 0,
    role: 0,
  },
  _youtubeId: youtubeId,
  _sendAudio: sendAudio,
  _workDir: WORK_DIR,
  _ffmpegBinary: ffmpegBinary,
  _ytdlpBinary: ytdlpBinary,
  _statusText: statusText,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    prune();
    return PICK_RE.test(String(text)) && pendingSelections.has(selectionKey(chatJid, senderNumber));
  },
  pendingSince(chatJid, senderNumber) {
    return pendingSelections.get(selectionKey(chatJid, senderNumber))?.createdAt || 0;
  },
  onReply: async function ({ api, event, text }) {
    prune();
    const key = selectionKey(event.chatJid, event.senderNumber);
    const pending = pendingSelections.get(key);
    if (!pending) return false;
    const index = Number(String(text).match(PICK_RE)?.[1]) - 1;
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
    if (query.toLowerCase() === "cek") return api.reply(await statusText());
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
        createdAt: Date.now(),
        expiresAt: Date.now() + SELECTION_TTL_MS,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[yta] ${detail}`);
      await api.reply(`YTA gagal: ${detail}`).catch(() => {});
    }
  },
};
