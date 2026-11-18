# Setup Esdeath AI

Tambahkan environment variable `GEMINI_API_KEY` pada menu Variables/Environment di panel hosting (ambil API key dari Google AI Studio). Model default adalah `gemini-3.5-flash-lite`; pastikan model ini tersedia untuk API key dan region akun Anda, atau set `GEMINI_MODEL` ke model Flash lain yang tersedia.

Esdeath menyimpan konteks percakapan per chat dan user pada `historyAI.json` di root project (maksimum 20 pesan terakhir per percakapan). File dibuat otomatis dan dikecualikan dari Git agar riwayat tetap lokal di host dan tidak ikut ter-push.

Command `.sticker` mengubah foto yang dikirim atau dibalas menjadi sticker WebP. Install dependency setelah update dengan `npm install`.

Simpan API key sebagai secret pada hosting dan jangan commit key ke GitHub atau kirimkan ke chat. Jika memakai file `.env` secara lokal, pastikan proses Node/hosting benar-benar memuat file itu; `.env.example` hanya template.

Admin bot yang ditetapkan pada `config.json` adalah nomor WhatsApp dengan format internasional tanpa tanda `+`.

## Command media

- `.pin <kata kunci> [-halaman]` mengambil foto dari Pinterest. Bot mengirim satu gambar kolase berisi 8 foto bernomor; ketik saja nomornya di chat, tanpa reply. Untuk beberapa foto, pakai koma, contoh `1, 2, 3`.
- `.yta <judul>` menampilkan 10 hasil YouTube; ketik nomornya (contoh `2`) untuk menerima audio lengkap. `.yta <link YouTube>` langsung mengirim audio. File sementara di `tmp/yta/` dihapus setelah dikirim.
- `.yta cek` menampilkan versi YTA dan yt-dlp/ffmpeg yang dipakai di hosting. Saat bot menyala, console juga menulis `[yta] Siap v...`. Bila versi tidak muncul, berarti hosting masih menjalankan kode lama: tarik ulang branch terbaru lalu restart bot.
- Pengunduh [yt-dlp](https://github.com/yt-dlp/yt-dlp) dicari berurutan: `YTDLP_PATH`, binary resmi yang diunduh otomatis (diperbarui mingguan), `yt-dlp` di sistem, lalu versi Python bila ada `python3`. Bila YouTube meminta verifikasi bukan bot, bot otomatis mencoba cara akses lain; bila tetap gagal, isi `YTDLP_COOKIES` dengan path file `cookies.txt` YouTube.
- Audio diubah ke MP3 memakai ffmpeg yang dicari berurutan: `FFMPEG_PATH`, `@ffmpeg-installer/ffmpeg` (dari `npm install`), ffmpeg di sistem, lalu unduh otomatis. Bila semua gagal, audio lengkap tetap dikirim sebagai M4A.
- Binary disimpan di `~/.cache/supanigabot`, atau `tmp/bin/` di folder bot bila folder home tidak bisa ditulis. Tidak ada modul npm tambahan yang wajib untuk YTA selain `yt-search`.
