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

## Esdeath AI

- Saat memproses jawaban, bot menampilkan indikator mengetik.
- Persona Esdeath bersifat tenang dan dingin, memakai aksi roleplay seperti `*menatapmu datar*` dengan emote secukupnya.
- Ekspresi: letakkan gambar `.png`, `.jpg`, atau `.jpeg` di folder `expressionAI/` dengan nama sesuai ekspresi, misalnya `marah.jpg`, `senang.png`, `sedih.jpeg`. Bila jawaban AI cocok dengan nama file, gambar dikirim sebagai stiker WhatsApp.

## Command lainnya

- `.sticker [-crop]` mengubah gambar, GIF, atau video pendek menjadi stiker. PNG transparan tetap transparan; GIF dan video menjadi stiker bergerak.
- `.pixiv <kata kunci> [-halaman] [-adult]` mencari ilustrasi Pixiv dalam kolase bernomor. Contoh: `.pixiv nakano miku -1 -adult`. Mode `-adult` memerlukan `PIXIV_COOKIE`. Bila `i.pximg.net` diblokir jaringan hosting, gambar otomatis diambil lewat mirror `i.pixiv.re` / `i.pixiv.nl`; isi `PIXIV_IMAGE_PROXY` untuk memakai mirror sendiri.
- `.status` menampilkan kartu status berisi foto profil, nama, ID, saldo, level, dan EXP.
- `.whois <ID>` menampilkan kartu status user lain.
- `.pay <ID> <jumlah>` mengirim uang kepada user lain.
- `.shell <perintah>` menjalankan perintah shell di server (khusus Admin Bot). Panel Shell juga tersedia di dashboard web. Ganti sandi dashboard di `config.json` sebelum dipakai, atau set `DISABLE_SHELL=1` untuk menonaktifkan.

## Level, EXP, dan saldo per chat

Setiap command yang berhasil memberi 10 EXP. Pesan biasa memberi 3 EXP dan saldo acak 0,4 sampai 0,8, paling banyak sekali per menit. Saldo disimpan dengan dua angka desimal. Naik level membutuhkan 100 x level saat ini.

## Tes

Jalankan `npm test`.
