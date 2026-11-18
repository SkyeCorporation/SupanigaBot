# Setup Esdeath AI

Tambahkan environment variable `GEMINI_API_KEY` pada menu Variables/Environment di panel hosting (ambil API key dari Google AI Studio). Model default adalah `gemini-3.5-flash-lite`; pastikan model ini tersedia untuk API key dan region akun Anda, atau set `GEMINI_MODEL` ke model Flash lain yang tersedia.

Esdeath menyimpan konteks percakapan per chat dan user pada `historyAI.json` di root project (maksimum 20 pesan terakhir per percakapan). File dibuat otomatis dan dikecualikan dari Git agar riwayat tetap lokal di host dan tidak ikut ter-push.

Command `.sticker` mengubah foto yang dikirim atau dibalas menjadi sticker WebP. Install dependency setelah update dengan `npm install`.

Simpan API key sebagai secret pada hosting dan jangan commit key ke GitHub atau kirimkan ke chat. Jika memakai file `.env` secara lokal, pastikan proses Node/hosting benar-benar memuat file itu; `.env.example` hanya template.

Admin bot yang ditetapkan pada `config.json` adalah nomor WhatsApp dengan format internasional tanpa tanda `+`.

## Command media

- `.pin <kata kunci> [-halaman]` mengambil foto dari Pinterest. Bot mengirim satu gambar kolase berisi 8 foto bernomor; ketik saja nomornya di chat, tanpa reply. Untuk beberapa foto, pakai koma, contoh `1, 2, 3`.
- `.yta <judul>` menampilkan 10 hasil YouTube; ketik nomornya (contoh `2`) untuk menerima audio. `.yta <link YouTube>` langsung mengirim audio. File sementara dihapus setelah dikirim.
- YTA memakai [yt-dlp](https://github.com/yt-dlp/yt-dlp) yang diunduh otomatis saat pertama dipakai (diperbarui mingguan). Atur `YTDLP_PATH` untuk memakai yt-dlp sendiri. Bila hosting mendapat pesan "Sign in to confirm you're not a bot", isi `YTDLP_COOKIES` dengan path file `cookies.txt` YouTube. Audio diubah ke MP3 memakai `ffmpeg-static` (ikut terpasang lewat `npm install`, atau atur `FFMPEG_PATH`), disimpan sementara di folder `tmp/yta/`, lalu langsung dihapus setelah terkirim.
