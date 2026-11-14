module.exports = {
  config: {
    name: "reload",
    cooldown: 5,
    description: "Muat ulang semua command tanpa restart",
    category: "Admin",
    price: 0,
    role: 3,
  },
  onStart: async function ({ api }) {
    const { loadCommands } = await import("../core/commands.js");
    const total = loadCommands();
    await api.reply(`♻️ ${total} command berhasil dimuat ulang.`);
  },
};
