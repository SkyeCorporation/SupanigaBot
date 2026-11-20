const { sendStatusCard } = require("./lib/user-status");

module.exports = {
  config: {
    name: "whois",
    aliases: [],
    cooldown: 10,
    description: "Menampilkan kartu status user lain berdasarkan ID bot",
    usage: "whois <ID user | @tag | balas pesan>",
    category: "User",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, args, event, usersData, config, utils, prefix }) {
    const idArg = args.find((value) => /^#?\d{1,9}$/.test(value));
    let target = null;
    if (idArg) target = await usersData.getByID(Number(idArg.replace("#", "")));
    else if (event.targetNumber) target = await usersData.get(event.targetNumber);
    else return api.reply(`Gunakan: ${prefix}whois <ID user>\nContoh: ${prefix}whois 12`);
    if (!target) return api.reply(idArg ? `User dengan ID ${idArg.replace("#", "")} tidak ditemukan.` : "User tersebut belum terdaftar di database bot.");
    await sendStatusCard({ api, user: target, title: "WHOIS", config, utils });
  },
};
