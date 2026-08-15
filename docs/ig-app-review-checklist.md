# Instagram App Review — checklist untuk pemilik

Increment 7 (inbox Komentar/DM Instagram) tidak bisa melayani publik sebelum
App Review Meta selesai, dan review memakan **beberapa hari kalender**. Daftar
ini disusun dari `docs/rebuild/06-webhook-integration.md` §5 supaya pengajuan
benar pada percobaan pertama. WhatsApp **tidak** butuh review ini — Increment 7
sisi WA jalan duluan.

App ID: `2157052578394015` (app yang sama dengan WhatsApp — satu app, dua
channel, satu `APP_SECRET`).

## Prasyarat (cek dulu, 10 menit)

- [ ] Akun IG toko bertipe **Business** atau **Creator** — bukan personal.
      IG app → Settings → *Account type and tools*.
- [ ] Akun IG tertaut ke Facebook Page yang kamu kelola.
      Page → Settings → *Linked accounts*.
- [ ] Kamu punya akses admin ke <https://business.facebook.com> untuk bisnis ini.

## Pengajuan (di dashboard app)

1. [ ] App Dashboard → *Add product* → **Instagram** → *Set up*
       (kalau belum ada dari build lama).
2. [ ] Minta izin (permissions) berikut — persis lima ini, jangan lebih:
       - `instagram_basic`
       - `instagram_manage_comments`  ← balas & sembunyikan komentar
       - `instagram_manage_messages`  ← kirim DM
       - `pages_show_list`
       - `pages_read_engagement`
3. [ ] Untuk tiap izin, App Review minta **screencast** pemakaian. Rekam layar
       POS lama (atau tulis: fitur sedang dibangun ulang, tunjukkan alur:
       komentar masuk → staf membalas dari dashboard → balasan muncul di IG).
       Meta menerima demo dengan akun test selama alurnya jelas.
4. [ ] Isi *App Details*: ikon, privacy policy URL, deskripsi singkat
       ("dashboard internal untuk membalas komentar & DM toko").
5. [ ] Submit. Catat tanggalnya di sini: ________

## Sesudah disetujui

- [ ] Business Settings → System Users → `nusantara-webhook` → *Add Assets* →
      tambahkan Page + IG account → generate token **dengan kelima scope di
      atas** → simpan sebagai `IG_ACCESS_TOKEN` di
      `secrets/webhook-credentials.env` (jangan pernah di file lain).
- [ ] Ambil `IG_BUSINESS_ACCOUNT_ID`:
      `curl -s "https://graph.facebook.com/v25.0/me/accounts?fields=instagram_business_account,name&access_token=$IG_ACCESS_TOKEN"`
- [ ] Kabari sesi berikutnya bahwa review sudah lolos — Increment 7 sisi IG
      baru dijadwalkan setelah itu.

## Jebakan yang sudah memakan waktu orang lain (dari 06 §4–5)

- Token dari Graph Explorer kedaluwarsa 60 hari dan mati diam-diam jam 3 pagi.
  **Selalu** pakai token System User (tidak kedaluwarsa).
- *Development mode* sudah cukup untuk **akun yang punya role di app** — jadi
  pengembangan Increment 7 bisa mulai sebelum review lolos, asal pakai akun IG
  toko sendiri. Review hanya menahan trafik publik.
