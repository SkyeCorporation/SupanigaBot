module.exports = {
  config: {
    name: "me",
    aliases: ["profile", "saldo"],
    cooldown: 5,
    description: "Lihat profil & saldo kamu",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, user, role, utils }) {
    await api.reply(
      [
        "👤 *Profil Kamu*",
        `• User ID: #${user.userID}`,
        `• Nama: ${user.nama}`,
        `• Nomor: ${user.nomor}`,
        `• Saldo: ${user.money.toLocaleString("id-ID")}`,
        `• Role: ${utils.ROLE_NAMES[role]}`,
      ].join("\n"),
    );
  },
};
