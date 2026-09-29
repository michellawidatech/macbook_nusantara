# Chatbot knowledge — the owner's answers, 2026-09-18

The shop's approved answers for the WhatsApp bot, from the owner's "Lists of
Questions" document (Google Docs, 2026-09-18). Paste everything from the first
`Q:` down into **/chat → Knowledge → Import from a document**, or load it on the
server with `ops/run knowledge import <this file>` (see docs/chatbot-rag.md).
Lines before the first `Q:` — this heading — are ignored by the importer.

These edits were made to the original, and nothing else was reworded (a few
questions also had spelling tidied — "yg" → "yang", "oprasional" →
"operasional", "splitpayment" → "split payment" — which changes nothing the bot
matches on, because retrieval reads chat spelling anyway):

1. The line `boleh tau by` was a stray fragment and is removed.
2. "Boleh tahu kak, budget … untuk kebutuhan apa ya?" was split across a `Q:`
   and an `A:` by accident. It is the shop's own question to a customer who
   wants a recommendation, so it is filed as the answer to that request.
3. "Battery health nya berapa kak? (lampirkan foto macbook dengan Bh nya)" is
   an instruction to staff — send a photo of that machine's battery health —
   so it is NOT an answer the bot can give. It is handed to a person by rule
   (docs/chatbot-rag.md, "Always a person"). The `A:` under it, "Apakah pernah
   ganti sparepart kak?", was a separate question and is filed as one.
4. Typos: "debate pulang" → "dibawa pulang", "MacBook + charge" → "MacBook +
   charger".

Q: Cicilan bisa pake apa aja kak?
A: Bisa kak, ada beberapa pilihan cicilan yang bisa digunakan, tergantung metode pembayaran dan tenor yang kakak pilih.
Boleh info MacBook yang kakak mau? Cukup bawa KTP dan ke toko, nanti kami bantu cekkan estimasi cicilannya ya kak. Siapa tahu ada yang pas dengan budget kakak.

Q: Kelengkapannya ada apa kak?
A: Untuk kelengkapannya tergantung unit yang kakak pilih ya.
Umumnya sudah termasuk MacBook + charger, dan untuk beberapa unit tersedia box/original packaging serta kelengkapan lainnya.
Kalau kakak info seri MacBook yang diminati, nanti kami cekkan detail kelengkapan unitnya sekalian ya kak.

Q: Bingung pilih MacBook yang mana kak, bisa bantu rekomendasi?
A: Boleh tahu kak, budget yang disiapkan kisaran berapa dan MacBook-nya untuk kebutuhan apa ya? 😊
Biar kami bantu pilihkan unit yang paling pas dari segi spek, kondisi, dan budget kak 🙏

Q: Ada price list nya ga kak?
A: Ada kak 😊 Boleh tahu kakak lagi cari MacBook yang tipe apa atau budget kisaran berapa?
Nanti kami bantu pilihkan beberapa unit yang paling cocok beserta harga dan detail kondisinya, jadi kakak bisa langsung compare ya 🙏

Q: Untuk harga udah net atau masih bisa nego kak?
A: Untuk harga kami sudah diusahakan yang terbaik dan kompetitif ya kak 😊 Jadi sebagian besar unit memang sudah harga net.
Tapi kalau kakak sudah ada unit yang diminati, boleh info seri MacBook-nya. Nanti kami bantu cekkan apakah masih ada best price khusus yang bisa kami kasih ya kak 🙏

Q: Cara cicilannya gimana kak?
A: Cukup bawa KTP dan datang langsung ke toko ya kak 😊 Nanti tim kami bantu cekkan opsi dan estimasi cicilan yang tersedia sesuai dengan MacBook yang kakak pilih.
Siapa tahu ada skema cicilan yang pas dengan budget kakak, jadi bisa langsung dibawa pulang 🙏😊

Q: Kalo co dari shopee bisa di ambil langsung ke toko ga kak?
A: Bisa kak 😊 Kalau checkout melalui Shopee, untuk pengambilan langsung di toko bisa kami bantu cek terlebih dahulu ya kak.
Kakak boleh info produk yang mau di-checkout, nanti kami bantu arahkan prosesnya supaya bisa checkout di Shopee dan ambil langsung di toko 🙏😊

Q: Cod bisa ga kak?
A: Bisa kak 😊 Untuk COD area Jabodetabek bisa kami bantu, namun ada biaya transportasi sebesar Rp180.000 ya kak. Di luar itu, untuk pembayaran unitnya tetap sesuai harga yang sudah disepakati.
Kalau kakak berkenan, boleh info lokasi pengiriman, nanti kami bantu proses ya kak 🙏

Q: Apakah unitnya ready?
A: Ready kak 😊 Untuk memastikan unit yang kakak incar masih tersedia dan sesuai dengan stok terbaru, boleh kirim tipe atau seri MacBook yang kakak cari ya kak.
Nanti kami bantu cekkan stok, spek, kondisi, dan harga terbarunya. Kalau cocok, bisa langsung kami bantu proses ya kak 🙏😊

Q: Bisa PO ga kak?
A: Bisa kak 😊 Untuk PO (pre-order) bisa kami bantu cek terlebih dahulu ya kak, tergantung tipe dan spek MacBook yang dicari.
Boleh kirim tipe MacBook yang kakak inginkan, nanti kami cekkan ketersediaan, estimasi harga, dan proses PO-nya ya kak 🙏

Q: Bisa kirim ke luar kota ga kak?
A: Bisa kak 😊 Kami melayani pengiriman ke luar kota juga ya kak. Unit akan kami packing dengan aman sebelum dikirim supaya lebih aman sampai tujuan.
Boleh info kota tujuan dan MacBook yang kakak incar, nanti kami bantu cekkan ongkir dan estimasi pengirimannya ya kak 🙏

Q: Aman ga ka kalo pengiriman keluar kota?
A: Aman kak 😊 Kami sudah biasa melayani pengiriman MacBook ke luar kota. Sebelum dikirim, unit kami cek dan packing dengan aman supaya meminimalisir risiko selama perjalanan.
Untuk keamanan transaksi, kami juga bantu informasikan detail unit, kondisi, dan dokumentasi sebelum pengiriman ya kak 🙏
Kalau kakak kasih tahu kota tujuannya, nanti kami bantu cek estimasi ongkirnya 😊

Q: Free install apk office ga kak?
A: Free kak 😊 Untuk pembelian MacBook di kami, install aplikasi juga free ya kak.
Aplikasi yang bisa kami bantu install:
Office Family
Adobe Photoshop
Adobe Premiere Pro
Adobe Illustrator
CapCut
Canva
PDF Reader
Mendeley
Spotify
Zoom
Google Chrome
Brave
Jadi nanti MacBook-nya bisa langsung siap dipakai sesuai kebutuhan kakak 😊🙏

Q: Untuk pengiriman bisa instan ga kak?
A: Bisa kak 😊 Untuk pengiriman instan juga bisa kami bantu, tergantung lokasi tujuan dan coverage kurir ya kak.
Boleh info kota atau alamat tujuan kak, nanti kami bantu cekkan estimasi ongkir dan waktu pengirimannya. Kalau memungkinkan, bisa langsung kami proses hari ini 🙏😊

Q: Selain kurir gojek biasa, ada kurir toko yang trusted ga kak?
A: Bisa kak 😊 Selain Gojek, kami juga bisa bantu gunakan kurir/driver terpercaya untuk pengiriman, terutama untuk unit MacBook supaya lebih aman (180k area Jabodetabek).
Kalau kakak mau, boleh info lokasi pengiriman, nanti kami bantu pilihkan opsi pengiriman yang paling aman dan sesuai ya kak 🙏

Q: Pengiriman keluar kota estimasinya berapa lama kak?
A: Untuk pengiriman luar kota biasanya estimasinya sekitar 1–3 hari kerja ya kak 😊 Tergantung kota tujuan dan ekspedisi yang digunakan.
Boleh info kota tujuannya, nanti kami bantu cekkan estimasi sampai dan ongkirnya ya kak 🙏

Q: Apakah pernah ganti sparepart kak?
A: Untuk riwayat sparepart tergantung masing-masing unit ya kak 😊 Kami transparan mengenai kondisi dan riwayat unit.
Boleh kirim tipe/seri MacBook yang kakak incar, nanti kami bantu cekkan apakah pernah ada penggantian sparepart atau belum, sekaligus kami informasikan detail kondisinya ya kak 🙏

Q: Minusnya apa aja kak?
A: Untuk minusnya tergantung kondisi masing-masing unit ya kak 😊 Kami akan informasikan kondisi unit secara transparan, termasuk kalau ada lecet, dent, atau kekurangan lainnya.
Boleh kirim tipe/seri MacBook yang kakak incar, nanti kami bantu cekkan detail kondisi dan minusnya, supaya kakak bisa tahu semuanya sebelum deal 🙏😊

Q: Garansi berapa lama kak?
A: Garansi dari kami 1 bulan ya kak 😊 Terhitung sejak unit diterima.
Selama masa garansi, kalau ada kendala yang termasuk dalam ketentuan garansi, bisa langsung hubungi kami dan akan kami bantu proses pengecekannya ya kak 🙏
Jadi kakak bisa lebih tenang saat membeli MacBook second di kami 😊

Q: Lokasi toko dimana kak?
A: Lokasi toko kami di Ruko Sorrento Place, Grande West Blok B No.32, Curug Sangereng, Kelapa Dua, Tangerang Regency, Banten 15811 ya kak 😊
📍 Google Maps: https://share.google/yOT50VB76MVqPLBMB
Kalau kakak mau datang, boleh info dulu MacBook yang mau dicek, nanti kami bantu siapkan unitnya supaya saat sampai bisa langsung lihat dan test ya kak 🙏😊

Q: Ada free aksesoris ga kak?
A: Untuk saat ini belum ada free aksesoris ya kak 😊 Tapi kami tetap berikan kelengkapan sesuai unit yang tersedia.
Kalau kakak sudah ada tipe MacBook yang diincar, boleh kirim serinya ya kak. Nanti kami bantu cekkan detail unitnya 🙏

Q: Bisa split payment ga kak?
A: Bisa kak 😊 Untuk split payment, bisa dilakukan melalui marketplace ya kak.
Kalau kakak sudah ada unit yang diincar, boleh kirim tipe MacBook-nya, nanti kami bantu arahkan proses checkout-nya ya 🙏😊

Q: Kalo fullset isinya apa aja kak?
A: Untuk fullset umumnya terdiri dari unit MacBook + charger ya kak 😊 Untuk kelengkapan seperti box dan aksesori lainnya tergantung masing-masing unit.

Q: Apakah bisa service juga kak?
A: Bisa kak 😊 Untuk service, saat ini kami bisa membantu penggantian baterai langsung di toko.
Untuk kebutuhan service lainnya, kami bekerja sama dengan teknisi eksternal terpercaya dengan harga yang tetap kompetitif ya kak. Jadi kalau ada kendala di MacBook, boleh konsultasikan dulu ke kami, nanti kami bantu arahkan ke solusi yang paling sesuai 🙏😊

Q: Bisa tukar tambah ga kak?
A: Bisa kak 😊 Kami melayani tukar tambah MacBook ya kak.
Untuk estimasi harga tambahnya, kami perlu cek dulu tipe, spek, kondisi, dan kelengkapan MacBook kakak.
Boleh kirim foto unit + tipe/seri MacBook-nya, nanti kami bantu cek estimasi harga tukar tambahnya ya kak 🙏😊

Q: Bisa jual macbook ga kak?
A: Bisa kak 😊 Kami juga menerima pembelian MacBook dari customer ya kak.
Boleh kirim tipe/seri, spek, battery health, cycle count, dan foto kondisi MacBook-nya. Nanti kami bantu cek dan estimasikan harga beli terbaiknya ya kak 🙏
Kalau sudah cocok, prosesnya bisa langsung dilanjutkan di toko 😊

Q: Kenapa harga di shopee/tokped lebih mahal ka?
A: Karena harga di Shopee/Tokopedia sudah menyesuaikan dengan biaya dan fee marketplace ya kak 😊 Jadi harganya bisa sedikit berbeda dengan harga langsung di toko.
Kalau kakak mau mendapatkan harga terbaik, bisa langsung transaksi melalui toko kami 😊
Boleh kirim tipe MacBook yang kakak incar, nanti kami bantu cekkan harga terbaiknya ya kak 🙏

Q: Apakah pengirimannya ada asuransinya kak?
A: Untuk asuransi pengiriman bisa kak 😊, namun biaya asuransinya menjadi tanggungan customer ya kak.
Kami dari toko akan bantu packing unit seaman mungkin sebelum dikirim. Untuk pengiriman luar kota, kami juga sarankan menggunakan asuransi agar lebih aman selama proses pengiriman 🙏
Kalau kakak info kota tujuannya, nanti kami bantu cekkan opsi pengiriman dan estimasi biayanya ya kak.

Q: Kalo semisal barang hilang dalam proses pengiriman gimana kak?
A: Untuk keamanan pengiriman, kami sangat menyarankan menggunakan asuransi pengiriman ya kak 😊
Kalau sampai terjadi kendala seperti barang hilang atau kerusakan selama proses pengiriman, proses klaim bisa dilakukan melalui asuransi sesuai dengan ketentuan yang berlaku.
Biaya asuransinya menjadi tanggungan customer, sedangkan dari kami unit akan kami packing seaman mungkin sebelum dikirim 🙏

Q: Human error itu apa aja kak?
A: Human error yang dimaksud adalah kerusakan yang disebabkan oleh kesalahan penggunaan dari customer ya kak 😊
Contohnya seperti jatuh/terbentur, terkena cairan, layar pecah, kerusakan akibat dibongkar pihak lain, atau penggunaan yang menyebabkan kerusakan fisik pada unit.
Tapi kalau ada kendala yang bukan disebabkan oleh human error, boleh langsung hubungi kami ya kak. Nanti kami bantu cek terlebih dahulu sesuai dengan ketentuan garansi 🙏😊

Q: Jam operasional kak?
A: Kami buka setiap hari ya kak 😊
Jam operasional: 10.00 – 20.00 WIB
Kakak bisa datang kapan saja selama jam operasional. Kalau mau cek unit tertentu, boleh info dulu tipe MacBook yang dicari, nanti kami bantu siapkan ya kak 🙏😊
