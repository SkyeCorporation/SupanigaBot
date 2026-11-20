/**
 * .polli - Generate gambar pakai Pollinations.ai (gratis)
 * Cooldown: 15 detik | Role: 0
 */
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

const WORK_DIR = path.join(__dirname, "..", "tmp", "polli");
const COOLDOWN = 15; // detik

// Pastikan folder sementara ada
try {
  fs.mkdirSync(WORK_DIR, { recursive: true });
} catch {}

function clean(text, max = 200) {
  return String(text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

module.exports = {
  config: {
    name: "polli",
    aliases: ["gen", "imagine", "pollinations"],
    cooldown: COOLDOWN,
    description: "Generate gambar AI menggunakan Pollinations (gratis)",
    usage: "polli <prompt>\nContoh: polli a beautiful anime girl, detailed",
    category: "AI",
    price: 0,
    role: 0,
  },

  async onStart({ api, args, event }) {
    const prompt = args.join(" ").trim();

    if (!prompt) {
      return api.reply(
        `*Cara pakai:*\n.polli <prompt>\n\n*Contoh:*\n.polli a cute anime girl with blue hair\n.polli cyberpunk city at night, neon lights`
      );
    }

    if (prompt.length > 400) {
      return api.reply("Prompt terlalu panjang (maksimal 400 karakter).");
    }

    const safePrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?model=flux&width=1024&height=1024&nologo=true&enhance=true`;

    await api.reply(`🎨 Sedang membuat gambar...\nPrompt: ${clean(prompt, 80)}`);

    try {
      // Download gambar ke folder sementara
      const fileName = `polli_${Date.now()}.jpg`;
      const filePath = path.join(WORK_DIR, fileName);

      const response = await fetch(imageUrl, {
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`Gagal generate gambar (HTTP ${response.status})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length < 1000) {
        throw new Error("Gambar yang dihasilkan terlalu kecil / gagal.");
      }

      await fsp.writeFile(filePath, buffer);

      // Kirim gambar
      await api.sendMessage({
        image: { url: filePath },
        caption: `✅ *Pollinations*\n📝 ${clean(prompt, 120)}`,
      });

      // Hapus file setelah dikirim
      await fsp.unlink(filePath).catch(() => {});
    } catch (error) {
      console.error("[polli]", error);
      await api.reply(`Gagal membuat gambar: ${error.message || error}`);
    }
  },
};
