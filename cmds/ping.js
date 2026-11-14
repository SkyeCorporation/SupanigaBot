module.exports = {
  config: {
    name: "ping",
    cooldown: 10,
    description: "Cek kecepatan respon bot",
    category: "Umum",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, event }) {
    const sentAt = Number(event.message.messageTimestamp) * 1000 || Date.now();
    const latency = Math.max(0, Date.now() - sentAt);
    await api.sendMessage(`🏓 Pong!\n⚡ Respon: *${latency} ms*`);
  },
};
