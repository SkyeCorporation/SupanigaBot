module.exports = {
  config: {
    name: "reload",
    cooldown: 5,
    description: "Memuat ulang seluruh command tanpa memulai ulang bot",
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
