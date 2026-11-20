const { sendStatusCard } = require("./lib/user-status");

module.exports = {
  config: {
    name: "status",
    aliases: ["profil"],
    cooldown: 10,
    description: "Menampilkan kartu status Anda: foto profil, nama, ID, saldo, level, dan EXP",
    usage: "status",
    category: "User",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, user, role, config, utils }) {
    await sendStatusCard({ api, user, title: "USER STATUS", config, utils, roleLabel: role >= 2 ? utils.ROLE_NAMES[role] : undefined });
  },
};
