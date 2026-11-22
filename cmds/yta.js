/**
 * YTA — yt-dlp + cookies + proxy (multi client)
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const selection = require("./lib/selection");

// ====================== PROXY & COOKIES ======================
const PROXY_URL = "http://ramylxhg:fgqixyhrzmzg@45.38.107.97:6014";

const HARDCODED_COOKIES = `# Netscape HTTP Cookie File
.youtube.com	TRUE	/	TRUE	1810872115	__Secure-YNID	CuwBCAUSngEBDB6PDGhvolxWJIvaRht1SYFgFVuzdFdYdIxfF_9F1rUB9rL1W6itr6tRArRJ1e8Gr8Bf3omx8MIN8fufSstV6WipWyT089fhd301iIKlNDeWFi_5KnBJCJi8XydwmWf5Hyy4uKs23eklWFbkOvV6oQe4TjXvnE3qVA9srUutG-NcPDRZsEVGAkBl5Zo-mMOc0jBwvYnE8BXZG8nA1igFMkUBHFj1aq17-zhWMcaD61XVJAiXQFjHYWv-nJ0E6yR5rfDkYIAW2StJQPgZqxr1w_JTsc6aAFH6y4jkmpP_edkz_UBVKAc
.youtube.com	TRUE	/	TRUE	1810877203	VISITOR_INFO1_LIVE	7-bzwGi-cK0
.youtube.com	TRUE	/	TRUE	1810877203	VISITOR_PRIVACY_METADATA	CgJJRBIEGgAgYQ%3D%3D
.youtube.com	TRUE	/	TRUE	1829885206	PREF	f4=4010000&f6=40000000&tz=Asia.Tokyo&f7=100
.youtube.com	TRUE	/	TRUE	1826860931	__Secure-1PSIDTS	sidts-CjQBnJZzav6Af-p_IoaCqBd4_RUaCTCckeJJEhp79QComkF_P3IoWIFL_1jqeaUlx5_wEzkeEAA
.youtube.com	TRUE	/	TRUE	1826860931	__Secure-3PSIDTS	sidts-CjQBnJZzav6Af-p_IoaCqBd4_RUaCTCckeJJEhp79QComkF_P3IoWIFL_1jqeaUlx5_wEzkeEAA
.youtube.com	TRUE	/	FALSE	1829738731	HSID	A9s9yq0uD3pUsyG8i
.youtube.com	TRUE	/	TRUE	1829738731	SSID	AzN8fi3hC7wWUzgIj
.youtube.com	TRUE	/	FALSE	1829738731	APISID	6f5c7Qa2pL80suGn/Axmbh8tcUApK0BrrX
.youtube.com	TRUE	/	TRUE	1829738731	SAPISID	rB1eg_7as7qFFGCG/ATztkrOYpb9qZmHdc
.youtube.com	TRUE	/	TRUE	1829738731	__Secure-1PAPISID	rB1eg_7as7qFFGCG/ATztkrOYpb9qZmHdc
.youtube.com	TRUE	/	TRUE	1829738731	__Secure-3PAPISID	rB1eg_7as7qFFGCG/ATztkrOYpb9qZmHdc
.youtube.com	TRUE	/	FALSE	1829738731	SID	g.a000FAmZsqy7x8ykR8TIY9fpp6q-o7lGtVTNC2sfQ7oi1fmzznHc3DOIEaADhhzDpNhG8F8YTAACgYKAfMSARUSFQHGX2MiwgKuFOAvXU92WlTzz2rZZxoVAUF8yKqWE0cjlGiDow01XgVNPvfq0076
.youtube.com	TRUE	/	TRUE	1829738731	__Secure-1PSID	g.a000FAmZsqy7x8ykR8TIY9fpp6q-o7lGtVTNC2sfQ7oi1fmzznHcA3rsVIMbqcYOvVzLte5AYgACgYKAQESARUSFQHGX2MiBhOox2AFJOSIu-bVxF_gsxoVAUF8yKqKYLij_CekJ7temWim_ja70076
.youtube.com	TRUE	/	TRUE	1829738731	__Secure-3PSID	g.a000FAmZsqy7x8ykR8TIY9fpp6q-o7lGtVTNC2sfQ7oi1fmzznHcYRN6RCTqiS9JthefyKQEDwACgYKASgSARUSFQHGX2MiYcpjkyzKwocer9gkAFDU7RoVAUF8yKqHRknZyEIHGwH1zLchxnBJ0076
.youtube.com	TRUE	/	TRUE	1829738731	LOGIN_INFO	AFmmF2swRgIhAJGe4tHPASrasTBfWqRkhxisJ9qJ2H5ooAJpZ50dqC3KAiEAz3CbDCecwEh3s8_cP1ArFuUjC-PCSj_E2SYyXE1qwaY:QUQ3MjNmeGgxRlNIRU5fb3lUazI4d2R5WVNMTEJYUUM3ZEd2dGh6TUJnRkxiNjFadE9jNXp4Y2c4Y1padnRyMjRxYlRNMmpDZ0gtWjlBVVN6cmdsN1hwbkt6emVscWEzSEM5QzFaNk00aHo1Smk5cDhYckN6Tk1PUUN5UEtCeHFaSXFKLWZVTFk0NlYyaDMxSlRLNXl4WGl5bGlGcVByaUp3
.youtube.com	TRUE	/	FALSE	1826861212	SIDCC	APD_SKEPukeAdr0ZxXwj8ZKInkpwNznCvChZ9yoVn97A3dM0q9P6OWcL_P_1AyHoQVDTT47HWA
.youtube.com	TRUE	/	TRUE	1826861212	__Secure-1PSIDCC	APD_SKGym4UmjQ--scXhEgTMwIhyYw_kmQwjK4MyBCg2wWsW8QtfiODscMkue4bl6G_B84ZPVw
.youtube.com	TRUE	/	TRUE	1826861212	__Secure-3PSIDCC	APD_SKEfBk25_HCS94CVhX5dHRvhdO0pJZT8EOipZ_7_ortWnwiI5a7SoPUIfNJQ5GJ2ae_ZXGU
.youtube.com	TRUE	/	TRUE	0	YSC	wrtmW-cN0E0
`;
// =============================================================

const MAX_RESULTS = 10;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const WORK_DIR = path.join(__dirname, "..", "tmp", "yta");
const MAX_AUDIO_MB = 30;
const MAX_DURATION_SEC = 30 * 60;

try {
  fs.mkdirSync(WORK_DIR, { recursive: true });
} catch {}

function clean(text, max = 120) {
  return String(text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function errorText(err) {
  return String(err?.message || err || "Unknown error").replace(/[\r\n\t]+/g, " ").slice(0, 400);
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
    .filter((v) => v.videoId && v.seconds > 0 && v.seconds <= MAX_DURATION_SEC)
    .slice(0, MAX_RESULTS)
    .map((v) => ({
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

function findYtdlp() {
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(os.homedir(), ".cache", "supanigabot", "yt-dlp"),
    path.join(__dirname, "..", "tmp", "bin", "yt-dlp"),
    "yt-dlp",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (p === "yt-dlp" || fs.existsSync(p)) return p;
    } catch {}
  }
  return "yt-dlp";
}

function runYtdlp(args, timeout = 150000) {
  return new Promise((resolve, reject) => {
    const bin = findYtdlp();
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || "").trim();
        return reject(new Error(msg.slice(0, 400) || "yt-dlp gagal"));
      }
      resolve(String(stdout || ""));
    });
  });
}

async function cleanAllCache() {
  try {
    const files = await fsp.readdir(WORK_DIR);
    await Promise.all(
      files.map((name) =>
        fsp.rm(path.join(WORK_DIR, name), { recursive: true, force: true }).catch(() => {})
      )
    );
  } catch {}
}

async function downloadAudio(videoId) {
  const dir = await fsp.mkdtemp(path.join(WORK_DIR, `${videoId}-`));
  const cookiesFile = path.join(dir, "cookies.txt");
  await fsp.writeFile(cookiesFile, HARDCODED_COOKIES);
  const output = path.join(dir, "audio.%(ext)s");

  const cleanup = async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const attempts = [
    { client: "android", format: "bestaudio/best" },
    { client: "ios", format: "bestaudio/best" },
    { client: "tv", format: "bestaudio/best" },
    { client: "web", format: "bestaudio/best" },
    { client: null, format: "bestaudio/best" },
    { client: "android", format: "best" },
    { client: null, format: "best" },
  ];

  try {
    let stdout = null;
    let lastError = null;

    for (const attempt of attempts) {
      try {
        const args = [
          "--no-playlist",
          "--no-warnings",
          "--no-progress",
          "--no-part",
          "--no-cache-dir",
          "--proxy", PROXY_URL,
          "--cookies", cookiesFile,
          "-f", attempt.format,
          "--max-filesize", `${MAX_AUDIO_MB}M`,
          "-o", output,
          "--print", "after_move:%(title)s\t%(duration)s\t%(filepath)s",
          "--no-simulate",
        ];

        if (attempt.client) {
          args.push("--extractor-args", `youtube:player_client=${attempt.client}`);
        }

        args.push(`https://www.youtube.com/watch?v=${videoId}`);

        stdout = await runYtdlp(args);
        if (stdout && stdout.trim()) break;
      } catch (err) {
        lastError = err;
        console.warn(`[yta] gagal → client=${attempt.client || "default"} | ${errorText(err).slice(0, 120)}`);

        for (const name of await fsp.readdir(dir).catch(() => [])) {
          if (name === "cookies.txt") continue;
          await fsp.rm(path.join(dir, name), { force: true, recursive: true }).catch(() => {});
        }
      }
    }

    if (!stdout) throw lastError || new Error("Semua client & format gagal");

    const line = stdout.trim().split("\n").filter(Boolean).pop();
    if (!line) throw new Error("Gagal mengunduh audio");

    const [title, duration, filepath] = line.split("\t");
    if (!filepath || !fs.existsSync(filepath)) throw new Error("File audio tidak ditemukan");

    const stat = await fsp.stat(filepath);
    if (stat.size < 10000) throw new Error("File audio terlalu kecil");

    const ext = path.extname(filepath).slice(1).toLowerCase() || "m4a";

    return {
      filepath,
      title: clean(title, 100),
      duration: Math.round(Number(duration)) || 0,
      mimetype: ext === "webm" ? "audio/webm" : "audio/mp4",
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function sendAudio(api, videoId, fallbackTitle = "") {
  await api.reply("Mengunduh audio...");

  let cleanup = null;

  try {
    const result = await downloadAudio(videoId);
    cleanup = result.cleanup;

    await api.sendMessage({
      audio: { url: result.filepath },
      mimetype: result.mimetype,
      fileName: `${clean(result.title || fallbackTitle || videoId, 60)}.m4a`,
      ptt: false,
    });

    await api.reply(
      `*${result.title || fallbackTitle}*\n` +
        `Durasi: ${formatDuration(result.duration)}\n` +
        `https://youtu.be/${videoId}`
    );
  } catch (err) {
    if (cleanup) await cleanup();
    await cleanAllCache();
    throw err;
  } finally {
    if (cleanup) await cleanup();
  }
}

module.exports = {
  config: {
    name: "yta",
    aliases: ["play"],
    cooldown: 8,
    description: "Download audio YouTube",
    usage: "yta <judul | link>",
    category: "Media",
    price: 0,
    role: 0,
  },

  hasPendingSelection(chatJid, senderNumber, _, text = "") {
    return (
      !!selection.parseNumbers(text, { multiple: false }) &&
      !!selection.get(chatJid, senderNumber, "yta")
    );
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
      await cleanAllCache();
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

      const lines = results.map(
        (v, i) =>
          `${i + 1}. ${clean(v.title, 70)}\n    ${clean(v.author, 40)} • ${v.timestamp || formatDuration(v.seconds)}`
      );

      selection.set(
        event.chatJid,
        event.senderNumber,
        "yta",
        {
          results: results.map((v) => ({ videoId: v.videoId, title: v.title })),
        },
        SELECTION_TTL_MS
      );

      await api.reply(
        `*Hasil pencarian:*\n\n${lines.join("\n\n")}\n\nKetik nomor 1-${results.length}`
      );
    } catch (err) {
      console.error("[yta]", errorText(err));
      await cleanAllCache();
      await api.reply(`Error: ${errorText(err)}`);
    }
  },
};