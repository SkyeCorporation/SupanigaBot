module.exports = {
  config: {
    name: "setname",
    cooldown: 30,
    description: "Ganti nama kamu di database bot",
    usage: "setname <nama>",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, args, usersData, event, prefix }) {
    const nama = args.join(" ").trim().slice(0, 40);
    if (!nama) return api.reply(`Contoh: *${prefix}setname Demian*`);
    await usersData.set(event.senderNumber, { nama });
    await api.reply(`✅ Nama kamu sekarang: *${nama}*`);
  },
};
