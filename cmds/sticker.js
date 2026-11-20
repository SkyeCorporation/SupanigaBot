const { normalizeMessageContent } = require("baileys");
const { toSticker } = require("./lib/sticker");

const MAX_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = ["imageMessage", "videoMessage", "stickerMessage", "documentMessage"];

/** Cari media yang bisa dijadikan stiker pada pesan saat ini atau pesan yang dibalas. */
function pickMedia(event) {
  for (const envelope of [event.mediaMessage, event.quotedMediaMessage]) {
    if (!envelope?.message) continue;
    const content = normalizeMessageContent(envelope.message);
    for (const type of MEDIA_TYPES) {
      const media = content?.[type];
      if (!media) continue;
      const mime = String(media.mimetype || "").toLowerCase();
      if (type === "documentMessage" && !/^(image|video)\//.test(mime)) continue;
      return { envelope, type, media, mime };
    }
  }
  return null;
}

module.exports = {
  config: {
    name: "sticker",
    aliases: ["stiker", "s"],
    cooldown: 5,
    description: "Mengubah gambar, GIF, atau video pendek menjadi stiker WhatsApp",
    usage: "sticker [-crop] (kirim atau balas gambar, GIF, atau video)",
    category: "Media",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, event, args, prefix }) {
    const found = pickMedia(event);
    if (!found) {
      return api.reply(`Kirim atau balas gambar, GIF, atau video dengan ${prefix}sticker.\nTambahkan -crop untuk memenuhi seluruh bingkai.`);
    }
    const { envelope, type, media, mime } = found;
    if (Number(media.fileLength) > MAX_BYTES) return api.reply("Ukuran file terlalu besar. Batas maksimum 20 MB.");
    if (type === "videoMessage" && Number(media.seconds) > 30) {
      return api.reply("Durasi video terlalu panjang. Gunakan video maksimal 30 detik; hanya 8 detik pertama yang dipakai.");
    }

    const buffer = await api.downloadMedia(envelope);
    if (!buffer?.length) return api.reply("File tidak berhasil diunduh. Silakan kirim ulang.");
    if (buffer.length > MAX_BYTES) return api.reply("Ukuran file terlalu besar. Batas maksimum 20 MB.");

    const crop = args.some((arg) => arg.toLowerCase() === "-crop");
    const sticker = await toSticker(buffer, {
      mime: type === "videoMessage" && !mime ? "video/mp4" : mime,
      crop,
      keepSticker: type === "stickerMessage",
    });
    await api.sendMessage({ sticker });
  },
};
