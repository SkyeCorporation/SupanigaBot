const MAX_RESULTS = 8;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const pendingSelections = new Map();

function selectionKey(chatJid, senderNumber, messageId) {
  return `${chatJid}:${senderNumber}:${messageId}`;
}

function clean(value, maxLength = 140) {
  return String(value || "Unknown").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function prune() {
  const now = Date.now();
  for (const [key, value] of pendingSelections) if (value.expiresAt <= now) pendingSelections.delete(key);
}

module.exports = {
  config: {
    name: "yta",
    aliases: [],
    cooldown: 5,
    description: "Cari lagu dan kirim preview audio resmi 30 detik",
    usage: "yta <judul lagu>, lalu balas daftar dengan nomor",
    category: "Media",
    price: 0,
    role: 0,
  },
  hasPendingSelection(chatJid, senderNumber, quotedMessageId) {
    prune();
    return pendingSelections.has(selectionKey(chatJid, senderNumber, quotedMessageId));
  },
  onReply: async function ({ api, event, text, quotedMessageId }) {
    prune();
    const key = selectionKey(event.chatJid, event.senderNumber, quotedMessageId);
    const pending = pendingSelections.get(key);
    if (!pending) return false;
    if (!/^\d{1,2}$/.test(String(text).trim())) {
      await api.reply(`Balas daftar YTA dengan angka 1-${pending.results.length}.`);
      return true;
    }
    const index = Number(String(text).trim()) - 1;
    const track = pending.results[index];
    if (!track) {
      await api.reply(`Nomor tidak tersedia. Pilih 1-${pending.results.length}.`);
      return true;
    }
    try {
      await api.reply(`🎧 Mengambil preview resmi *${clean(track.trackName)}*…`);
      const response = await fetch(track.previewUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Preview API merespons HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("audio/")) throw new Error(`URL preview tidak mengembalikan audio (content-type: ${contentType || "tidak ada"}).`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_PREVIEW_BYTES) throw new Error("File preview melewati batas 2 MB.");
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > MAX_PREVIEW_BYTES) throw new Error(`Preview kosong atau terlalu besar (${audio.length} byte).`);
      await api.sendMessage({ audio, mimetype: contentType.includes("mpeg") ? "audio/mpeg" : "audio/mp4", fileName: `${clean(track.trackName, 70)}.m4a`, ptt: false });
      pendingSelections.delete(key);
    } catch (error) {
      const detail = String(error?.message || error).replace(/[\r\n\t]+/g, " ").slice(0, 700);
      console.error(`[yta] ${detail}`);
      await api.reply(`❌ Preview YTA gagal: ${detail}`).catch(() => {});
    }
    return true;
  },
  onStart: async function ({ api, args, event }) {
    prune();
    const query = args.join(" ").trim();
    if (!query) return api.reply("Masukkan judul lagu. Contoh: *.yta cruel angel thesis*");
    if (query.length > 150) return api.reply("Judul pencarian terlalu panjang (maksimal 150 karakter).");

    try {
      await api.reply("🔎 Mencari lagu…");
      const params = new URLSearchParams({ term: query, entity: "song", media: "music", limit: String(MAX_RESULTS) });
      const response = await fetch(`https://itunes.apple.com/search?${params}`, {
        headers: { "user-agent": "SupanigaBot/1.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`iTunes Search API merespons HTTP ${response.status}`);
      const result = await response.json();
      const results = (result.results || []).filter((item) => typeof item.previewUrl === "string" && /^https:\/\//.test(item.previewUrl)).slice(0, MAX_RESULTS);
      if (!results.length) return api.reply("Tidak ada lagu dengan preview audio yang tersedia untuk kata kunci itu.");

      const lines = results.map((item, index) => `${index + 1}. *${clean(item.trackName)}*\n   ${clean(item.artistName)} — ${clean(item.collectionName)}\n   Preview resmi ±30 detik`);
      const sent = await api.reply(`🎵 *Hasil pencarian lagu*\n\n${lines.join("\n\n")}\n\nBalas pesan ini dengan angka 1-${results.length} untuk menerima preview. Preview adalah cuplikan resmi, bukan lagu penuh.`);
      const messageId = sent?.key?.id;
      if (!messageId) throw new Error("WhatsApp tidak mengembalikan ID pesan daftar; pemilihan hasil tidak dapat diaktifkan.");
      pendingSelections.set(selectionKey(event.chatJid, event.senderNumber, messageId), {
        results,
        expiresAt: Date.now() + SELECTION_TTL_MS,
      });
    } catch (error) {
      const detail = String(error?.message || error).replace(/[\r\n\t]+/g, " ").slice(0, 700);
      console.error(`[yta] ${detail}`);
      await api.reply(`❌ Pencarian YTA gagal: ${detail}`).catch(() => {});
    }
  },
};
