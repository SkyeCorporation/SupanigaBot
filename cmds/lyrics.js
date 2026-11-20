/**
 * .lyrics - Cari lirik lagu (Lyrics.ovh)
 * Cooldown: 10 detik | Role: 0
 */
module.exports = {
  config: {
    name: "lyrics",
    aliases: ["lirik", "lyric"],
    cooldown: 10,
    description: "Mencari lirik lagu",
    usage: "lyrics <judul lagu> | <judul - artist>\nContoh: lyrics Viva la Vida\nlirik Shape of You - Ed Sheeran",
    category: "Media",
    price: 0,
    role: 0,
  },

  async onStart({ api, args }) {
    const query = args.join(" ").trim();

    if (!query) {
      return api.reply(
        `*Cara pakai:*\n.lyrics <judul lagu>\n.lyrics <judul> - <artist>\n\n*Contoh:*\n.lyrics Viva la Vida\n.lyrics Shape of You - Ed Sheeran`
      );
    }

    // Pisahkan artist & title jika memakai tanda "-"
    let artist = "";
    let title = query;

    if (query.includes(" - ")) {
      const parts = query.split(" - ");
      title = parts[0].trim();
      artist = parts.slice(1).join(" - ").trim();
    } else if (query.includes("-")) {
      const parts = query.split("-");
      title = parts[0].trim();
      artist = parts.slice(1).join("-").trim();
    }

    // Kalau tidak ada artist, coba cari dengan title saja (lyrics.ovh butuh artist)
    // Kita coba beberapa kemungkinan
    const attempts = [];

    if (artist) {
      attempts.push({ artist, title });
    } else {
      // Coba beberapa artist umum / kosong
      attempts.push({ artist: " ", title }); // kadang berhasil
      attempts.push({ artist: title.split(" ")[0], title }); // tebak artist dari kata pertama
    }

    await api.reply(`🔍 Mencari lirik: *${query}*...`);

    let lyrics = null;
    let usedArtist = "";
    let usedTitle = "";

    for (const attempt of attempts) {
      try {
        const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(attempt.artist)}/${encodeURIComponent(attempt.title)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

        if (!res.ok) continue;

        const data = await res.json();
        if (data && data.lyrics && data.lyrics.trim().length > 20) {
          lyrics = data.lyrics.trim();
          usedArtist = attempt.artist;
          usedTitle = attempt.title;
          break;
        }
      } catch (e) {
        // lanjut coba berikutnya
      }
    }

    // Fallback: coba langsung dengan query sebagai title dan artist kosong/umum
    if (!lyrics) {
      try {
        // Coba beberapa artis populer sebagai fallback (tidak ideal, tapi membantu)
        const fallbackArtists = ["", "Unknown", "Various Artists"];
        for (const fa of fallbackArtists) {
          const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(fa || " ")}/${encodeURIComponent(query)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
          if (!res.ok) continue;
          const data = await res.json();
          if (data?.lyrics?.trim().length > 20) {
            lyrics = data.lyrics.trim();
            usedTitle = query;
            usedArtist = fa || "-";
            break;
          }
        }
      } catch {}
    }

    if (!lyrics) {
      return api.reply(
        `❌ Lirik tidak ditemukan.\n\nCoba format:\n.lyrics Judul Lagu - Nama Artist\n\nContoh:\n.lyrics Viva la Vida - Coldplay`
      );
    }

    // Potong jika terlalu panjang (WhatsApp limit)
    const maxLength = 3500;
    let finalLyrics = lyrics;
    if (finalLyrics.length > maxLength) {
      finalLyrics = finalLyrics.slice(0, maxLength) + "\n\n... (lirik dipotong)";
    }

    const header = usedArtist && usedArtist !== "-" && usedArtist !== " "
      ? `🎵 *${usedTitle}*\n👤 ${usedArtist}\n\n`
      : `🎵 *${usedTitle || query}*\n\n`;

    await api.reply(header + finalLyrics);
  },
};
