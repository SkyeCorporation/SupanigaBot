module.exports = {
  config: {
    name: "sticker",
    aliases: ["stiker", "s"],
    cooldown: 5,
    description: "Ubah gambar menjadi WhatsApp sticker",
    usage: "sticker (kirim atau balas sebuah foto)",
    category: "Media",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, event }) {
    const imageMessage = event.mediaMessage || event.quotedMediaMessage;
    const image = imageMessage?.message?.imageMessage;
    if (!image) return api.reply("Masukan gambar untuk membuat sticker");

    const mimeType = String(image.mimetype || "").toLowerCase();
    if (!mimeType.startsWith("image/")) return api.reply("Masukan gambar untuk membuat sticker");
    if (Number(image.fileLength) > 15 * 1024 * 1024) {
      return api.reply("Ukuran gambar terlalu besar. Batas maksimum 15 MB.");
    }

    const buffer = await api.downloadMedia(imageMessage);
    if (!buffer?.length) return api.reply("Gambar tidak berhasil diunduh. Coba kirim ulang.");
    if (buffer.length > 15 * 1024 * 1024) {
      return api.reply("Ukuran gambar terlalu besar. Batas maksimum 15 MB.");
    }

    const sharp = require("sharp");
    const sticker = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85, effort: 5 })
      .toBuffer();

    await api.sendMessage({ sticker, packname: "SupanigaBot", author: "Luxion" });
  },
};
