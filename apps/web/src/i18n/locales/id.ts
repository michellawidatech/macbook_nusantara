/**
 * Indonesian.
 *
 * Two kinds of key, as `catalogue.ts` explains: English source strings (what
 * the navigation and the page titles use) and dotted namespaced keys (what the
 * components carried over from xinchuan use). Grouped here by where the copy
 * comes from, so the block that needs editing is the one you can find.
 *
 * Keycaps are deliberately absent — `Ctrl`, `⌘`, `Esc`, `Tab`, `Enter` are
 * printed on the keyboard, so `FillGuideModal` passes them as plain strings and
 * never through `t()`. See its docblock.
 */
export const id: Record<string, string> = {
  // ── Navigation ────────────────────────────────────────────────────────────
  // Also every page title: `PageContainer` runs its `title` through `t()`, and
  // fourteen of them are byte-identical to a label here.
  //
  // Rewritten for the 2026-08-26 IA. Labels the sidebar no longer shows are
  // kept below under "Retired labels" — a page body or a redirect still uses
  // several of them, and deleting a key only moves the English back onto the
  // screen.
  Stock: "Stok",
  "Inbound & QC": "Barang Masuk & QC",
  // The owner's own word for the till. "Transaksi Baru" is what the shop says;
  // "Kasir" named the person rather than the act.
  "New Transaction": "Transaksi Baru",
  // The merged screen. "Inventaris" over "Persediaan": the accounting word is
  // the one a bookkeeper uses, and this screen is read by whoever is standing
  // at the counter.
  "Inventory & Stock Movement": "Inventaris & Pergerakan Stok",
  "Stock Opname": "Stok Opname",
  // The owner's own term for this screen in the original IA.
  "S/N Tracking": "Riwayat Serial",
  // Singular, like Return and Customer beside it — a section is the subject,
  // not the list.
  Reservation: "Reservasi",
  Return: "Retur",
  Product: "Produk",
  // "Master" is the word the shop already uses for the catalogue itself, so it
  // stays rather than becoming "Induk", which would read as a different screen.
  "Master Product": "Master Produk",
  Discount: "Diskon",
  "Financial & Report": "Keuangan & Laporan",
  "Transaction History": "Riwayat Transaksi",
  "Income & Expense": "Pemasukan & Pengeluaran",
  Chatbot: "Chatbot",
  Customer: "Pelanggan",
  Settings: "Pengaturan",

  // ── Wizard step titles and channel names ──────────────────────────────────
  // Module-level constants in StockOutPage and InboundFormPage, so their
  // English IS the key and `t()` runs at render — the same arrangement the nav
  // labels use. `catalogue.ts` explains why.
  "Sales detail": "Detail penjualan",
  Payment: "Pembayaran",
  "Order & payment": "Order & pembayaran",
  Review: "Tinjau",
  // Shopee, Instagram and WhatsApp are absent on purpose: brand names, so
  // falling through to the English default is the correct output.
  "Offline (store)": "Offline (toko)",
  // OpnameSessionPage's KIND_TAG — what a scanned serial turned out to be.
  "Expected here": "Seharusnya di sini",
  "Belongs elsewhere": "Milik gudang lain",
  "Not in system": "Tidak ada di sistem",
  // Batch adjustment modal — its title and its confirm button.
  "stock.stockInTitle": "Stok masuk — pindahkan atau bawa unit ke gudang",
  "stock.stockOutWriteOffTitle": "Stok keluar — hapusbukukan unit",
  "stock.logAdjustments": "Catat penyesuaian",
  "stock.logOneAdjustment": "Catat 1 penyesuaian",
  // Indonesian does not pluralise a counted noun, so both English forms land
  // on one phrase here.
  "stock.logNAdjustments": "Catat {{count}} penyesuaian",
  "pos.backToStep": "Kembali ke {{step}}",
  "pos.goToStep": "Lanjut ke {{step}}",

  // ── Retired labels ────────────────────────────────────────────────────────
  // No longer in the sidebar, still on screens. A page heading, a tab, a
  // redirect target or a sentence of body copy reaches each of these.
  Inventory: "Inventaris",
  "Stock Movement": "Pergerakan Stok",
  "Point of Sale": "Kasir",
  Inbound: "Barang Masuk",
  // Kept in English: Indonesian phone and laptop shops say "PO" or "Purchase
  // Order" almost universally. "Pesanan Pembelian" is textbook-correct and
  // nobody says it.
  "Purchase Order": "Purchase Order",
  "Stock In (QC)": "Stok Masuk (QC)",
  "Stock Out": "Stok Keluar",
  "Stock Adjustment": "Penyesuaian Stok",
  "From Customer": "Dari Pelanggan",
  "To Supplier": "Ke Supplier",
  "Add Discount": "Tambah Diskon",
  "Manage Discounts": "Kelola Diskon",
  Finance: "Keuangan",
  // Not "Biaya", which is "costs" — this screen is a log of money going out.
  Expenses: "Pengeluaran",
  Cashflow: "Arus Kas",
  "Chat Inbox": "Pesan Masuk",
  Knowledge: "Basis Pengetahuan",

  // ── Page titles that are not also nav labels ──────────────────────────────
  "Add expense": "Tambah Pengeluaran",
  "Chatbot Knowledge": "Basis Pengetahuan",
  Customers: "Pelanggan",
  "New inbound order": "Order Barang Masuk Baru",
  "New return": "Retur Baru",
  "New supplier return": "Retur Supplier Baru",
  "Inbound order": "Order Barang Masuk",
  Products: "Produk",
  "Return from Customer": "Retur dari Pelanggan",
  "Return to Supplier": "Retur ke Supplier",
  "The discount": "Diskon",

  // ── Shell ─────────────────────────────────────────────────────────────────
  "app.name": "Macbook Nusantara",
  "nav.open": "Buka navigasi",
  "account.menu": "Menu akun",
  // Unqualified "Bahasa" means "language" in Indonesian.
  "account.language": "Bahasa",
  "account.languageActive": "Aktif",
  "account.signOut": "Keluar",

  // ── Login ─────────────────────────────────────────────────────────────────
  // The app's own sign-in since 2026-09-18 (Auth0 retired).
  "login.subtitle": "Masuk dengan akun staf Anda.",
  "login.signIn": "Masuk",
  "login.username": "Nama pengguna",
  "login.usernameRequired": "Ketik nama pengguna Anda.",
  "login.password": "Kata sandi",
  "login.passwordRequired": "Ketik kata sandi Anda.",
  "login.wrong": "Nama pengguna atau kata sandi salah.",
  "login.tooMany":
    "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.",
  "login.offline":
    "Server tidak bisa dihubungi. Periksa koneksi lalu coba lagi.",
  "login.forgot":
    "Lupa kata sandi? Minta pemilik meresetnya dari Pengaturan → Akun staf.",

  // ── Password ──────────────────────────────────────────────────────────────
  // The forced first change and Settings → My account share one form.
  "password.chooseTitle": "Pilih kata sandi Anda sendiri",
  "password.chooseIntro":
    "Halo {{name}}. Anda masuk dengan kata sandi yang dibuat orang lain, jadi mungkin ada orang lain yang tahu. Pilih kata sandi Anda sendiri sebelum melanjutkan.",
  "password.saveAndContinue": "Simpan dan lanjutkan",
  "password.save": "Simpan kata sandi baru",
  "password.current": "Kata sandi saat ini",
  "password.currentRequired": "Ketik kata sandi yang Anda pakai untuk masuk.",
  "password.currentWrong": "Itu bukan kata sandi Anda saat ini.",
  "password.new": "Kata sandi baru",
  "password.newRequired": "Pilih kata sandi baru.",
  "password.hint": "Minimal {{n}} karakter. Kalimat pendek juga bagus.",
  "password.confirm": "Ketik ulang kata sandi baru",
  "password.confirmRequired": "Ketik sekali lagi untuk memastikan.",
  "password.mismatch": "Kedua kata sandi baru tidak sama.",
  "password.tooShort": "Minimal {{n}} karakter.",
  "password.tooLong": "Terlalu panjang untuk sebuah kata sandi.",
  "password.initial":
    "Itu kata sandi awal toko. Pilih kata sandi Anda sendiri.",
  "password.hasUsername":
    "Jangan masukkan nama pengguna Anda — itu tebakan pertama siapa pun.",
  "password.tooCommon":
    "Terlalu mudah ditebak. Beberapa kata digabung lebih mudah diingat dan lebih sulit ditebak.",

  // ── Chatbot: hand-overs and the answer sheet (2026-09-18) ────────────────
  "chat.draftFromAnswers": "Draf siap, dari jawaban yang disetujui toko.",
  "chat.draftReady": "Draf siap.",
  "chat.draftWouldHandOver":
    "Bot akan menyerahkan chat ini ke staf ({{topic}}). Kalimat penahannya ada di kotak — jawab sendiri.",
  "chat.handledDone":
    "Ditandai selesai. Bot akan membalas pesan pelanggan ini berikutnya.",
  "chat.handledFailed": "Gagal menandai selesai.",
  "chat.markHandled": "Tandai selesai",
  "chat.needsReply": "Perlu dibalas",
  "chat.needsReplyTopic": "Perlu dibalas · {{topic}}",
  "chat.wait.botFailed": "Bot gagal membalas — diteruskan ke Anda",
  "chat.wait.botOff": "Perlu dibalas · AI dimatikan untuk chat ini",
  "chat.wait.staffActive":
    "Bot berhenti sejenak — {{name}} membalas {{minutes}} menit lalu",
  "chat.wait.staffActiveNoName":
    "Bot berhenti sejenak — staf membalas {{minutes}} menit lalu",
  "chat.wait.botLate":
    "Bot belum membalas {{minutes}} menit — balas sendiri atau cek worker",
  "handoff.stock": "Stok",
  "handoff.price": "Harga",
  "handoff.negotiation": "Nego",
  "handoff.unitDetails": "Detail unit",
  "handoff.recommendation": "Rekomendasi",
  "handoff.reservation": "Booking",
  "handoff.orderPayment": "Pesanan atau pembayaran",
  "handoff.tradeIn": "Tukar tambah",
  "handoff.sellToShop": "Jual ke toko",
  "handoff.shippingQuote": "Ongkos kirim",
  "handoff.warrantyClaim": "Klaim garansi",
  "handoff.complaint": "Komplain",
  "handoff.media": "Foto atau file",
  "handoff.human": "Minta staf",
  "handoff.other": "Di luar jawaban",
  "knowledge.download": "Unduh .xlsx",
  "knowledge.import": "Impor dari file",
  "knowledge.importTitle": "Impor jawaban dari file",
  "knowledge.importDrop": "Letakkan file .xlsx atau .csv di sini",
  "knowledge.importColumns":
    "Kolom A adalah pertanyaan dan kolom B jawabannya. Baris pertama yang berisi “Question” dan “Answer” dilewati.",
  "knowledge.importUnreadable":
    "File ini tidak bisa dibaca. Simpan sebagai .xlsx atau .csv lalu coba lagi.",
  "knowledge.importFailed": "File tidak bisa dibuka.",
  "knowledge.importEmpty":
    "Tidak ada pertanyaan yang punya jawaban di file ini.",
  "knowledge.importUnanswered":
    "{{n}} pertanyaan tidak punya jawaban dan tidak akan diimpor:",
  "knowledge.importRepeated":
    "{{n}} pertanyaan muncul dua kali di file; hanya yang pertama dibaca:",
  "knowledge.importFoundSheet":
    "{{n}} jawaban di file — {{added}} baru dan {{changed}} berubah dipilih",
  "knowledge.importNew": "baru",
  "knowledge.importChanged": "jawaban berubah",
  "knowledge.importSame": "tidak berubah",
  "knowledge.importOk": "Impor {{n}}",
  "knowledge.importedSheet":
    "{{added}} ditambahkan, {{changed}} diperbarui — bot memakainya mulai balasan berikutnya.",

  // ── Staff accounts (Settings, owner only) ─────────────────────────────────
  "staff.title": "Akun staf",
  "staff.intro":
    "Siapa saja yang bisa masuk. Akun baru, atau akun yang Anda reset, memakai kata sandi awal toko dan wajib memilih kata sandi sendiri saat pertama masuk — Anda tidak perlu tahu kata sandi siapa pun.",
  "staff.add": "Tambah akun",
  "staff.addTitle": "Tambah akun",
  "staff.addOk": "Tambah akun",
  "staff.addFooter":
    "Akun ini mulai dengan kata sandi awal toko ({{password}}) dan memilih kata sandi sendiri saat pertama masuk.",
  "staff.name": "Nama",
  "staff.rename": "Ganti nama",
  "staff.username": "Nama pengguna",
  "staff.usernameHint":
    "Yang diketik saat masuk: huruf kecil dan angka, tanpa spasi.",
  "staff.usernameRequired": "Pilih nama pengguna.",
  "staff.usernameShape":
    "2–32 karakter: huruf, angka, titik, tanda hubung, atau garis bawah.",
  "staff.usernameTaken": "Nama pengguna itu sudah dipakai.",
  "staff.role": "Peran",
  "staff.owner": "Pemilik",
  "staff.staff": "Staf",
  "staff.canApprove": "Boleh menyetujui",
  "staff.canViewFinance": "Keuangan",
  "staff.canViewFinanceHint":
    "Boleh membuka Keuangan & Laporan: transaksi, pembayaran, piutang, utang, pemasukan dan pengeluaran.",
  "finance.lockedTitle": "Keuangan & Laporan dibatasi",
  "finance.lockedBody":
    "Minta pemilik menyalakan akses keuangan untuk akun Anda di Pengaturan → Akun staf.",
  "staff.ownerApproves": "Pemilik selalu bisa menyetujui.",
  "staff.canApproveHint":
    "Menyetujui harga di bawah modal dan keputusan lain yang perlu orang kedua.",
  "staff.status": "Status",
  "staff.statusActive": "Aktif",
  "staff.statusOff": "Nonaktif",
  "staff.statusNoPassword": "Belum ada kata sandi",
  "staff.statusWaiting": "Menunggu masuk pertama",
  "staff.statusWaitingHint":
    "Masih memakai kata sandi awal toko. Akan diganti saat pertama kali masuk.",
  "staff.lastSignIn": "Terakhir masuk",
  "staff.never": "Belum pernah",
  "staff.actions": "Aksi",
  "staff.you": "Anda — ganti kata sandi sendiri di Akun saya",
  "staff.reset": "Reset kata sandi",
  "staff.resetTitle": "Reset kata sandi {{name}}?",
  "staff.resetBody":
    "Mereka dikeluarkan dari semua perangkat, lalu masuk berikutnya dengan kata sandi awal toko — dan wajib memilih kata sandi baru.",
  "staff.resetOk": "Reset kata sandi",
  "staff.toldTitle": "Beri tahu {{name}} cara masuk",
  "staff.toldBody":
    "Nama pengguna {{username}}, kata sandi {{password}}. Begitu masuk, mereka diminta memilih kata sandi sendiri, dan kata sandi di atas tidak berlaku lagi.",
  "staff.on": "Aktif",
  "staff.off": "Mati",
  "staff.activeLabel": "Boleh masuk",
  "staff.deactivateTitle": "Nonaktifkan {{name}}?",
  "staff.deactivateBody":
    "Mereka langsung dikeluarkan dan tidak bisa masuk lagi sampai akunnya diaktifkan kembali. Penjualan dan pergerakan stok mereka tetap seperti semula.",
  "staff.deactivateOk": "Nonaktifkan",
  "staff.failed": "Belum tersimpan. Coba lagi.",
  "settings.tabActivity": "Aktivitas",
  "activity.created": "Ditambahkan",
  "activity.updated": "Diubah",
  "activity.deleted": "Dihapus",
  "activity.archived": "Diarsipkan",
  "activity.login": "Masuk",
  "activity.loginFailed": "Gagal masuk",
  "activity.exported": "Diekspor",
  "activity.e.orders": "Penjualan",
  "activity.e.pos": "Faktur pembelian",
  "activity.e.units": "Unit",
  "activity.e.events": "Riwayat unit",
  "activity.e.stockMoves": "Pergerakan stok",
  "activity.e.unitNotes": "Catatan / foto QC",
  "activity.e.stockIns": "Keputusan QC",
  "activity.e.adjustments": "Penyesuaian stok",
  "activity.e.skus": "Varian produk",
  "activity.e.models": "Produk",
  "activity.e.categories": "Kategori",
  "activity.e.customers": "Pelanggan",
  "activity.e.suppliers": "Supplier",
  "activity.e.deposits": "Deposit supplier",
  "activity.e.reservations": "Reservasi",
  "activity.e.returns": "Retur",
  "activity.e.opnames": "Stock opname",
  "activity.e.services": "Servis",
  "activity.e.settlements": "Pencairan marketplace",
  "activity.e.expenses": "Pengeluaran",
  "activity.e.incomes": "Pemasukan",
  "activity.e.paymentLog": "Koreksi pembayaran",
  "activity.e.settlementLog": "Koreksi pencairan",
  "activity.e.discounts": "Diskon",
  "activity.e.warehouses": "Gudang",
  "activity.e.racks": "Rak",
  "activity.e.reasons": "Alasan",
  "activity.e.qcDescriptions": "Frasa QC",
  "activity.e.paymentMethods": "Metode pembayaran",
  "activity.e.channels": "Kanal",
  "activity.e.salesmen": "Sales",
  "activity.e.grading": "Grading",
  "activity.e.knowledge": "Jawaban chatbot",
  "activity.e.chats": "Chat",
  "activity.e.chatbot": "Pengaturan chatbot",
  "activity.e.settings": "Pengaturan",
  "activity.e.appleDb": "Impor AppleDB",
  "activity.e.myWarehouse": "Gudang sendiri",
  "activity.e.staff": "Akun staf",
  "activity.e.whatsapp": "Koneksi WhatsApp",
  "activity.e.outbox": "Pesan WhatsApp",
  "activity.e.waThread": "Chat WhatsApp",
  "activity.e.agentEvaluation": "Penilaian chatbot",
  "activity.since":
    "Setiap perubahan tercatat mulai rilis 22 Oktober 2026. Riwayat masuk dan perubahan akun staf tercatat lebih lama.",
  "activity.search": "Cari serial, kode atau id",
  "activity.person": "Orang",
  "activity.action": "Aksi",
  "activity.what": "Apa",
  "activity.loadFailed": "Aktivitas tidak dapat dimuat.",
  "activity.when": "Kapan",
  "activity.details": "Rincian",
  "settings.tabStaffAccounts": "Akun staf",
  "settings.changePassword": "Ganti kata sandi",
  "settings.passwordChanged":
    "Kata sandi diganti. Semua perangkat lain yang masuk dengan akun Anda sudah dikeluarkan.",

  // ── Common ────────────────────────────────────────────────────────────────
  "common.save": "Simpan",
  "common.delete": "Hapus",
  "common.cancel": "Batal",
  "common.back": "Kembali",
  "common.next": "Selanjutnya",
  "common.done": "Selesai",
  "common.genericError": "Ada yang salah. Coba lagi.",
  // Shown when a map in `i18n/enumLabels.ts` meets an enum member the UI has
  // not been taught yet. Deliberately not "None": the value exists, we just do
  // not have a name for it.
  "common.unknownValue": "Tidak dikenal",
  // An empty cell whose value is a word — `fmtNone` (owner 2026-09-21: no
  // dashes; 0 for a number, "None" for the rest).
  "common.none": "Tidak ada",

  // ── Domain enums ──────────────────────────────────────────────────────────
  // Keyed by the English label in `i18n/enumLabels.ts`, per the English-source-
  // string shape in `catalogue.ts`. The database enums are themselves
  // Indonesian (TERSEDIA, TERJUAL), so several of these read as the enum
  // properly cased — which is the point: staff see a word, never a token.
  //
  // Shopee, Instagram and WhatsApp are absent on purpose. They are brand names,
  // so `t()` falling through to the English default is the correct output.

  // Unit.status
  "Pending QC": "Menunggu QC",
  "In stock": "Tersedia",
  Reserved: "Direservasi",
  Sold: "Terjual",
  "Returned to supplier": "Retur ke supplier",
  "On service": "Servis",
  Lost: "Hilang",

  // InboundStage — `lib/inbound.ts`. A module-level map, so the call site is
  // `t(INBOUND_STAGE_LABEL[stage])` with no English literal beside it; these
  // are the keys that need to exist for the Inbound list's Stage column and
  // the QC grid's to come out Indonesian.
  Pending: "Menunggu",
  Arrived: "Sudah datang",
  "In QC": "Di QC",
  "In inventory": "Masuk inventaris",
  // The order was filed away by a person — see `Po.closedAt`.
  Closed: "Ditutup",

  // PoPaymentFor — what a supplier payment settles. "Ongkir" over "Pengiriman":
  // it is the word on the shop's own transfers, and the forwarder's invoice.
  Shipping: "Ongkir",
  Tax: "Pajak",

  // UnitEvent.type — the lifecycle timeline
  "Arrived on an invoice": "Tiba dari faktur",
  "Arrival undone": "Kedatangan dibatalkan",
  "Taken in on a trade-in": "Masuk dari tukar tambah",
  "Stock count difference": "Selisih stock opname",
  "Pending to QC": "Menunggu QC",
  "QC passed — entered inventory": "QC lolos — masuk stok",
  Note: "Catatan",
  Moved: "Dipindah",
  "Reservation cancelled": "Reservasi dibatalkan",
  "Returned by customer": "Retur dari pelanggan",
  "Missing at opname": "Hilang saat opname",
  "Found at opname": "Ditemukan saat opname",
  Adjustment: "Penyesuaian",
  "QC reopened": "QC dibuka lagi",

  // Reservation.status
  "On hold": "Ditahan",
  Bought: "Dibeli",
  Cancelled: "Dibatalkan",

  // Order.source, as a noun
  "In store": "Di toko",

  // ── DeleteAction ──────────────────────────────────────────────────────────
  "deleteAction.aria": "Hapus {{entity}}",
  "deleteAction.tooltip": "Hapus {{entity}}",
  "deleteAction.confirmTitle": "Hapus {{entity}}?",
  "deleteAction.confirmDetail": "Tindakan ini tidak bisa dibatalkan.",

  // ── EntitySelect ──────────────────────────────────────────────────────────
  "entitySelect.noMatch": "Tidak ada yang cocok",

  // ── ProTable / DataTable ──────────────────────────────────────────────────
  "proTable.search": "Cari",
  "proTable.filter": "Filter",
  "proTable.selected": "{{count}} dipilih",
  "proTable.clearSelection": "Batal pilih",
  "dataTable.allRows": "{{count}} baris — sudah semua",

  // ── Suppliers — the account, not the address book (owner ask 2026-09-08) ─
  // "Supplier" is the word the shop uses in Indonesian too. "Deposit" likewise
  // — it is what appears on the transfer slip. What needed translating is the
  // vocabulary around them: "belum dialokasikan" for money paid in advance and
  // not yet put against an invoice, which is the whole point of the screen.
  Supplier: "Supplier",
  "supplier.title": "Supplier",
  "supplier.accounts": "Rekening supplier",
  "supplier.name": "Supplier",
  "supplier.owedTotal": "Utang ke supplier",
  "supplier.owedHint":
    "Invoice yang belum lunas dan utang lama, dikurangi deposit yang sudah ada.",
  "supplier.onDeposit": "Deposit belum dialokasikan",
  "supplier.onDepositHint":
    "Sudah dibayar di muka dan belum ditempelkan ke invoice mana pun.",
  "supplier.onDepositCol": "Deposit",
  "supplier.openInvoices": "Invoice terbuka",
  "supplier.invoiced": "Ditagih",
  "supplier.paid": "Dibayar",
  "supplier.netOwed": "Utang sekarang",
  "supplier.inCredit": "Lebih bayar {{amount}}",
  "supplier.oldestSince": "tertua sejak {{date}}",
  "supplier.oldDebt": "Utang lama",
  "supplier.addOldDebt": "Isi",
  "supplier.invoices": "Invoice",
  "supplier.invoice": "Invoice",
  "supplier.noInvoices": "Tidak ada invoice terbuka.",
  "supplier.date": "Tanggal",
  "supplier.total": "Total",
  "supplier.outstanding": "Sisa",
  "supplier.settledTag": "Lunas",
  "supplier.deposits": "Deposit",
  "supplier.noDeposits": "Belum ada pembayaran di muka.",
  "supplier.addDeposit": "Catat deposit",
  "supplier.addDepositAria": "Catat deposit untuk {{name}}",
  "supplier.deleteBlocked":
    "Supplier ini punya transaksi dan tidak bisa dihapus.",
  "supplier.when": "Tanggal",
  "supplier.note": "Catatan",
  "supplier.notePlaceholder": "Opsional",
  "supplier.amount": "Jumlah",
  "supplier.method": "Cara",
  "supplier.left": "Belum dialokasikan",
  "supplier.allSpent": "Habis terpakai",
  "supplier.allocateHint": "Tempelkan ke invoice",
  "supplier.allocateAria": "Alokasikan deposit ini",
  "supplier.spreadHint": "Sebar ke invoice tertua",
  "supplier.spreadAria": "Sebar deposit ini ke invoice tertua",
  "supplier.depositTitle": "Deposit ke {{name}}",
  "supplier.depositOk": "Catat",
  "supplier.depositHint":
    "Uang yang dibayar di muka. Tersimpan atas nama supplier sampai diputuskan invoice mana yang dilunasi.",
  "supplier.depositSaved": "{{amount}} dicatat untuk {{name}}.",
  "supplier.allocateTitle": "Tempelkan deposit ini ke invoice",
  "supplier.allocateOk": "Alokasikan",
  "supplier.allocateHave":
    "{{amount}} belum dialokasikan, dibayar {{when}} lewat {{method}}.",
  "supplier.stillOwed": "masih kurang",
  "supplier.allocated": "{{amount}} ditempelkan ke {{code}}.",
  "supplier.spread": "Disebar ke {{n}} invoice.",
  "supplier.nothingToAllocate": "Tidak ada sisa tagihan untuk ditempeli.",
  // Alokasi ke DAFTAR invoice, dan menambah supplier di sini (2026-09-09).
  "supplier.allocateNothing": "Isi jumlahnya di setidaknya satu invoice.",
  "supplier.allocateTooMuch": "Melebihi sisa deposit ini.",
  "supplier.allocatedAcross":
    "{{amount}} ditempelkan ke {{n}} invoice untuk {{name}}.",
  "supplier.allocating": "Dialokasikan",
  "supplier.ofRemaining": "{{put}} dari {{left}}",
  "supplier.putAgainst": "Ditempelkan",
  "supplier.putAgainstAria": "Jumlah yang ditempelkan ke {{code}}",
  "supplier.fillRow": "Isi sisa tagihannya",
  "supplier.fillRowAria": "Isi sisa tagihan {{code}}",
  "supplier.nothingOutstanding": "Tidak ada sisa tagihan untuk ditempeli.",
  "supplier.forInvoice": "Untuk invoice tertentu?",
  "supplier.forInvoiceHint":
    "Kosongkan kalau belum diputuskan — uangnya tersimpan atas nama supplier sampai ada keputusan.",
  "supplier.notDecidedYet": "Belum diputuskan",
  "supplier.depositSavedFor":
    "{{amount}} dicatat untuk {{name}}, {{put}} di antaranya untuk {{code}}.",
  "supplier.noInvoiceNo": "Tanpa invoice",
  "supplier.noInvoiceNoYet": "Nomor belum diisi",
  // Menambah supplier beserta utang lamanya.
  "supplier.addSupplier": "Tambah supplier",
  "supplier.addTitle": "Tambah supplier",
  "supplier.addOk": "Tambah supplier",
  "supplier.added": "{{name}} ditambahkan.",
  "supplier.nameLabel": "Nama",
  "supplier.namePlaceholder": "CV Apel Segar",
  "supplier.nameTaken": "Supplier dengan nama itu sudah ada.",
  "supplier.phone": "Telepon",
  "supplier.address": "Alamat",
  "supplier.oldDebtLabel": "Utang kita yang sudah ada",
  "supplier.oldDebtHint":
    "Tagihan yang belum dibayar dari sebelum aplikasi ini. Tidak ada invoice di sini yang mewakilinya, jadi dicatat sekali dan ditambahkan ke total tagihan.",
  // Riwayat transaksi satu supplier — bukan cuma depositnya (2026-09-09).
  "supplier.history": "Riwayat transaksi",
  "supplier.noHistory": "Belum ada transaksi di rekening ini.",
  "supplier.what": "Jenis",
  "supplier.reference": "Referensi",
  "supplier.undated": "Tanpa tanggal",
  "supplier.entryInvoice": "Invoice",
  "supplier.entryPayment": "Pembayaran",
  "supplier.entryDeposit": "Deposit",
  "supplier.entryAllocation": "Deposit dipakai",
  "supplier.entryOpening": "Utang lama",
  "supplier.openingTitle": "Utang lama ke {{name}}",
  "supplier.openingOk": "Simpan",
  "supplier.openingSaved": "Saldo awal disimpan.",
  "supplier.openingHint":
    "Tagihan yang belum dibayar dari sebelum aplikasi ini. Tidak ada invoice di sini yang mewakilinya, jadi dicatat sekali dan ditambahkan ke total tagihan.",

  // ── Service bench — machines away at a repairer (owner ask 2026-09-08) ─
  // "Servis" is the shop's own word and the one on the warehouse itself
  // ("Meja Servis"). The screen answers one question every morning: how long
  // has that been gone.
  Service: "Servis",
  "service.title": "Meja servis",
  "service.away": "Unit di luar",
  "service.spent": "Biaya servis",
  "service.spentHint":
    "Ditambahkan ke modal tiap unit, supaya marginnya jujur.",
  // Satu tabel sejak 2026-09-25; kolom Grade, Lama dan Modal sekarang ikut
  // hilang bersama pembagian Ditunggu / Sedang diservis.
  "service.atService": "Sedang di servis",
  "service.quoted": "Perkiraan",
  "service.nothingAway": "Tidak ada unit yang sedang diservis.",
  "service.serial": "Serial",
  "service.problem": "Keluhan",
  "service.sentFrom": "Dikirim dari",
  "service.unknownProduct": "Produk tidak dikenal",
  // Dua tombol berlabel sejak 2026-09-25; tidak ada lagi konfirmasi tiba.
  "service.charge": "Biaya",
  "service.backInStockShort": "Kembali ke stok",
  "service.addFeeAria": "Tambah biaya untuk {{serial}}",
  "service.addChargeTo": "Biaya untuk {{serial}}",
  "service.feeKind": "Jenis biaya",
  "service.feeLabel": "Untuk apa",
  "service.feeLabelPlaceholder": "Ganti keyboard, ongkir ke Bandung…",
  "service.feeAmount": "Jumlah",
  "service.feeWhen": "Tanggal",
  "service.record": "Catat",
  "service.feeAdded": "{{amount}} dicatat untuk {{serial}}.",
  // Mengoreksi biaya yang sudah dicatat (2026-09-09).
  "service.editFee": "Ubah biaya ini",
  "service.editFeeAria": "Ubah biaya {{amount}} pada {{serial}}",
  "service.editChargeOn": "Ubah biaya pada {{serial}}",
  "service.editChargeHint":
    "Sebelumnya {{amount}}. Angka lamanya tetap tercatat di riwayat unit.",
  "service.saveCharge": "Simpan perubahan",
  "service.feeEdited": "Biaya {{serial}} sekarang {{amount}}.",
  "service.sendBackAria": "Kembalikan {{serial}} ke stok",
  "service.backTitle": "Kembalikan {{serial}} ke stok",
  "service.backOk": "Kembali ke stok",
  "service.backTo": "Ke gudang mana",
  "service.transferFee": "Biaya memindahkannya",
  "service.transferFeeHint":
    "Ongkir baliknya, kalau ada. Ikut dihitung sebagai biaya servis unit ini.",
  "service.transferLabel": "Pindah keluar",
  "service.backNote": "Apa yang dikerjakan",
  "service.backInStock": "{{serial}} sudah kembali ke stok.",
  // Kirim ke servis, dibayar atau belum, dan hapus biaya / kunjungan
  // (2026-10-26).
  "service.paidBank": "Bank",
  "service.paidOtherBank": "Bank lain",
  "service.paidCash": "Tunai",
  "service.notPaidYet": "Belum dibayar",
  "service.quoteLabel": "Perkiraan saat dikirim",
  "service.sendRefused":
    "{{serial}} tidak bisa dikirim ke servis lagi — unitnya tidak sedang di QC atau di rak.",
  "service.sentStays": "{{serial}} diservis di tempatnya sekarang.",
  "service.sendTitle": "Kirim {{serial}} ke servis",
  "service.sendBody":
    "{{serial}} berhenti bisa dijual sekarang. Biayanya ikut dihitung ke modal unit ini, sudah dibayar atau belum.",
  "service.whereServiced": "Diservis di mana?",
  "service.courierPaidWith": "Ongkir dibayar dengan",
  "service.repairQuote": "Perkiraan biaya servis",
  "service.quotePaidWith": "Servis dibayar dengan",
  "service.heldCannotGo":
    "Sedang direservasi untuk pelanggan — lepaskan reservasinya dulu.",
  "service.alreadyAway": "Sudah di servis.",
  "service.notInStock": "Tidak ada di stok.",
  "service.markedPaid": "{{amount}} untuk {{serial}} sudah dibayar.",
  "service.chargeInClosedBook":
    "Biaya ini ada di buku yang sudah ditutup — buka bukunya dulu untuk menghapusnya.",
  "service.feeDeleted": "Biaya {{amount}} untuk {{serial}} sudah dihapus.",
  "service.visitMovedOn":
    "{{serial}} sudah berpindah sejak kunjungan ini — riwayat sesudahnya tidak akan masuk akal lagi.",
  "service.visitInClosedBook":
    "Kunjungan ini ada di buku yang sudah ditutup — buka bukunya dulu untuk menghapusnya.",
  "service.visitDeletedNoRow":
    "Kunjungannya sudah dihapus, tapi baris riwayat yang mengirim {{serial}} tidak ditemukan — hapus dari riwayat unitnya kalau memang harus hilang.",
  "service.visitDeleted":
    "Kunjungannya sudah dihapus dan {{serial}} kembali seperti semula.",
  "service.payment": "Pembayaran",
  "service.paidWithTag": "Dibayar · {{method}}",
  "service.paidTag": "Dibayar",
  "service.notPaidTag": "Belum dibayar",
  "service.markPaidAria":
    "Tandai biaya {{amount}} untuk {{serial}} sudah dibayar",
  "service.markPaid": "Tandai dibayar",
  "service.markPaidTitle": "Tandai {{amount}} untuk {{serial}} sudah dibayar",
  "service.paidOn": "Dibayar tanggal",
  "service.paidWith": "Dibayar dengan",
  "service.paidElsewhere":
    "Sudah dibayar. Mengubah jumlahnya ikut mengubah pembayarannya.",
  "service.deleteFeeTitle": "Hapus biaya ini?",
  "service.deleteFeeBody":
    "Biaya ini keluar dari modal unit dan dari riwayatnya, begitu juga pembayaran yang tercatat untuknya.",
  "service.deleteFeeOk": "Hapus",
  "service.deleteFee": "Hapus biaya ini",
  "service.deleteFeeAria": "Hapus biaya {{amount}} untuk {{serial}}",
  "service.deleteVisit": "Hapus kunjungan ini",
  "service.deleteVisitAria": "Hapus kunjungan servis {{serial}}",
  "service.deleteVisitTitle": "Hapus kunjungan servis {{serial}}?",
  "service.deleteVisitOk": "Hapus kunjungannya",
  "service.deleteVisitBody":
    "Semua biayanya ({{amount}}) dan pembayaran yang tercatat untuknya dihapus, begitu juga baris riwayat yang ditulis kunjungan ini. {{serial}} kembali ke status dan gudang sebelum dikirim.",
  "service.deleteVisitType": "Ketik serialnya untuk konfirmasi.",
  "service.deleteVisitTypeAria": "Serial, untuk konfirmasi",
  "inventory.unitMoreAria": "Lainnya untuk {{serial}}",

  // ── Customer management — what a person still owes (2026-09-08) ──────
  // Two figures kept apart on purpose: "piutang" is this person's debt and
  // "ditahan marketplace" is not. Ringing somebody about the second loses them.
  "customers.owes": "Piutang",
  "customers.pendingWith": "{{amount}} di marketplace",
  "customers.dueOn": "jatuh tempo {{date}}",
  // Mencatat pembayaran pada transaksi tertentu (2026-09-09).
  "customers.recordPayment": "Catat pembayaran",
  "customers.recordPaymentAria": "Catat pembayaran untuk {{code}}",
  "customers.payUnchanged": "Tidak ada yang berubah.",
  "customers.payLogged": "{{n}} perubahan tercatat.",
  "customers.moneySettled": "Lunas",
  "customers.moneyOwed": "Kurang {{amount}}",
  "customers.moneyPending": "{{amount}} di marketplace",

  // ── Pending & Receivables — the piutang screen (owner ask 2026-09-08) ─
  // "Piutang" is the owner's own word and the accounting one, so the page is
  // named that in both languages. The two tables are deliberately different
  // words: money a marketplace holds is "ditahan", money a customer owes is
  // "piutang pelanggan".
  "Pending & Receivables": "Saldo Tertahan & Piutang",
  // The same leaf, renamed in the nav on 2026-09-21.
  "Pending Payment": "Pembayaran Tertunda",
  "Payable & Receivable": "Utang & Piutang",
  // Two leaves since 2026-09-22.
  Receivable: "Piutang",
  Payable: "Utang",
  "piutang.title": "Pembayaran tertunda",
  "piutang.withMarketplaces": "Ditahan marketplace",
  "piutang.withMarketplacesHint":
    "Sudah dibayar pelanggan. Tarik dari masing-masing platform.",
  "piutang.customersOwe": "Piutang pelanggan",
  "piutang.customersOweHint": "Belum dibayar sama sekali. Perlu ditagih.",
  "piutang.marketplaceMoney": "Menunggu di marketplace",
  "piutang.customerDebts": "Piutang pelanggan",
  "piutang.channel": "Kanal",
  "piutang.anyChannel": "Semua kanal",
  "piutang.customer": "Pelanggan",
  "piutang.walkIn": "Pelanggan umum",
  "piutang.when": "Tanggal",
  "piutang.amount": "Jumlah",
  "piutang.overdueOn": "Lewat tempo — {{date}}",
  "piutang.promised": "Dijanjikan {{date}}",
  "piutang.landed": "Diterima",
  "piutang.settled": "{{amount}} dicatat dari {{channel}}.",
  "piutang.noPending": "Semua marketplace sudah mencairkan.",
  "piutang.noDebts": "Tidak ada pelanggan yang berutang.",
  "piutang.amend": "Koreksi pencairan ini",
  "piutang.amended": "Pencairan dikoreksi.",
  // ── The marketplace table, flattened (owner ask 2026-09-20) ──────────
  // One row per marketplace payment: what is waiting on top, what has been
  // withdrawn underneath, and "Terima" on the row that is waiting.
  "piutang.orderNo": "No. pesanan",
  "piutang.noRef": "Tanpa referensi",
  "piutang.searchOrders": "Cari no. pesanan atau referensi",
  "piutang.waiting": "Menunggu",
  "piutang.lessDeductions": "dipotong {{amount}}",
  "piutang.receive": "Tandai pencairan ini sudah masuk",
  "piutang.receiveAria": "Terima pencairan untuk {{code}}",
  "piutang.alreadyReceived": "Pencairan ini sudah pernah dicatat diterima.",
  "piutang.amendSaleAria": "Koreksi pencairan untuk {{code}}",
  // ── The customer table: a call list with the receipt behind it ───────
  "piutang.transactionNo": "No. transaksi",
  "piutang.item": "Barang",
  "piutang.phone": "No. telepon",
  "piutang.noPhone": "Tidak ada di data",
  "piutang.stillOwed": "kurang {{amount}}",
  "piutang.searchDebts": "Cari transaksi, pelanggan, no. telepon atau unit",
  "piutang.seeReceipt": "Lihat struk",
  "piutang.seeReceiptAria": "Struk untuk {{code}}",
  "piutang.openPayments":
    "Riwayat pembayaran — catat, koreksi atau hapus pembayaran",
  "piutang.openPaymentsAria": "Pembayaran pada {{code}}",
  "piutang.payUnchanged": "Tidak ada yang berubah.",
  "piutang.payLogged": "{{n}} perubahan dicatat.",

  // ── SettleModal — recording one marketplace withdrawal ───────────────
  "settle.title": "Terima dari {{channel}}",
  "settle.covering": "{{subject}} · {{gross}}",
  "settle.coveringPlain": "{{gross}} menunggu di {{channel}}.",
  // A deduction is the words off the statement, not a category (2026-09-20).
  "settle.feeLabel": "Potongan",
  "settle.feeLabelFor": "Yang dipotong",
  "settle.feeLabelPlaceholder": "Sesuai nama di rekening koran",
  "settle.feeAmount": "Jumlah",
  "settle.feeAmountFor": "Jumlah potongan",
  "settle.addFee": "Tambah potongan",
  "settle.removeFee": "Hapus potongan ini",
  "settle.noFees": "Tidak ada potongan. Seluruh jumlah masuk.",
  // The received figure follows the deductions until somebody states what the
  // bank actually paid — that figure is the only one anybody can check, so it
  // is the one everything downstream believes.
  "settle.mark": "Tandai sudah masuk",

  // ── PaymentsPanel — a bill paid in parts (owner ask 2026-09-08) ──────
  // The three states are three different facts and the words keep them apart:
  // "Diterima" is money the shop has, "Ditahan marketplace" is money Shopee is
  // sitting on, and "Belum dibayar" is a customer debt. Merging any two of
  // them is exactly the bug this replaces.
  "pay.state": "Status",
  "pay.stateFor": "Status pembayaran ini",
  "pay.settled": "Diterima",
  "pay.pending": "Ditahan marketplace",
  "pay.due": "Belum dibayar pelanggan",
  "pay.method": "Metode",
  "pay.methodFor": "Cara pembayarannya",
  "pay.channelFor": "Marketplace yang menahan",
  "pay.amount": "Jumlah",
  "pay.amountFor": "Jumlah",
  "pay.dueDate": "Jatuh tempo",
  "pay.dueFor": "Kapan dijanjikan",
  "pay.note": "Catatan",
  "pay.noteFor": "Catatan",
  "pay.notePlaceholder": "DP, sisa, …",
  "pay.add": "Tambah pembayaran",
  "pay.remove": "Hapus pembayaran ini",
  "pay.none": "Belum ada pembayaran yang dicatat untuk tagihan ini.",
  "pay.received": "Diterima {{amount}}",
  "pay.pendingAmount": "Ditahan marketplace {{amount}}",
  "pay.owed": "Pelanggan masih kurang {{amount}}",

  // ── PaymentsModal — correcting what was paid, and the log ────────────
  "payEdit.title": "Pembayaran — {{code}}",
  "payEdit.bill": "Tagihannya {{total}}.",
  "payEdit.save": "Simpan koreksi",
  "payEdit.unaccounted": "{{amount}} dari tagihan ini belum ada pembayarannya.",
  "payEdit.unaccountedHint":
    "Itu tidak sama dengan utang yang dijanjikan — tambahkan baris yang menyebut siapa yang berutang dan kapan.",
  "payEdit.why": "Kenapa dikoreksi?",
  "payEdit.whyAria": "Alasan koreksi",
  "payEdit.whyPlaceholder":
    "Kelebihan satu nol, pelanggan melunasi sisanya tunai…",
  // The reason this is kept at all: it is what answers a customer disputing
  // the balance next month.
  "payEdit.whyHint":
    "Disimpan selamanya di samping angka lamanya. Ini yang menjawab kalau pelanggan menyanggah saldo ini bulan depan.",
  "payEdit.history": "Riwayat pembayaran transaksi ini",
  "payEdit.noHistory": "Belum ada koreksi pada transaksi ini.",
  "payEdit.added": "Ditambah {{amount}}",
  "payEdit.removed": "Dihapus {{amount}}",
  "payEdit.amended": "{{from}} → {{to}}",

  // ── The till — splitting a bill ──────────────────────────────────────

  // ── PriceEditorModal — repricing a shelf (owner ask 2026-09-08) ──────
  // The per-serial price. "Harga toko" and "Harga marketplace" are what the
  // shop says out loud; "marketplace" is not translated because the platforms
  // are called that here too.
  "price.editTitle": "Harga — {{what}}",
  "price.saveAll": "Simpan",
  "price.fillGrade": "Isi grade ke bawah",
  "price.gradeFor": "Grade {{serial}}",
  "price.serial": "Serial",
  "price.grade": "Grade",
  "price.store": "Harga toko",
  "price.storeFor": "Harga toko untuk {{serial}}",
  "price.fill": "Isi ke bawah",
  "price.fillDown": "Salin baris teratas ke seluruh kolom",
  "price.outOfRange": "{{n}} di antaranya bukan harga.",
  "price.belowCost": "Di bawah modal",
  "price.notAPrice": "Bukan harga",

  // ── BatteryFields — the boxes every QC desk asks a battery through ───
  // The 2026-09-08 split: a machine from 2020 or earlier is described by its
  // charge cycles and its full charge capacity, a later one by a percentage.
  // "Siklus" and "mAh" are what the bench reads off the machine.
  "battery.health": "Kesehatan baterai",
  "battery.cycleCount": "Jumlah siklus",
  "battery.fcc": "Kapasitas isi penuh",
  "battery.cyclesAndCapacity": "Siklus & kapasitas",
  "battery.range": "Hanya {{lo}}–{{hi}}",
  "battery.guide":
    "Mac Apple silicon dan model 2021 ke atas mencatat kesehatan baterai; unit Intel yang lebih lama mencatat jumlah siklus dan kapasitas isi penuh. Kesehatan: baik {{goodMin}}% ke atas, cukup {{fairMin}}–{{fairTop}}%, buruk di bawah {{fairMin}}%. Siklus: baik {{goodMax}} atau kurang, cukup sampai {{fairMax}}, buruk di atas itu. Kosong berarti belum ada yang mengukurnya.",

  // ── Inbound & QC — the order detail screen ───────────────────────────
  "inbound.confirmArrival": "Konfirmasi tiba ({{count}})",
  "inbound.confirmArrivalAria": "Konfirmasi {{count}} {{product}} tiba",
  "inbound.countedArrived": "{{count}} pcs masuk stok.",
  "inbound.countedArrivedCol": "Tiba",
  "inbound.countedInvoiced": "Ditagih",
  "inbound.countedPrice": "Harga per pcs",
  "inbound.countedQtyRefused":
    "{{count}} di antaranya sudah tiba. Batalkan kedatangannya dulu untuk menagih lebih sedikit.",
  "inbound.countedSection": "Produk yang dihitung",
  "inbound.invoiceArrived": "{{count}} tiba",
  "inbound.invoiceLinePrice": "Harga per pcs {{product}}",
  "inbound.invoiceRemoveArrived":
    "Sebagian produk ini sudah tiba. Batalkan kedatangannya dulu.",
  "inbound.kindChangeRefused":
    "Sebagian produk ini sudah tiba. Batalkan dulu, lalu ganti ke produk yang dihitung dengan cara berbeda.",
  "inbound.undoArrival": "Batalkan kedatangan",
  "inbound.undoArrivalBody":
    "Barang keluar dari rak dan kembali ke faktur sebagai belum tiba.",
  "inbound.undoArrivalOk": "Batalkan kedatangan",
  "inbound.undoArrivalRefused":
    "Hanya {{left}} dari {{came}} yang masih ada di {{where}} — sisanya sudah terjual atau dipindah. Koreksi stoknya dengan penyesuaian.",
  "inbound.undoArrivalTitle": "Batalkan kedatangan {{count}} pcs?",
  "inbound.accept": "Terima",
  "inbound.acceptAria": "Terima {{serial}}",
  "inbound.acceptHint": "Terima ke stok yang siap dijual",
  "inbound.action": "Aksi",
  "inbound.addProduct": "Tambah produk",
  "inbound.afterTheSerial": "Setelah serial",
  "inbound.amount": "Jumlah",
  "inbound.appliedTo": "Dibayarkan untuk",
  "inbound.awaitingSerial": "Menunggu serial",
  "inbound.backToInbound": "Kembali ke Barang Masuk",
  "inbound.battery": "Baterai",
  // Both take their bounds from the field, since 2026-09-08: one box wants a
  // percentage and the other a cycle count, so a message naming 0–100 would be
  // wrong on half the shelf.
  "inbound.batteryRange": "Hanya {{lo}}–{{hi}}",
  // The per-serial price, back on the QC grid since 2026-09-08.
  "inbound.price": "Harga",
  // Mengirim unit ke servis — dialog dengan ongkir dan biaya (2026-09-09).
  "inbound.serviceFeeFor": "Biaya servis untuk {{serial}}",
  "inbound.serviceFeeHint": "Kalau sudah tahu",
  "inbound.serviceFeeHint2":
    "Isi hanya kalau sudah tahu. Tagihan tukang servis berikutnya ditambahkan di meja servis, dan di sana juga bisa dikoreksi.",
  "inbound.serviceFeeRaised": "Dicatat saat QC",
  "inbound.serviceProblem": "Keluhannya apa",
  "inbound.serviceProblemHint": "Opsional — yang perlu dicek meja servis",
  "inbound.serviceSentShipping": "{{serial}} sekarang ada di {{bench}}.",
  "inbound.serviceShip": "Kirim ke {{bench}}",
  "inbound.serviceShipHint":
    "Matikan kalau tukang servisnya yang menjemput, atau kalau unitnya tidak dipindahkan. Kalau dinyalakan, unitnya langsung tercatat di meja servis.",
  "inbound.serviceShipLabel": "Ongkir ke servis",
  "inbound.serviceStaysHere": "{{name}} (tetap di sini)",
  "inbound.serviceShippingFee": "Ongkir ke sana",
  "inbound.serviceShippingFeeHint":
    "Ongkir antar gudang. Ikut dihitung sebagai modal unit ini.",
  "inbound.priceRefused": "{{value}} bukan harga.",
  "inbound.weAsk": "Kami jual {{price}}",
  "inbound.batteryRefused":
    "{{value}} bukan angka yang diterima kotak ini — hanya {{lo}} sampai {{hi}}.",
  "inbound.bucketPartly": "{{paid}} dibayar, {{owed}} masih kurang",
  "inbound.bucketSettled": "lunas",
  "inbound.bucketUnpaid": "belum dibayar",
  // The connector between two things left unfinished on an invoice somebody is
  // about to close. A separate key because a comma-and does not join a list the
  // same way in every language.
  "inbound.closeAnd": ", dan ",
  "inbound.closeBody":
    "Order menjadi hanya-baca dan keluar dari daftar kerja aktif. Anda bisa membukanya lagi kapan saja.",
  "inbound.closeInvoice": "Tutup invoice",
  "inbound.closeLoose": "Perlu dicatat bahwa {{what}}.",
  "inbound.closeOk": "Tutup invoice",
  "inbound.closeOwed": "{{amount}} masih kurang dibayar",
  "inbound.closeTitle": "Tutup invoice ini?",
  "inbound.closeUngraded": "{{count}} unit belum keluar dari QC",
  "inbound.closedBody":
    "Ditutup {{when}}. Tidak ada yang bisa diubah di order ini — buka lagi untuk mencatat pembayaran, mengubah baris produk, atau mem-QC unit.",
  "inbound.closedTitle": "Invoice ini sudah ditutup",
  "inbound.conditionPlaceholder": "Kondisi, lecet, kelengkapan dus…",
  "inbound.description": "Deskripsi",
  "inbound.discount": "Diskon",
  "inbound.enterHowMuch": "Isi dulu berapa yang dibayar.",
  "inbound.groupDone": "Sudah beres",
  "inbound.identifiedOf": "{{done}} dari {{total}} teridentifikasi",
  "inbound.inboundOrder": "Order Barang Masuk",
  "inbound.invoice": "Invoice",
  "inbound.invoiced": "Ditagihkan",
  "inbound.itMayHaveBeenRemoved":
    "Mungkin sudah dihapus, atau tautannya salah.",
  "inbound.lineTotal": "Total baris",
  "inbound.listedAt": "Dijual {{price}}",
  "inbound.markArrived": "Tandai sudah datang",
  "inbound.markThisOrderAsArrived": "Tandai order ini sudah datang?",
  "inbound.markedArrived":
    "Ditandai sudah datang. Scan atau ketik tiap serialnya di bawah.",
  "inbound.method": "Metode",
  "inbound.money": "Uang",
  "inbound.missingDescription": "deskripsi",
  "inbound.needBeforeAccept": "Masih perlu {{what}}",
  "inbound.needDescriptions": "{{count}} tanpa deskripsi",
  "inbound.needSerials": "{{count}} tanpa serial",
  // On the row itself, so it reads as an instruction to the person filling it
  // in rather than as a count.
  "inbound.needsDescription": "Perlu deskripsi",
  "inbound.needsSerial": "Perlu serial",
  "inbound.needPrice": "Isi harga jual dulu — itulah gunanya QC",
  "inbound.noProducts": "Belum ada produk di order ini.",
  "inbound.noProductsWhy":
    "Itu wajar kalau uang sudah ditransfer sebelum ada yang tahu barangnya apa — tambahkan sekarang setelah barangnya sampai.",
  "inbound.noSuchOrder": "Order tidak ditemukan",
  "inbound.notReceived": "Tidak diterima",
  "inbound.notReceivedHint":
    "Supplier tidak pernah mengirim ini. Barisnya tetap ada karena tertagih di invoice, tapi tidak lagi dihitung sebagai utang.",
  "inbound.nothingExpected":
    "Belum ada produk di order ini. Tambahkan barisnya dan satu baris muncul di sini untuk tiap unit yang ditunggu.",
  "inbound.nothingReceived":
    "Belum ada yang diterima. Tandai order sudah datang untuk mulai mencatat serial.",
  "inbound.nothingToReceive":
    "Tambahkan produknya dulu — belum ada yang bisa diterima.",
  "inbound.overQuotaAria": "Melebihi kuota",
  "inbound.overQuotaBody":
    "Jumlahnya diturunkan setelah unit-unit ini di-QC, jadi barisnya disimpan dan bukan dihapus. Kembalikan jumlahnya kalau itu keliru, atau hapus tiap baris setelah tahu unitnya ke mana.",
  "inbound.overQuotaRow": "Tidak ada baris produk yang menaungi unit ini lagi.",
  "inbound.overQuotaTag": "{{count}} lebih dari kuota",
  "inbound.overQuotaTitle":
    "{{count}} serial tidak lagi tercakup baris produk mana pun",
  "inbound.owedShort": "kurang {{amount}}",
  "inbound.paid": "Dibayar",
  "inbound.paidBeforeTheProductsWere":
    "Dibayar sebelum produknya diketahui — belum ada yang ditagihkan.",
  "inbound.partPaymentNormal":
    "Bayar sebagian sekarang dan sisanya nanti itu biasa — sisa tagihannya tetap tercatat di order.",
  "inbound.payTheBalance": "Bayar sisa {{what}} — {{amount}}",
  "inbound.paymentRecorded": "Pembayaran tercatat untuk {{what}}.",
  "inbound.photoNeedsSerial":
    "Foto disimpan pada unitnya, jadi baris ini butuh serialnya dulu.",
  "inbound.pickEveryProduct":
    "Setiap baris harus punya produk sebelum order bisa diterima.",
  "inbound.pickProduct": "Cari nama produk atau kode SKU",
  "inbound.printLabels": "Cetak label",
  "inbound.product": "Produk",
  "inbound.products": "Produk",
  "inbound.unitsPurchased": "Total unit dibeli",
  "inbound.productsTotal": "Produk",
  "inbound.putBackHint": "Kembalikan baris ini — barangnya ternyata datang",
  "inbound.qcHint":
    "Isi barisnya sesuai urutan yang paling gampang dari unitnya — serial boleh belakangan. Scan dengan fokus di mana saja pada halaman ini akan menjatuhkan serial ke baris berikutnya yang masih menunggu.",
  "inbound.qty": "Qty",
  "inbound.qtyAria": "Jumlah",
  "inbound.readyTag": "{{count}} siap diterima",
  "inbound.readyToAccept": "Siap diterima",
  "inbound.received": "Diterima",
  "inbound.record": "Catat",
  "inbound.recordAPayment": "Catat pembayaran",
  "inbound.recordPayment": "Catat pembayaran",
  "inbound.reject": "Tolak",
  "inbound.rejectBody":
    "{{serial}} tidak akan masuk inventaris. Riwayatnya tetap tercatat, dan keputusan ini masih bisa dibatalkan lewat barisnya.",
  "inbound.rejectOk": "Retur ke supplier",
  "inbound.rejectTitle": "Retur unit ini ke supplier?",
  "inbound.removeLine": "Hapus baris ini",
  "inbound.removeLineBody":
    "Serialnya tidak ikut terhapus. Yang sudah di-QC tetap ada di Serial & QC, ditandai melebihi kuota supaya Anda bisa menentukan nasib tiap unitnya.",
  "inbound.removeLineOk": "Hapus baris",
  "inbound.removeLineTitle": "Hapus baris ini dari order?",
  "inbound.removeSerial": "Hapus unit ini dari order",
  "inbound.removeSerialAria": "Hapus {{serial}}",
  "inbound.removeSerialBody":
    "{{serial}} beserta semua yang tercatat padanya akan hilang. Kalau baris produknya masih menunggu unit ini, barisnya kembali kosong menunggu serial.",
  "inbound.removeSerialOk": "Hapus baris",
  "inbound.removeSerialTitle": "Hapus baris serial ini?",
  "inbound.reopen": "Buka lagi",
  "inbound.reopenAria": "Buka lagi QC untuk {{serial}}",
  "inbound.reopenBlocked":
    "Unit ini sudah dijanjikan ke pelanggan atau terjual. Perbaiki di tempat kejadiannya, bukan di sini.",
  "inbound.reopenBody":
    "{{serial}} sekarang {{stage}}. Membukanya lagi tidak menghapus itu dari riwayat, hanya menambah koreksi — jadi Anda bisa mem-QC ulang atau mengambil keputusan lain.",
  "inbound.reopenHint": "Salah unit? Kembalikan ke QC dan putuskan ulang",
  "inbound.reopenInvoice": "Buka lagi",
  "inbound.reopenOk": "Buka lagi QC",
  "inbound.reopenTitle": "Kembalikan unit ini ke QC?",
  "inbound.reopenedInvoice": "Invoice dibuka lagi — sudah bisa diubah.",
  "inbound.scanClosed":
    "Invoice ini sudah ditutup. Buka lagi sebelum mencatat apa pun.",
  "inbound.scanDuplicate": "{{serial}} sudah ada di order ini.",
  "inbound.scanExists": "{{serial}} sudah dipakai unit lain di sistem.",
  "inbound.scanFull":
    "Semua unit di order ini sudah punya serial. Naikkan jumlahnya kalau memang ada tambahan.",
  "inbound.scanLanded": "{{serial}} tercatat — {{product}}",
  "inbound.scanNotArrived":
    "Tandai order sudah datang dulu — itu yang membuka QC.",
  "inbound.scanOrType": "Scan atau ketik serialnya",
  "inbound.sellPrice": "Harga jual",
  "inbound.serial": "Serial",
  "inbound.serialCannotBeBlank":
    "Serial tidak boleh kosong. Hapus barisnya saja kalau memang tidak ada.",
  "inbound.serialCorrected": "Serial diperbaiki menjadi {{serial}}.",
  "inbound.serialFirst": "Isi serialnya dulu",
  "inbound.serialRecorded": "{{serial}} tercatat.",
  "inbound.serialTaken": "{{serial}} sudah dipakai unit lain.",
  "inbound.serialTooLong":
    "Itu {{n}} karakter — serial paling panjang {{max}}. Dua kali scan ke satu kolom biasanya penyebabnya.",
  "inbound.serialTooShort":
    "“{{serial}}” cuma {{n}} karakter — serial minimal {{min}}: kode dua huruf supplier plus nomor unitnya. Cek stikernya.",
  "inbound.serialsQc": "Serial & QC",
  "inbound.shipping": "Ongkir",
  "inbound.slotOf": "Unit ke-{{n}} dari {{total}}",
  "inbound.service": "Servis",
  "inbound.serviceOk": "Kirim ke servis",
  "inbound.stage": "Tahap",
  "inbound.status": "Status",
  "inbound.stillOwed": "Masih kurang",
  "inbound.tax": "Pajak",
  "inbound.unitCost": "Harga satuan",
  "inbound.warehouse": "Gudang",
  "inbound.when": "Waktu",

  // ── Inbound & QC — grading (owner ask 2026-08-27) ────────────────────
  "inbound.grade": "Grade",
  "inbound.gradeAria": "Nilai {{serial}}",
  "inbound.gradeHint": "Nilai dengan checklist kategorinya",
  "inbound.gradeNoSerialYet": "belum ada serial",
  "inbound.gradeSlotAria": "Nilai unit ini",

  // ── Inbound & QC — raising an order ──────────────────────────────────
  "inboundForm.addProduct": "Tambah produk",
  "inboundForm.arrivingAt": "Datang ke",
  "inboundForm.dateOfPurchase": "Tanggal pembelian",
  "inboundForm.discount": "Diskon",
  "inboundForm.eGInvMj0815": "mis. INV/MJ/0815",
  "inboundForm.invoice": "Invoice",
  "inboundForm.invoiceNumber": "Nomor invoice",
  "inboundForm.lineTotal": "Total baris",
  "inboundForm.money": "Uang",
  "inboundForm.newInboundOrder": "Order Barang Masuk Baru",
  "inboundForm.next": "Selanjutnya",
  "inboundForm.orderPayment": "Order & pembayaran",
  "inboundForm.ordered": "Dipesan",
  "inboundForm.paymentMethod": "Metode pembayaran",
  "inboundForm.pickAProduct": "Pilih produk",
  "inboundForm.countedQty": "Berapa banyak",
  "inboundForm.product": "Produk",
  "inboundForm.products": "Produk",
  "inboundForm.qty": "Qty",
  "inboundForm.removeProduct": "Hapus produk",
  "inboundForm.review": "Tinjau",
  "inboundForm.saveOrder": "Simpan order",
  "inboundForm.searchOrTypeANew": "Cari atau ketik nama supplier baru",
  "inboundForm.shippingFee": "Ongkos kirim",
  "inboundForm.supplier": "Supplier",
  "inboundForm.taxFee": "Pajak",
  "inboundForm.thisSupplierIssuedNoInvoice":
    "Supplier ini tidak mengeluarkan invoice",
  "inboundForm.totalPaidNow": "Total dibayar sekarang",
  "inboundForm.unitCost": "Harga satuan",

  // ── Inbound & QC — the order list ────────────────────────────────────
  "inboundList.inbound": "Barang Masuk",
  "inboundList.invoiced": "Ditagihkan",
  "inboundList.newOrder": "Order baru",
  "inboundList.nothingInvoicedYet": "belum ada yang ditagihkan",
  "inboundList.order": "Order",
  "inboundList.ordered": "Dipesan",
  "inboundList.paid": "Dibayar",
  "inboundList.products": "Produk",
  "inboundList.productsNotEnteredYetAdd":
    "Produk belum diisi — tambahkan saat barangnya datang",
  "inboundList.searchOrderSupplierOrInvoice":
    "Cari order, supplier atau nomor invoice",
  "inboundList.stage": "Tahap",
  "inboundList.supplier": "Supplier",
  "inboundList.warehouse": "Gudang",

  // ── Inventory & Stock Movement — the page, its modals and its log ────
  "stock.addLine": "Tambah baris",
  "stock.adjustmentType": "Jenis penyesuaian",
  "stock.anyBatteryHealth": "Semua kesehatan baterai",
  "stock.batteryHealth": "Kesehatan baterai",
  "stock.batteryRange": "Hanya 0–100%",
  // One column over both eras since 2026-09-08 — see `battery.*` above.
  "stock.battery": "Baterai",
  "stock.anyBattery": "Semua baterai",
  "stock.batteryOutOfRange": "Salah satu angka ini di luar rentang.",
  "stock.conditionBatteryHealthCompleteness":
    "Kondisi, kesehatan baterai, kelengkapan…",
  "stock.description": "Deskripsi",
  "stock.descriptionCondition": "Deskripsi / kondisi",
  "stock.in": "Masuk",
  "stock.inAndOut": "Masuk dan keluar",
  "stock.intoWarehouse": "Ke gudang",
  "stock.inventory": "Inventaris",
  "stock.inventoryStockMovement": "Inventaris & Pergerakan Stok",
  "stock.leaveEmptyWhenNobodyHas":
    "Kosongkan kalau belum ada yang membacanya dari unit — itu tidak sama dengan nol",
  "stock.logAdjustment": "Catat penyesuaian",
  "stock.out": "Keluar",
  "stock.pickOneOrTypeA":
    "Pilih satu, atau ketik alasan baru — yang baru otomatis ditambahkan ke Pengaturan",
  "stock.product": "Produk",
  "stock.reason": "Alasan",
  "stock.countedProducts": "Produk yang dihitung",
  "stock.pickCountedProduct": "Produk",
  "stock.countedProductAria": "Produk yang dihitung",
  "stock.countedQtyAria": "Berapa banyak",
  "stock.addCounted": "Tambah produk yang dihitung",
  "stock.removeThisLine": "Hapus baris ini",
  "stock.scanOrTypeASerial": "Scan atau ketik nomor serial",
  "stock.searchAReasonOrType": "Cari alasan, atau ketik yang baru",
  "stock.searchSerialDescriptionOrReason": "Cari serial, deskripsi atau alasan",
  "stock.serial": "Serial",
  "stock.specs": "Spesifikasi",
  "stock.stockIn": "Stok masuk",
  "stock.stockOut": "Stok keluar",
  "stock.tabHistory": "Riwayat Pergerakan Stok",
  "stock.tabStock": "Stok",
  "stock.editMovement": "Ubah",
  "stock.editMovementAria": "Ubah pergerakan {{what}}",
  "stock.thisSerialWasNotIn":
    "Serial ini belum ada di sistem; penyesuaian ini yang membuatnya",
  "stock.type": "Jenis",
  "stock.unitsBecome": "Unit menjadi",
  "stock.warehouse": "Gudang",
  "stock.whatTheUnitSStatus":
    "Status unit akan menjadi apa. Log dan status harus sepakat.",
  "stock.when": "Waktu",
  "stock.whyThisChange": "Kenapa diubah?",
  "stock.writtenIntoTheAppendOnly": "Ditulis ke log yang hanya bisa ditambah",

  // ── Inventory — the per-serial price (owner ask 2026-09-08) ──────────
  "inventory.marketOne": "marketplace {{price}}",
  "inventory.notPricedYet": "belum dihargai",
  "inventory.ungraded": "Belum digrade",
  "inventory.unitsUpdated": "{{n}} unit diperbarui.",

  // ── Inventory & Stock Movement — the product table ───────────────────
  "inventory.adjustAria": "Sesuaikan {{serial}}",
  "inventory.adjustUnit": "Sesuaikan unit ini",
  "inventory.allProducts": "Semua produk",
  "inventory.anyBattery": "Semua kesehatan baterai",
  "inventory.anyCategory": "Semua kategori",
  "inventory.anyProduct": "Semua produk",
  "inventory.anyWarehouse": "Semua gudang",
  "inventory.battery": "Baterai",
  "inventory.batteryBandsAria": "Arti rentang baterai",
  "inventory.description": "Deskripsi",
  "inventory.photos": "Foto",
  "inventory.inStock": "Ada stok",
  "inventory.nAvailable": "{{n}} tersedia",
  "inventory.nInQc": "{{n}} di QC",
  "inventory.nOnHold": "{{n}} ditahan",
  "inventory.nOnService": "{{n}} di servis",
  "inventory.printN": "Cetak label ({{count}})",
  "inventory.qty": "Jml",
  "inventory.searchPlaceholder":
    "Cari produk, spesifikasi, kode atau nomor serial",
  "inventory.serial": "Serial",
  "inventory.status": "Status",
  "inventory.summary":
    "{{products}} produk · {{units}} unit dipegang · nilai {{value}}",
  "inventory.warehouse": "Gudang",
  "inventory.where": "Di mana",

  // ── New Transaction — the till ───────────────────────────────────────
  "pos.addAUnit": "Tambah unit",
  "pos.addCustomer": "Tambah pelanggan",
  "pos.addOn": "Pelengkap",
  "pos.countedShort": "Stok {{product}} tinggal {{count}}.",
  "pos.lineQty": "Jumlah {{product}}",
  "pos.linePiecePrice": "Harga per pcs {{product}}",
  "pos.addToSale": "Tambah ke penjualan",
  "pos.applyIt": "Terapkan",
  "pos.cameFrom": "Berasal dari",
  "pos.customer": "Pelanggan",
  "pos.delivery": "Pengiriman",
  "pos.description": "Deskripsi",
  "pos.discount": "Diskon",
  "pos.discountPercentage": "Persentase diskon",
  "pos.items": "Barang",
  "pos.name": "Nama",
  "pos.nothingMatchesThat": "Tidak ada yang cocok.",
  "pos.onTheShelf": "Daftar Produk",
  "pos.payment": "Pembayaran",
  "pos.paymentMethod": "Metode pembayaran",
  "pos.phoneNumber": "Nomor telepon",
  "pos.pickADiscount": "Pilih diskon",
  "pos.pointOfSale": "Kasir",
  "pos.price": "Harga",
  "pos.product": "Produk",
  "pos.recordingItMarksThoseUnits":
    "Mencatatnya menandai unit-unit itu sebagai terbeli dan melepas tahanannya.",
  "pos.referral": "Referal",
  "pos.removeThisLine": "Hapus baris ini",
  "pos.salesDetail": "Detail penjualan",
  "pos.salesperson": "Sales",
  "pos.searchNameOrPhone": "Cari nama atau nomor telepon",
  "pos.searchOrScanASerial": "Cari atau scan serial, model atau kode",
  "pos.searchSerialModelOrVariant": "Cari serial, model atau varian",
  "pos.searchSerialProductOrCustomer": "Cari serial, produk atau pelanggan",
  "pos.sellFromAReservation": "Jual dari reservasi",
  "pos.shopeeHoldsTheMoneyIn": "Shopee menahan uangnya di escrow",
  "pos.source": "Sumber",
  "pos.theCustomerIsTakingIt":
    "Pelanggan membawanya sendiri — tidak perlu alamat.",
  "pos.theSaleIsAlreadyRecorded":
    "Penjualannya sudah tercatat. Cetak sekarang, atau cari lagi nanti di Keuangan → Riwayat Transaksi.",
  "pos.thisOrderIsShipped": "Pesanan ini dikirim",
  "pos.thisSaleIsRecordedAs":
    "Penjualan ini dicatat sebagai tertunda di Pemasukan & Pengeluaran sampai penarikannya dikonfirmasi, jadi tidak ada metode pembayaran yang perlu dipilih.",
  "pos.unit": "Unit",
  "pos.unitSerialInInventory": "Unit (serial di inventaris)",
  "pos.upgrade": "Upgrade",
  "pos.useThis": "Pakai ini",
  "pos.whereDidTheyHearOf": "Dari mana mereka tahu toko ini?",
  "pos.whoGetsCreditForThis":
    "Siapa yang mendapat kredit atas penjualan ini. Diatur di Pengaturan → Sales.",
  "pos.whoMadeThisSale": "Siapa yang menjual ini?",
  "pos.why": "Alasan",
  "pos.worthOfferingWithThisSale": "Layak ditawarkan bersama penjualan ini",

  // ── Stock Opname — one count ─────────────────────────────────────────
  "opname.addAdjustment": "Tambah penyesuaian",
  "opname.adjustHint":
    "Catat unit masuk atau keluar stok — hitungan ini tetap apa adanya",
  "opname.backToCounting": "Kembali menghitung",
  "opname.backToList": "Kembali ke Stok Opname",
  "opname.batch": "Batch",
  "opname.count": "Hitung",
  "opname.countOneFirst": "Hitung setidaknya satu serial dulu",
  "opname.counted": "Terhitung",
  "opname.countedFor": "Dihitung untuk",
  "opname.countedTitle":
    "Terhitung — ditemukan di tempat yang diharapkan ({{count}})",
  "opname.nothingCountedYet": "Tidak ada yang dihitung di sesi ini.",
  "opname.location": "Lokasi",
  "opname.draftTag": "Draf",
  "opname.history": "Riwayat",
  "opname.historyAria": "Riwayat {{serial}}",
  "opname.historyOf": "Riwayat — {{serial}}",
  "opname.missing": "Hilang",
  "opname.missingTitle":
    "Hilang — seharusnya ada di sini tapi tidak ditemukan ({{count}})",
  "opname.nScanned": "{{count}} discan",
  "opname.needNotesBody":
    "Setiap unit yang hilang dan tidak dikenal butuh keterangan tentang apa yang terjadi sebelum hitungan bisa diposting.",
  "opname.needNotesTitle": "{{count}} unit masih butuh keterangan",
  "opname.needNotesWhy":
    "Hitungan yang mencatat selisih tanpa menyebut sebabnya adalah hitungan yang tidak bisa ditindaklanjuti nanti.",
  "opname.notFound": "Hitungan tidak ditemukan",
  "opname.notePlaceholder": "Wajib — sebutkan apa yang terjadi pada unit ini",
  "opname.nothingMissing":
    "Tidak ada yang hilang. Semua unit yang diharapkan terhitung.",
  "opname.nothingUnexpected": "Tidak ditemukan hal yang di luar dugaan.",
  "opname.postBody":
    "{{counted}} terhitung · {{missing}} hilang · {{unknown}} tidak dikenal. Unit yang hilang ditandai hilang, dan hitungan menjadi hanya-baca.",
  "opname.postOk": "Posting hitungan",
  "opname.postTitle": "Posting hitungan ini?",
  "opname.posted": "Opname diposting.",
  "opname.postedBody":
    "Tidak dapat diubah lagi. Lakukan penyesuaian stok jika ada yang tidak sesuai",
  "opname.postedTag": "Diposting",
  "opname.postedTitle": "Hitungan ini sudah diposting",
  "opname.product": "Produk",
  "opname.review": "Tinjau & selesai",
  "opname.reviewHint": "Tinjau apa yang hilang dan apa yang muncul tak terduga",
  "opname.saveDraft": "Simpan sebagai draf",
  "opname.savedDraft":
    "Tersimpan sebagai draf. Lanjutkan dari daftar Stok Opname.",
  "opname.scanHint":
    "Scan atau ketik serial lalu Enter — terus scan, tidak ada dialog di antaranya",
  "opname.serial": "Serial",
  "opname.status": "Status",
  "opname.stockOpname": "Stok Opname",
  "opname.systemSays": "Menurut sistem ada di",
  "opname.tally":
    "{{counted}} terhitung · {{missing}} hilang · {{unknown}} tidak dikenal",
  "opname.unknown": "Tidak dikenal",
  "opname.unknownTitle":
    "Tidak dikenal — ditemukan di sini tapi tidak diharapkan ({{count}})",
  "opname.unknownWhy":
    "Serial yang menurut sistem ada di gudang lain berarti pemindahan yang tidak tercatat — riwayatnya menunjukkan di mana ia berada. Yang belum pernah dikenal sistem berarti stok yang tidak pernah dibukukan.",
  "opname.warehouse": "Gudang",
  "opname.whatHappened": "Apa yang terjadi",
  // The scope, and the word that means "everything on this axis".
  "opname.racks": "Rak",
  "opname.categories": "Kategori",
  "opname.condition": "Kondisi",
  "opname.allWarehouses": "Semua gudang",
  "opname.allRacks": "Semua rak",
  "opname.allCategories": "Semua kategori",
  "opname.allConditions": "Baru dan bekas",
  "opname.conditionNew": "Baru",
  // "Bekas" throughout, matching `inbound.conditionSecond` — the written form.
  "opname.conditionSecond": "Bekas",
  // Surplus: a machine found on a shelf that was never booked in.
  "opname.takeIntoStock": "Masukkan ke stok",
  "opname.surplusAdd": "Tambahkan ke inventaris",
  "opname.surplusEdit": "Ubah",
  "opname.alreadyOurs": "Sudah milik kita — pindahkan saja",
  "opname.addedToQc": "Masuk QC — {{reason}}",
  "opname.surplusTitle": "Masukkan {{serial}} ke stok",
  "opname.surplusOk": "Masukkan ke QC",
  "opname.surplusExplainTitle": "Masuk ke QC, bukan langsung ke rak",
  "opname.surplusExplainBody":
    "Tidak ada yang dibuat sampai hitungan ini diposting. Setelah itu unitnya menunggu di QC tanpa grade dan tanpa harga beli, karena belum ada yang memeriksanya — beri grade di Barang Masuk & QC supaya bisa dijual.",
  "opname.surplusProduct": "Produk",
  "opname.surplusPickProduct": "Cari produk",
  "opname.surplusProductHelp":
    "Serial saja tidak menambah jumlah stok produk mana pun. Sebutkan ini unit yang mana.",
  "opname.surplusReason": "Alasan",
  "opname.surplusReasonHelp":
    "Sebutkan kenapa toko punya unit yang tidak pernah dibukukan.",
  "opname.surplusReasonPlaceholder":
    "mis. Dibeli di kasir, tidak pernah diinput",
  "opname.surplusCondition": "Kondisi",
  "opname.surplusWarehouse": "Ditemukan di",
  "opname.surplusWarehouseHint":
    "Hitungan ini mencakup lebih dari satu gudang, jadi tidak bisa menentukan di mana unitnya ditemukan.",
  "opname.postBodySurplus":
    "{{count}} unit akan dibuat di QC — masih perlu digrade sebelum bisa dijual.",
  "opname.postedWithSurplus":
    "Stok opname diposting. {{count}} unit masuk ke QC — beri grade di Barang Masuk & QC sebelum bisa dijual.",

  // ── Stock Opname — the list ──────────────────────────────────────────
  "opnameList.batch": "Batch",
  "opnameList.beginCounting": "Mulai menghitung",
  "opnameList.counted": "Terhitung",
  "opnameList.countedFor": "Dihitung untuk",
  "opnameList.dateThisCountIsFor": "Tanggal hitungan ini",
  "opnameList.eGRakAC": "mis. Rak A–C, shift pagi",
  "opnameList.missing": "Hilang",
  "opnameList.newStockOpname": "Stok opname baru",
  "opnameList.reference": "Referensi",
  "opnameList.searchReferenceLabelOrWarehouse":
    "Cari referensi, label atau gudang",
  "opnameList.startAStockOpname": "Mulai stok opname",
  "opnameList.status": "Status",
  "opnameList.stockOpname": "Stok Opname",
  "opnameList.unknown": "Tidak dikenal",
  "opnameList.warehouse": "Gudang",
  "opnameList.scope": "Cakupan",
  "opnameList.warehouses": "Gudang",
  "opnameList.racks": "Rak",
  "opnameList.categories": "Kategori produk",
  "opnameList.condition": "Kondisi",
  // The rule the whole feature rests on, said on every field: kosong = semua.
  "opnameList.warehousesHint": "Kosongkan untuk menghitung semua gudang.",
  "opnameList.racksHint":
    "Kosongkan untuk semua rak di gudang tersebut. Kalau rak dipilih, unit yang masih di QC tidak ikut dihitung karena belum ada di rak mana pun.",
  "opnameList.categoriesHint": "Kosongkan untuk menghitung semua kategori.",
  "opnameList.conditionHint":
    "Kosongkan untuk menghitung yang baru maupun yang bekas.",
  "opnameList.allWarehouses": "Semua gudang",
  "opnameList.allRacks": "Semua rak",
  "opnameList.allCategories": "Semua kategori",
  "opnameList.allConditions": "Baru dan bekas",
  "opnameList.conditionNew": "Baru",
  "opnameList.conditionSecond": "Bekas",

  // ── In QC without an order — a stock take's surplus ──────────────────
  "orphanQc.title": "Di QC tanpa nota ({{count}})",
  "orphanQc.explain":
    "Unit yang ditemukan saat stok opname, bukan dibeli lewat nota. Sudah terhitung sebagai stok tapi belum bisa dijual sebelum digrade di sini.",
  "orphanQc.serial": "Serial",
  "orphanQc.product": "Produk",
  "orphanQc.warehouse": "Gudang",
  "orphanQc.condition": "Kondisi",
  "orphanQc.conditionNew": "Baru",
  "orphanQc.conditionSecond": "Bekas",
  "orphanQc.describe": "Deskripsi",
  "orphanQc.describePlaceholder": "Lecet, kelengkapan dus…",
  "orphanQc.describeOptional": "Opsional untuk unit baru",
  "orphanQc.describeFirst":
    "Sebutkan dulu kondisi unit ini sebelum ditaruh di rak.",
  "orphanQc.grade": "Grade",
  "orphanQc.gradePlaceholder": "Grade",
  "orphanQc.gradeAria": "Beri grade {{serial}}",
  "orphanQc.accept": "Terima",
  "orphanQc.acceptHint": "Taruh di rak dengan harga jual produk ini",
  "orphanQc.accepted": "{{serial}} sudah masuk rak.",
  "orphanQc.writeOffAria": "Hapus {{serial}} dari stok",
  "orphanQc.writeOffTitle": "Hapus {{serial}} dari stok?",
  "orphanQc.writeOffBody":
    "Unitnya keluar dari stok dan tetap tercatat di riwayat. Tidak ada supplier untuk mengembalikannya — unit ini tidak berasal dari nota mana pun.",
  "orphanQc.writeOffOk": "Hapus dari stok",

  // ── S/N Tracking ─────────────────────────────────────────────────────
  "snTracking.checkIntake": "Cek penerimaan",
  "snTracking.clear": "Bersihkan",
  "snTracking.ctxArrived": "Menunggu QC — datang dari {{supplier}}",
  "snTracking.ctxCameFrom": "— masuk lewat {{channel}}",
  "snTracking.ctxHeld": "Ditahan",
  "snTracking.ctxHeldFor": "Ditahan untuk {{who}}",
  "snTracking.ctxReturned": "{{code}} → {{supplier}}",
  "snTracking.ctxSold": "Terjual di {{code}}",
  "snTracking.ctxSoldFor": "seharga {{amount}}",
  "snTracking.ctxSoldTo": "ke {{who}}",
  "snTracking.description": "Deskripsi",
  "snTracking.photos": "Foto",
  "snTracking.event": "Kejadian",
  "snTracking.fromPo": "Dari PO",
  "snTracking.lifecycle": "Perjalanan hidup",
  "snTracking.location": "Lokasi",
  "snTracking.noUnitWithThisSerial":
    "Tidak ada unit dengan serial ini di sistem. Kalau baru saja datang, mungkin masih menunggu di penerimaan.",
  "snTracking.note": "Catatan",
  "snTracking.printLabel": "Cetak label",
  "snTracking.rawLedger": "Buku besar mentah",
  "snTracking.ref": "Ref",
  "snTracking.sNTracking": "Riwayat Serial",
  "snTracking.searchEventNoteOrReference":
    "Cari kejadian, catatan atau referensi",
  "snTracking.sellingPrice": "Harga jual",
  "snTracking.status": "Status",
  "snTracking.warehouse": "Gudang",

  // ── Reservation ──────────────────────────────────────────────────────
  "reservations.availableUnit": "Unit tersedia",
  "reservations.buyAll": "Beli semua {{count}}",
  "reservations.cameFrom": "Berasal dari",
  "reservations.cancelReservation": "Batalkan reservasi",
  "reservations.cancelTheHold": "Batalkan tahanannya",
  "reservations.cancelThisReservation": "Batalkan reservasi ini?",
  "reservations.customer": "Pelanggan",
  "reservations.description": "Deskripsi",
  "reservations.holdUntil": "Ditahan sampai",
  "reservations.keepTheHold": "Pertahankan tahanannya",
  "reservations.manageAria": "Buka unit pada {{code}}",
  "reservations.product": "Produk",
  "reservations.releaseRest":
    "Batalkan hold {{count}} unit lainnya dan kembalikan ke stok",
  "reservations.releaseRestAria": "Batalkan hold untuk unit yang tidak diambil",
  "reservations.reservation": "Reservasi",
  "reservations.reservations": "Reservasi",
  "reservations.reserve": "Reservasi",
  "reservations.searchSerialProductOrCustomer":
    "Cari serial, produk atau pelanggan",
  "reservations.sellThisUnitNow": "Jual unit ini sekarang",
  "reservations.status": "Status",
  "reservations.unitsOnHold": "Unit pada {{code}}",
  "reservations.when": "Waktu",

  // ── Return — from a customer ─────────────────────────────────────────
  "returnCustomer.date": "Tanggal",
  "returnCustomer.searchAReasonOrType": "Cari alasan, atau ketik yang baru",
  "returnCustomer.product": "Produk",
  "returnCustomer.reason": "Alasan",
  "returnCustomer.recordAReturn": "Catat retur",
  "returnCustomer.recordReturn": "Catat retur",
  "returnCustomer.returnHistory": "Riwayat retur",
  "returnCustomer.searchCodeSerialOrReason": "Cari kode, serial atau alasan",
  "returnCustomer.specifyTheReason": "Sebutkan alasannya",
  "returnCustomer.whatWasWrongWithIt": "Apa masalahnya?",
  // Editable condition + payment reference (owner ask 2026-09-21 malam).
  "returnCustomer.conditionCol": "Kondisi",
  "returnCustomer.conditionAria": "Kondisi {{serial}} saat retur",
  "returnCustomer.conditionBeforeAfter": "Kondisi",
  "returnCustomer.adjustmentCol": "Penyesuaian",
  "returnCustomer.paymentRef": "Referensi pembayaran",
  "returnCustomer.paymentRefHint":
    "Ditulis di penyesuaian Refund. Bukti transfer, resi kurir, atau nomor pesan dari pelanggan.",
  "returnCustomer.paymentRefPlaceholder":
    "mis. BCA 20260921-4711, atau nomor resi kurir",

  // ── Return — to a supplier ───────────────────────────────────────────
  "returnSupplier.date": "Tanggal",
  "returnSupplier.eGDeadPixelCluster": "mis. dead pixel, engsel longgar",
  "returnSupplier.expectedCredit": "Kredit yang diharapkan",
  "returnSupplier.pickOneOrTypeA":
    "Pilih satu, atau ketik alasan baru — yang baru otomatis ditambahkan ke Pengaturan",
  "returnSupplier.origin": "Asal",
  "returnSupplier.searchAReasonOrType": "Cari alasan, atau ketik yang baru",
  "returnSupplier.product": "Produk",
  "returnSupplier.reason": "Alasan",
  "returnSupplier.recordAReturn": "Catat retur",
  "returnSupplier.recordSupplierReturn": "Catat retur supplier",
  "returnSupplier.sayWhatIsActuallyWrong": "Sebutkan apa yang sebenarnya rusak",
  "returnSupplier.searchCodeSerialSupplierOr":
    "Cari kode, serial, supplier atau alasan",
  "returnSupplier.searchSerial": "Cari serial",
  "returnSupplier.specifyTheReason": "Sebutkan alasannya",
  "returnSupplier.status": "Status",
  "returnSupplier.supplier": "Supplier",
  "returnSupplier.supplierReturnHistory": "Riwayat retur supplier",
  "returnSupplier.unitInInventory": "Unit di inventaris",
  // A claim the shop raised and then took back — a QC rejection reopened
  // because it was the wrong machine.
  "returnSupplier.withdrawn": "Ditarik",
  "returnSupplier.whatUnit": "Unit (per serial)",
  "returnSupplier.whatCounted": "Produk hitungan (per jumlah)",
  "returnSupplier.noCountedStock": "Tidak ada stok produk hitungan.",
  "returnSupplier.searchProduct": "Cari produk",
  "returnSupplier.productInStock": "{{product}} — {{count}} di stok",
  "returnSupplier.warehouse": "Gudang",
  "returnSupplier.warehouseHolds": "{{warehouse}} — {{count}} di stok",
  "returnSupplier.qty": "Jml",
  "returnSupplier.qtyOverStock": "Hanya {{count}} di gudang itu.",
  "returnSupplier.cameInOn": "Invoice masuknya",
  "returnSupplier.cameInOnHint":
    "Invoice inilah yang mencatat ke supplier mana barang ini dikembalikan.",
  "returnSupplier.countedShort":
    "Stok di gudang itu tidak cukup — mungkin baru saja ada yang terjual.",
  "returnSupplier.countedReturned":
    "{{count}} × {{product}} dikembalikan ke supplier.",
  "returnSupplier.countedNoSerial": "Hitungan",

  // ── Return — the shared frame ────────────────────────────────────────
  "returns.addReturn": "Tambah retur",
  "returns.return": "Retur",

  // ── Master Product ───────────────────────────────────────────────────
  "products.16gb512gb": "16GB / 512GB",
  "products.256gb512gb": "256GB, 512GB…",
  "products.8gb16gb": "8GB, 16GB…",
  "products.addAValue": "Tambah nilai",
  "products.addAxis": "Tambah sumbu",
  "products.addProduct": "Tambah produk",
  "products.addVariant": "Tambah varian",
  "products.appendMissingVariants": "Tambahkan varian yang belum ada",
  "products.appleId": "Apple ID",
  "products.appliedToEveryGeneratedVariant":
    "Diterapkan ke setiap varian yang dibuat; sesuaikan satu per satu setelahnya",
  "products.category": "Kategori",
  "products.chip": "Chip",
  "products.couldNotReachAppledb": "Tidak bisa menghubungi AppleDB",
  "products.createProductAndVariants": "Buat produk dan variannya",
  "products.eGMacbookAirM4": "mis. MacBook Air M4",
  "products.howItIsWrittenEverywhere":
    "Cara penulisannya di tempat lain, mis. 16GB / 512GB",
  "products.importFromAppledb": "Impor dari AppleDB",
  "products.importedFromAppledbWhichCarries":
    "Diimpor dari AppleDB, yang tidak memuat harga",
  "products.inStock": "Ada stok",
  "products.listPrice": "Harga daftar",
  "products.macbookAir": "MacBook Air",
  "products.masterProduct": "Master Produk",
  "products.modelName": "Nama model",
  "products.newVariantEGTouch": "Varian baru, mis. Touch Bar",
  "products.notPriced": "belum ada harga",
  "products.price": "Harga",
  "products.ramOptions": "Pilihan RAM",
  "products.releaseYear": "Tahun rilis",
  "products.replaceAll": "Ganti semua",
  "products.searchModelCategoryOrApple":
    "Cari model, kategori atau identifier Apple",
  "products.searchModelNameChipOr":
    "Cari nama model, chip atau identifier Apple",
  "products.source": "Sumber",
  "products.specs": "Spesifikasi",
  "products.ssdOptions": "Pilihan SSD",
  "products.startingListPrice": "Harga daftar awal",
  "products.tryAgain": "Coba lagi",
  "products.variant": "Varian",
  "products.variants": "Varian",
  "products.variantsOnThisModel": "Varian pada model ini",
  "products.year": "Tahun",
  // The AppleDB import table's status column. It carried a "not selling" mark
  // too until 2026-08-28, when that became a hide — see the revision block at
  // the foot of this file.
  "products.imported": "Sudah diimpor",
  "products.status": "Status",

  // ── Discount — the form ──────────────────────────────────────────────
  "discount.activePeriod": "Periode aktif",
  "discount.addDiscount": "Tambah Diskon",
  "discount.amountOff": "Potongan nominal",
  "discount.appliesTo": "Berlaku untuk",
  "discount.scopeCategory": "Kategori",
  "discount.scopeProduct": "Produk",
  "discount.whichCategory": "Kategori yang mana",
  "discount.whichProduct": "Produk yang mana",
  "discount.pickCategory": "Pilih kategori",
  "discount.pickProduct": "Pilih produk",
  "discounts.scopeCategoryOf": "Kategori: {{name}}",
  "discounts.scopeProductOf": "Produk: {{name}}",
  "discount.buyThisMany": "Beli sebanyak ini",
  "discount.capTheAmountAt": "Batasi potongannya di",
  "discount.code": "Kode",
  "discount.forThisPrice": "…dengan harga ini",
  "discount.howItIsWorkedOut": "Cara hitungnya",
  "discount.howManyUnitsFromThe":
    "Berapa unit dari cakupan di bawah yang membentuk satu bundel",
  "discount.maxUses": "Maks. pemakaian",
  "discount.name": "Nama",
  "discount.noCeiling": "Tanpa batas",
  "discount.percentageOff": "Potongan persen",
  "discount.saveDiscount": "Simpan diskon",
  "discount.summer25": "SUMMER25",
  "discount.theDiscount": "Diskon",
  "discount.unlimited": "Tanpa batas",
  "discount.whatTheWholeBundleCosts":
    "Harga seluruh bundel, bukan jumlah harga tiap unitnya",
  "discount.whenAndWhatItApplies": "Kapan dan untuk apa berlakunya",

  // ── Discount — the list ──────────────────────────────────────────────
  "discounts.activePeriod": "Periode aktif",
  "discounts.addDiscount": "Tambah diskon",
  "discounts.appliesTo": "Berlaku untuk",
  "discounts.channel": "Kanal",
  "discounts.code": "Kode",
  "discounts.customer": "Pelanggan",
  "discounts.discount": "Diskon",
  "discounts.duration": "Durasi",
  "discounts.givenAway": "Diberikan",
  "discounts.kind": "Jenis",
  "discounts.notRedeemedOnAnySale": "Belum dipakai di penjualan mana pun.",
  "discounts.orderTotal": "Total pesanan",
  "discounts.salesItAppearsOn": "Penjualan yang memakainya",
  "discounts.searchNameCodeOrScope": "Cari nama, kode atau cakupan",
  "discounts.searchOrderCodeOrCustomer": "Cari kode order atau pelanggan",
  "discounts.status": "Status",
  "discounts.takenOff": "Potongan",
  "discounts.takesOff": "Memotong",
  "discounts.timesRedeemed": "Kali dipakai",
  "discounts.units": "Unit",
  "discounts.used": "Terpakai",
  "discounts.when": "Waktu",

  // ── Financial & Report — the ledger ──────────────────────────────────
  "finance.addExpense": "Tambah pengeluaran",
  "finance.attributionIsWhatTheCustomer":
    "Atribusi adalah apa yang dikatakan pelanggan di kasir — sumber referal pada penjualan, atau yang tercatat di data pelanggannya. Ini laporan sendiri, jadi anggap kanal tanpa belanja sebagai promosi dari mulut ke mulut, bukan kemenangan gratis.",
  "finance.channel": "Kanal",
  "finance.confirmTheWithdrawalAndEnter":
    "Konfirmasi penarikannya dan masukkan jumlah yang benar-benar diterima",
  "finance.confirmWithdrawal": "Konfirmasi penarikan",
  "finance.customers": "Pelanggan",
  "finance.expensesToday": "Pengeluaran hari ini",
  "finance.incomeExpense": "Pemasukan & Pengeluaran",
  "finance.incomeToday": "Pemasukan hari ini",
  "finance.moneyOverTime": "Uang dari waktu ke waktu",
  "finance.moneyPendingWithdrawalByChannel":
    "Uang menunggu penarikan, per kanal",
  "finance.netAmountReceived": "Jumlah bersih diterima",
  "finance.netToday": "Bersih hari ini",
  "finance.noMarketingSpendRecordedYet":
    "Belum ada belanja pemasaran yang dicatat. Tambahkan di Pengeluaran → Marketing & Iklan.",
  "finance.nothingPendingAllMarketplaceMoney":
    "Tidak ada yang tertunda — semua uang marketplace sudah ditarik.",
  "finance.out": "Keluar",
  "finance.pendingNotYetWithdrawn": "Tertunda (belum ditarik)",
  "finance.recentMovements": "Pergerakan terbaru",
  "finance.pendingAmount": "Menunggu pencairan",
  "finance.sales": "Penjualan",
  "finance.searchASaleOrAn": "Cari penjualan atau pengeluaran",
  "finance.searchOrderCode": "Cari kode order",
  "finance.source": "Sumber",
  "finance.spent": "Dibelanjakan",
  "finance.thisReplacesTheSaleAmount":
    "Ini menggantikan nilai penjualan di seluruh halaman ini, karena inilah yang benar-benar diterima toko",
  "finance.when": "Waktu",
  // The balance cards and the per-channel pending tables (owner ask
  // 2026-08-27).
  "finance.addCurrentBalance": "Tambah saldo saat ini",
  "finance.balance": "Saldo",
  "finance.balanceForPeriod": "Saldo per periode",
  // Dua kantong, sejak 2026-09-09: laci kas dan bank.
  "finance.bank": "Bank",
  "finance.cash": "Tunai",
  "finance.currentBalance": "Saldo saat ini",
  "finance.customRange": "Kustom",
  "finance.enterTheBalance": "Masukkan saldonya",
  "finance.includesOpening":
    "Termasuk saldo awal {{amount}} yang dicatat {{date}}.",
  "finance.noMoneyRecorded":
    "Belum ada yang tercatat. Mulai pembukuan dari uang yang dipegang usaha hari ini.",
  "finance.openingBank": "Di bank",
  "finance.openingCash": "Di laci kas",
  "finance.openingBalanceSaved":
    "Saldo awal tercatat — kartunya menghitung dari sana sekarang.",
  "finance.pendingChannelCount":
    "{{count}} penjualan · {{total}} menunggu penarikan",
  "finance.pendingChannelTitle": "Tertunda — {{channel}}",
  "finance.pendingNotCounted":
    "{{amount}} uang marketplace masih tertunda dan tidak dihitung.",
  "finance.pickARange": "Pilih dua tanggalnya di kalender.",
  "finance.recordBalanceOk": "Catat",
  "finance.setStartingBalance":
    "Tambah uang yang dipegang usaha sebelum aplikasi ini",
  "finance.startingBalanceBody":
    "Uang yang dipegang usaha saat ini, sebelum apa pun yang dicatat aplikasi ini. Hitung laci kas dan bank secara terpisah — setiap pemasukan dan pengeluaran setelahnya menggeser salah satunya.",
  "finance.startingBalanceTitle": "Catat saldo saat ini",
  "finance.today": "Hari ini",
  "finance.unassignedMoney":
    "{{amount}} berpindah lewat metode yang bukan tunai maupun bank.",
  // One unified table (owner ask 2026-09-21 malam).
  "finance.date": "Tanggal",
  "finance.type": "Jenis",
  "finance.description": "Keterangan",
  "finance.transactionId": "ID transaksi",
  "finance.amount": "Jumlah",
  "finance.status": "Status",
  "finance.latestBalance": "Saldo terkini",
  "finance.statusSettled": "Selesai",
  "finance.statusPending": "Tertunda",
  "finance.statusDue": "Jatuh tempo",
  "finance.statusUnpaidReturned": "Belum dibayar, diretur",
  "finance.statusPartPaidReturned": "Dibayar sebagian, diretur",
  "cashflow.kindSales": "Pemasukan dari penjualan",
  "cashflow.kindAdjustmentIn": "Penyesuaian pemasukan",
  "cashflow.kindExpense": "Pengeluaran",
  "cashflow.kindRefundOut": "Pengembalian",
  "cashflow.kindRefundIn": "Pengembalian diterima",
  "cashflow.refundOnSale": "Pengembalian atas transaksi {{code}}",
  "cashflow.saleDescription": "Penjualan lewat {{channel}}",
  "cashflow.searchOrderOrDescription":
    "Cari transaksi, keterangan, atau metode pembayaran",

  // ── Financial & Report — recording a spend ───────────────────────────
  "expense.add": "Tambah",
  "expense.amount": "Jumlah",
  "expense.category": "Kategori",
  "expense.channel": "Kanal",
  "expense.date": "Tanggal",
  "expense.expenseHistory": "Riwayat pengeluaran",
  "expense.linksThisSpendToThe":
    "Menghubungkan belanja ini dengan pelanggan yang mengaku datang dari kanal tersebut",
  "expense.note": "Catatan",
  "expense.noteOptional": "Catatan (opsional)",
  "expense.recordAnExpense": "Catat pengeluaran",
  "expense.searchExpenseOrNote": "Cari pengeluaran atau catatan",
  "expense.whatDoTheseCategoriesMean": "Apa arti kategori-kategori ini?",
  "expense.whatGoesInEachCategory": "Isi tiap kategori",
  "expense.whatWasItFor": "Untuk apa?",
  "expense.whichChannel": "Kanal mana?",

  // ── Financial & Report — transaction history ─────────────────────────
  // The 2026-09-08 split: money a marketplace holds and money a customer owes
  // are different facts and the shop chases a different party for each.
  "transactions.customersOwe": "Piutang pelanggan",
  "transactions.stSettled": "Lunas",
  "transactions.stPartPaid": "Dibayar sebagian",
  "transactions.stPending": "Ditahan marketplace",
  "transactions.stOwed": "Belum dibayar",
  "transactions.stUnpaidReturned": "Belum dibayar, diretur",
  "transactions.stPartPaidReturned": "Dibayar sebagian, diretur",
  "transactions.editPayments":
    "Riwayat pembayaran — catat, koreksi atau hapus pembayaran",
  "transactions.editPaymentsAria": "Pembayaran pada {{code}}",
  "transactions.payLogged": "{{n}} perubahan dicatat.",
  "transactions.payUnchanged": "Tidak ada yang berubah.",
  "transactions.channel": "Kanal",
  "transactions.exportAll": "Ekspor semua",
  "transactions.exportSelected": "Ekspor yang dipilih",
  "transactions.moneyInSettled": "Uang masuk (lunas)",
  "transactions.seeReceipt": "Lihat struk",
  "transactions.seeReceiptAria": "Struk untuk {{code}}",
  "transactions.status": "Status",
  "transactions.stillPending": "Masih tertunda",
  "transactions.transactionHistory": "Riwayat Transaksi",
  "transactions.transactions": "Transaksi",

  // ── Chatbot — the inbox ──────────────────────────────────────────────
  "chat.backToChats": "Kembali ke daftar chat",
  "chat.couldNotChangeThatSwitch": "Gagal mengubah saklar itu.",
  "chat.couldnTRefreshJustNow": "Gagal menyegarkan barusan",
  "chat.letTheBotAnswerThis": "Biarkan bot menjawab chat ini sendiri",
  "chat.messages": "Pesan",
  "chat.noChatsYetAnythingA":
    "Belum ada chat. Apa pun yang dikirim pelanggan lewat WhatsApp akan muncul di sini.",
  "chat.pickAChatOnThe": "Pilih chat di sebelah kiri.",
  "chat.send": "Kirim",
  "chat.showingTheLastChatsThat":
    "Menampilkan chat terakhir yang berhasil dimuat. Akan dicoba lagi beberapa detik lagi.",
  "chat.theBotIsAnsweringThis": "Bot menjawab chat ini lagi.",
  "chat.turnThisOffToAnswer":
    "Matikan untuk menjawab pelanggan ini sendiri. Chat lain tidak terpengaruh.",
  "chat.turnThisOnToLetThe": "Nyalakan agar bot menjawab pelanggan ini lagi.",
  "chat.typeYourReplyOrPress":
    "Ketik balasan Anda, atau tekan Tuliskan untuk saya lalu sunting hasilnya.",
  "chat.writeItForMe": "Tuliskan untuk saya",
  "chat.youReHandlingThisChat":
    "Anda yang menangani chat ini. Bot tidak akan membalas sendiri.",

  // ── Chatbot — the page frame ─────────────────────────────────────────

  // ── Chatbot — the knowledge base ─────────────────────────────────────
  "knowledge.active": "Aktif",
  "knowledge.add": "Tambah Tanya-Jawab",
  "knowledge.answer": "Jawaban",
  "knowledge.answerHint": "Jawaban resmi yang harus diberikan bot",
  "knowledge.anyState": "Semua status",
  "knowledge.edit": "Ubah Tanya-Jawab",
  "knowledge.off": "Nonaktif",
  "knowledge.on": "Aktif",
  "knowledge.question": "Pertanyaan",
  "knowledge.questionHint": "Yang biasa ditanyakan pelanggan",
  "knowledge.saved":
    "Pengetahuan tersimpan — agen memakainya pada balasan berikutnya.",
  "knowledge.search": "Cari pertanyaan atau jawaban",
  "knowledge.toggleAria": "Pakai jawaban ini",
  "knowledge.updated": "Diperbarui",

  // ── Customer ─────────────────────────────────────────────────────────
  "customers.addCustomer": "Tambah pelanggan",
  "customers.address": "Alamat",
  "customers.customers": "Pelanggan",
  "customers.edit": "Ubah",
  "customers.history": "Riwayat",
  "customers.knowsUsFrom": "Tahu dari",
  "customers.money": "Uang",
  "customers.name": "Nama",
  "customers.phoneNumber": "Nomor telepon",
  "customers.referral": "Referal",
  "customers.searchNameOrPhone": "Cari nama atau nomor telepon",
  "customers.total": "Total",
  "customers.totalSpend": "Total belanja",
  "customers.whereDoTheyKnowThe": "Dari mana mereka tahu toko ini?",

  // ── Settings ─────────────────────────────────────────────────────────
  "settings.active": "Aktif",
  "settings.add": "Tambah",
  "settings.address": "Alamat",
  "settings.addressOptional": "Alamat (opsional)",
  "settings.batteryBands": "Rentang baterai",
  "settings.batteryHealthBands": "Rentang kesehatan baterai",
  // The 2026-09-08 split. "Siklus" is the word the bench already uses for a
  // charge cycle — it is what System Information prints in Indonesian too.
  "settings.batteryEraHint":
    "Model 2020 ke bawah dicatat dengan siklus; 2021 ke atas dengan kesehatan.",
  "settings.cycleBands": "Rentang siklus baterai",
  "settings.cycleBandsHint":
    "Semakin sedikit siklus semakin bagus baterainya, jadi ini batas atas.",
  "settings.cyclesUnit": "siklus",

  // Marketplace pricing and fees (owner ask 2026-09-08). Two percentages
  // pointing opposite ways: one goes ON TOP of the store price to make a
  // listing, the other comes OFF a payout.
  "settings.tabMarketplace": "Marketplace",
  "settings.marketplacePricing": "Harga marketplace",
  "settings.listingMarkup": "Markup listing",
  // Settings keeps the address book; the money moved to its own page.
  "settings.supplierAccounts": "Invoice, deposit & utang",
  "settings.goodUpTo": "Bagus sampai",
  "settings.fairUpTo": "Cukup sampai",
  // Shop identity — printed on every faktur. Moved out of Invoice.tsx's
  // hard-coded `const SHOP` on 2026-09-02; the placeholders are the values the
  // receipt printed before and still falls back to, so they stay as written.
  "settings.shopIdentity": "Identitas toko",
  "settings.shopIdentityHint":
    "Dicetak di bagian atas setiap faktur. Kosongkan sebuah kolom untuk memakai nilai bawaan.",
  "settings.shopIdentitySaved": "Identitas toko disimpan.",
  "settings.shopName": "Nama",
  "settings.shopNameEg": "NUSANTARA",
  "settings.shopTagline": "Tagline",
  "settings.shopTaglineEg": "Apple bekas — penjualan, tukar tambah, dan servis",
  "settings.shopContact": "Kontak",
  "settings.shopContactEg": "WhatsApp +62 811 2233 44 · @nusantara",
  "settings.tabShop": "Identitas toko",
  "settings.customers": "Pelanggan",
  "settings.defaultWarehouse": "Gudang utama",
  "settings.eGFacebookMarketplace": "mis. Facebook Marketplace",
  "settings.eGGoogleMaps": "mis. Google Maps",
  "settings.eGRack4": "mis. Rak 4",
  "settings.editAddress": "Ubah alamat",
  "settings.editSupplier": "Ubah supplier",
  "settings.editSupplierAria": "Ubah {{name}}",
  "settings.supplierExists": "Supplier dengan nama itu sudah ada.",
  "settings.supplierSaved": "Supplier diperbarui.",
  "settings.save": "Simpan",
  "settings.nameIt": "Beri nama",
  "settings.editPhone": "Ubah nomor telepon",
  "settings.fullName": "Nama lengkap",
  "settings.location": "Lokasi",
  "settings.locationsInsideAWarehouse": "Lokasi di dalam gudang",
  "settings.myAccount": "Akun saya",
  "settings.name": "Nama",
  "settings.newWarehouseName": "Nama gudang baru",
  "settings.noReasonsOnThisList": "Belum ada alasan di daftar ini.",
  "settings.offered": "Ditawarkan di",
  "settings.openReturns": "Retur berjalan",
  "settings.phone": "Telepon",
  "settings.phoneOptional": "Telepon (opsional)",
  "settings.purchaseOrders": "Purchase order",
  "settings.racks": "Rak",
  "settings.reason": "Alasan",
  "settings.reasonsPerActivity": "Alasan per aktivitas",
  "settings.referralSources": "Sumber referal",
  "settings.rename": "Ganti nama",
  "settings.renumber": "Ubah nomor",
  "settings.warehouseNumber": "Nomor",
  "settings.codeEmpty": "Gudang harus punya nomor.",
  "settings.codeTaken": "Nomor {{code}} sudah dipakai gudang lain.",
  "settings.reservationChannels": "Kanal reservasi",
  "settings.reservations": "Reservasi",
  "settings.sales": "Penjualan",
  "settings.salespeople": "Sales",
  "settings.searchALocation": "Cari lokasi",
  "settings.searchAName": "Cari nama",
  "settings.searchSupplierPhoneOrAddress": "Cari supplier, telepon atau alamat",
  "settings.settings": "Pengaturan",
  "settings.stockInFromThisAccount": "Stok masuk dari akun ini ditaruh di sini",
  "settings.supplier": "Supplier",
  "settings.supplierName": "Nama supplier",
  "settings.suppliers": "Supplier",
  "settings.tabAccount": "Akun",
  "settings.tabBattery": "Rentang baterai",
  "settings.tabChannels": "Kanal",
  "settings.tabReasons": "Alasan",
  "settings.tabSalespeople": "Sales",
  "settings.tabScanner": "Scanner",
  "settings.tabSuppliers": "Supplier",
  "settings.tabWarehouses": "Gudang & lokasi",
  "settings.unitSold": "Unit Terjual",
  "settings.unitsHeld": "Unit dipegang",
  "settings.unitsOnIt": "Unit di dalamnya",
  "settings.unitsSold": "Unit terjual",
  "settings.usedBy": "Dipakai oleh",
  "settings.warehouse": "Gudang",
  "settings.warehouses": "Gudang",

  // ── Settings — grading configuration (owner ask 2026-08-27) ──────────
  "settings.gradingAddCriterion": "Tambah kriteria",
  "settings.gradingAddOption": "Tambah kondisi",
  "settings.gradingAddOptionAria": "Tambah kondisi ke {{name}}",
  "settings.gradingAddRule": "Tambah aturan",
  "settings.gradingAnyCondition": "Apa saja",
  "settings.gradingCatchAll": "cocok untuk semua unit",
  "settings.gradingCategory": "Kategori",
  "settings.gradingCheckEarlier": "Periksa lebih awal",
  "settings.gradingCheckLater": "Periksa belakangan",
  "settings.gradingConfiguration": "Konfigurasi grading",
  "settings.gradingCriteria": "Kriteria — {{category}}",
  "settings.gradingCriterionExists":
    "“{{name}}” sudah jadi kriteria untuk {{category}}.",
  "settings.gradingGrade": "Grade",
  "settings.gradingHowRulesRead":
    "Aturan diperiksa dari atas ke bawah; yang pertama cocok menang.",
  "settings.gradingHowRulesReadBody":
    "Sebuah aturan cocok bila unit yang diperiksa memenuhi semua syaratnya — kriteria yang dibiarkan “Apa saja” tidak diperiksa. Aturan tanpa syarat cocok untuk semua unit, jadi taruh paling bawah sebagai penampung.",
  "settings.gradingIntro":
    "Apa yang diperiksa QC per kategori, dan kombinasi mana yang menghasilkan tiap grade. Tombol grade di Barang Masuk & QC membaca ini — dan penilai selalu bisa menimpa hasilnya.",
  "settings.gradingMoveDownAria": "Turunkan aturan {{n}}",
  "settings.gradingMoveUpAria": "Naikkan aturan {{n}}",
  "settings.gradingNewCriterion": "Kriteria baru, mis. Keyboard",
  "settings.gradingNewCriterionAria": "Kriteria baru",
  "settings.gradingNoCriteria":
    "Belum ada yang diperiksa untuk kategori ini. Tambah kriteria — Layar, Bodi, Port…",
  "settings.gradingNoRules":
    "Belum ada grade yang didefinisikan, jadi dialog QC belum bisa menyimpulkan. Tambah satu aturan per grade.",
  "settings.gradingNotConfigured": "belum dikonfigurasi",
  "settings.gradingPickCategory": "Pilih kategori",
  "settings.gradingRemoveCriterion": "Hapus “{{name}}”?",
  "settings.gradingRemoveCriterionAria": "Hapus kriteria {{name}}",
  "settings.gradingRemoveCriterionBody":
    "Pilihannya ikut terhapus, dan setiap aturan yang menyebutnya berhenti memeriksanya. Grade yang sudah diberikan ke unit tidak berubah.",
  "settings.gradingRemoveRuleAria": "Hapus aturan {{n}}",
  "settings.gradingRules": "Grade — {{category}}",
  "settings.tabGrading": "Grading",

  // ── Settings — the barcode scanner ───────────────────────────────────
  "scanner.aFastRunShorterThan":
    "Rentetan cepat yang lebih pendek dari ini dianggap ketikan cepat, bukan hasil scan.",
  "scanner.aScannerIsAKeyboard":
    "Scanner itu keyboard. Baik jembatan HP Barcode to PC maupun scanner genggam mengetik serialnya lalu menekan Enter, jadi hasil scan tertangkap di mana pun Anda berada di aplikasi — tidak ada koneksi yang perlu diatur.",
  "scanner.acceptScans": "Terima hasil scan",
  "scanner.barcodeScanner": "Scanner barcode",
  "scanner.charactersArrivingCloserTogetherThan":
    "Karakter yang datang lebih rapat dari ini dianggap hasil scan. Makin kecil makin ketat. Naikkan kalau hasil scan terpotong.",
  "scanner.fastestAHandCanType": "Ketikan tangan tercepat (ms antar karakter)",
  "scanner.gapBetweenEachCharacterIn": "Jeda tiap karakter, berurutan:",
  "scanner.lost": "Klik untuk scan",
  "scanner.lostHint":
    "Fokus sedang di kolom lain, jadi hasil scan akan masuk ke sana. Klik untuk melepaskannya.",
  "scanner.noField": "Tidak ada kolom serial untuk difokuskan.",
  "scanner.noSerialHere":
    "{{serial}} discan — halaman ini tidak punya kolom serial.",
  "scanner.noSetupNeededOnThis": "Tidak perlu pengaturan di perangkat ini.",
  "scanner.noTarget": "Tidak ada yang menerima serial di sini.",
  "scanner.nothingScannedYet": "Belum ada yang discan.",
  "scanner.ready": "Scanner siap",
  "scanner.readyHint": "Scan barcode — hasilnya masuk ke kolom serial.",
  "scanner.shortestRunThatCountsAs":
    "Rentetan terpendek yang dianggap barcode (karakter)",
  "scanner.silenceThatMeansTheScan":
    "Jeda sunyi yang menandakan scan selesai (ms)",
  "scanner.someScannersSendNoEnter":
    "Sebagian scanner tidak mengirim Enter. Setelah sunyi selama ini, serialnya tetap dicatat.",
  "scanner.stray": "{{serial}} discan ke kolom lain.",
  "scanner.testAScan": "Coba scan",
  "scanner.turnOffToTypeSerials":
    "Matikan untuk mengetik serial dengan tangan tanpa scanner merebut ketikan.",
  "scanner.useIt": "Pakai",

  // ── Shell — the account menu ─────────────────────────────────────────
  "account.appearance": "Tampilan",
  "account.themeDark": "Gelap",
  "account.themeLight": "Terang",
  "account.themeSystem": "Ikuti sistem",

  // ── Shell — PageContainer ────────────────────────────────────────────
  "page.back": "Kembali",
  "page.actions": "Aksi halaman",

  // ── ProTable / DataTable ─────────────────────────────────────────────
  "proTable.clearFilters": "Bersihkan semua",
  // Adjustment: the receipt a category needs beside it (2026-09-23).
  "adjust.transaction": "Transaksi",
  "adjust.pickATransaction": "Pilih transaksi yang dimaksud.",
  "adjust.searchTransaction": "Cari nomor order, referensi, atau serial",

  // Edit transaction (owner ask 2026-09-23).
  "editSale.title": "Ubah transaksi — {{code}}",
  "editSale.save": "Simpan",
  "editSale.saved": "Transaksi diperbarui.",
  "editSale.ref": "ID Referensi",
  "editSale.refPlaceholder": "Nomor order marketplace",
  "editSale.date": "Tanggal",
  "editSale.channel": "Kanal",
  "editSale.customer": "Pelanggan",
  "editSale.units": "Unit",
  "editSale.unit": "Unit",
  "editSale.unitFor": "Unit",
  "editSale.pickUnit": "Pilih unit",
  "editSale.serial": "Nomor seri",
  "editSale.serialFor": "Nomor seri",
  "editSale.addLine": "Tambah unit",
  "editSale.removeLine": "Keluarkan unit ini",
  "editSale.payment": "Pembayaran",
  "editSale.duplicateSerial": "Serial yang sama ada di dua baris.",
  "editSale.unknownSerial": "Tidak ada unit dengan serial {{serial}}.",
  "editSale.alreadySold": "{{serial}} sudah ada di transaksi lain.",
  "editSale.swapWarning":
    "Unit yang dikeluarkan kembali ke stok, dan transaksi ini hilang dari riwayatnya.",

  // Income & Expense: type, category, method and the two bases.
  "finance.category": "Kategori",
  "finance.method": "Metode pembayaran",
  "finance.expense": "Pengeluaran",
  "finance.cashBasis": "Basis kas",
  "finance.accrual": "Akrual",

  // The payment grid's three columns (owner ask 2026-09-23).
  "pay.status": "Status",
  "pay.refFor": "Nomor referensi",
  "pay.refPlaceholder": "Nomor referensi",

  // Pending Payment: reference its own column now.
  "piutang.refNo": "Nomor referensi",

  // One chip per picked filter, each with its own ×.
  "proTable.removeFilter": "Hapus {{filter}}",

  // Transaction History (owner ask 2026-09-23).
  "transactions.referenceId": "ID Referensi",
  "transactions.serialNumber": "Nomor seri",
  "transactions.editSale": "Ubah transaksi",
  "transactions.editSaleAria": "Ubah {{code}}",
  "transactions.markSettled": "Tandai sudah diterima",
  "transactions.settledCount": "{{count}} transaksi ditandai diterima.",
  // Inventory's unit popup: price change and edit unit (owner ask 2026-09-23).
  "inventory.priceChange": "Ubah harga",
  "inventory.priceChangeAria": "Ubah harga {{serial}}",
  "inventory.editUnit": "Ubah unit",
  "inventory.editUnitAria": "Ubah {{serial}}",

  // The adjustment dialog's two halves, headed the same way.
  "stock.serialisedProducts": "Produk berserial",
  "stock.noCounted": "Belum ada produk hitungan di batch ini.",
  "stock.qty": "Jumlah",

  // Inbound — a counted product's sell price (owner ask 2026-09-24).
  "inbound.sellPriceOfLine": "Harga jual {{product}}",
  "inbound.sellPriceFirst":
    "Isi harga jual dulu sebelum mengonfirmasi kedatangan.",

  // Edit one row of the Stock Movement History (owner ask 2026-09-24).
  "stockHistoryEdit.title": "Ubah pergerakan stok",
  "stockHistoryEdit.save": "Simpan",
  "stockHistoryEdit.saved": "Pergerakan stok diperbarui.",
  "stockHistoryEdit.gone": "Pergerakan ini sudah tidak ada di riwayat.",
  "stockHistoryEdit.reasonRequired": "Pergerakan perlu alasan.",
  "stockHistoryEdit.batteryOutOfRange": "Pembacaan baterai di luar rentang.",
  "stockHistoryEdit.type": "Jenis",
  "stockHistoryEdit.by": "Oleh",
  "stockHistoryEdit.product": "Produk",
  "stockHistoryEdit.serial": "Serial",
  "stockHistoryEdit.qty": "Jumlah",
  "stockHistoryEdit.qtyFixed":
    "Jumlahnya ada di buku stok dan tidak bisa diubah di sini. Catat penyesuaian lain untuk mengoreksinya.",
  "stockHistoryEdit.when": "Waktu",
  "stockHistoryEdit.reason": "Alasan",
  "stockHistoryEdit.description": "Deskripsi",
  "stockHistoryEdit.battery": "Baterai",
  "stockHistoryEdit.unitFollows":
    "Deskripsi dan baterai unit ikut dikoreksi selama masih sama dengan yang dicatat pergerakan ini.",

  // Edit unit.
  "unitEdit.title": "Ubah unit",
  "unitEdit.save": "Simpan",
  "unitEdit.saved": "Unit diperbarui.",
  "unitEdit.serial": "Nomor seri",
  "unitEdit.serialRequired": "Unit harus punya nomor seri.",
  "unitEdit.serialTaken": "{{serial}} milik unit lain.",
  "unitEdit.grade": "Grade",
  "unitEdit.gradeNew": "Baru",
  "unitEdit.battery": "Baterai",
  "unitEdit.warehouse": "Gudang",
  "unitEdit.rack": "Rak",
  "unitEdit.description": "Deskripsi",
  "unitEdit.unitPrice": "Harga unit",
  "unitEdit.movedNote": "Dipindahkan dari Inventaris",
  // The combined return history (owner ask 2026-09-23).
  "returns.type": "Jenis",
  "returns.document": "Transaksi / inbound",
  "returns.date": "Tanggal",
  "returns.party": "Supplier / pelanggan",
  "returns.reason": "Alasan",
  // Koreksi dan penarikan retur (permintaan pemilik 2026-09-25).
  "returns.reasonDetail": "Keterangan tambahan",
  "returns.conditionOf": "Kondisi {{serial}}",
  "returns.withdrawn": "Ditarik",
  "returns.editReturn": "Koreksi",
  "returns.editReturnAria": "Koreksi retur {{code}}",
  "returns.editTitle": "Koreksi {{code}}",
  "returns.saveEdit": "Simpan koreksi",
  "returns.editSaved": "Retur sudah dikoreksi.",
  "returns.undoReturn": "Tarik retur ini",
  "returns.undoReturnAria": "Tarik retur {{code}}",
  "returns.undoTitle": "Tarik retur ini?",
  "returns.undoOk": "Tarik",
  "returns.undoBody":
    "{{code}} tetap ada di riwayat dengan tanda ditarik, dan semua unit di dalamnya kembali ke posisi sebelum retur. Transaksinya kembali berutang sebesar nilai retur. Uang yang sudah dikembalikan tetap tercatat keluar — tagih sendiri atau perbaiki pembayarannya.",
  "returns.undone": "{{code}} sudah ditarik.",
  "returns.undoDoneAlready": "Retur ini sudah ditarik.",
  "returns.undoUnitMoved":
    "Ada unit di retur ini yang sudah terjual, dibooking, atau dipindahkan. Batalkan dari tempatnya sekarang.",
  "returns.undoMarketplace":
    "Retur ini membatalkan uang yang ditahan marketplace, dan tidak ada catatan bagian mana yang dipotong. Perbaiki pembayaran transaksinya saja.",
  "returns.undoExchange":
    "Retur ini adalah tukar unit. Uang pelanggan sudah berpindah ke transaksi lain, jadi tidak bisa dikembalikan otomatis.",
  "returns.undoBooksClosed":
    "Transaksinya ada di periode yang sudah ditutup. Buka dulu bukunya.",
  "returns.product": "Produk",
  "returns.serial": "Nomor seri",
  "returns.condition": "Kondisi",
  "returns.searchHistory": "Cari transaksi, faktur, nama, atau alasan",

  "proTable.narrowed": "Menampilkan {{shown}} dari {{total}}",
  // A column's date-range filter (2026-09-22).
  "proTable.dateFrom": "Dari",
  "proTable.dateUntil": "Sampai",
  "proTable.dateReset": "Atur ulang",
  "proTable.dateDone": "OK",

  // ── ProTable / DataTable ─────────────────────────────────────────────
  "dataTable.range": "{{from}}–{{to}} dari {{total}}",

  // ── EditableTable ────────────────────────────────────────────────────
  // "Baris" is the word for a row on a form the shop already fills in on
  // paper; it names the card the stacked layout draws when the grid does not
  // fit. The keycaps in `orPress` are not translated — see the head of this
  // file.
  "editableTable.line": "Baris {{n}}",
  "editableTable.orPress": "atau tekan {{keys}}",
  "editableTable.empty": "Belum ada isinya.",

  // ── SkuPicker ────────────────────────────────────────────────────────
  "skuPicker.pick": "Cari kode atau nama model",

  // ── UnitTimeline ─────────────────────────────────────────────────────
  "timeline.scanOrSelectASerial":
    "Scan atau pilih serial untuk melihat riwayatnya.",

  // ── Common ───────────────────────────────────────────────────────────
  "common.edit": "Ubah",

  // ── Retired page titles still reached by a redirect ──────────────────
  "stockOut.title": "Stok Keluar",

  // ── English source strings — the key IS the English ──────────────────
  "Lost / written off": "Hilang / dihapusbukukan",
  "Return from customer": "Retur dari pelanggan",
  "Return to supplier": "Retur ke supplier",
  "Stock adjustment": "Penyesuaian stok",
  "the unit is away at a repairer and is expected back":
    "unitnya sedang di tukang servis dan diharapkan kembali",
  "the unit is gone: shrinkage, damaged beyond sale, taken for internal use":
    "unitnya hilang: susut, rusak tak layak jual, dipakai sendiri",

  // ── Second translation pass (2026-08-26) ─────────────────────────────────
  // Column headers and option labels the first sweep could not see: it
  // matched object literals only at the end of a line, so anything written
  // inline — { title: "What", dataIndex: "what" } — and anything shorter
  // than three characters ("In", "On") slipped past it. `i18n.test.ts` now
  // fails on an unwrapped label rather than relying on someone spotting an
  // English word in an Indonesian table.
  "customers.order": "Order",
  "customers.orders": "Order",
  "customers.phone": "Telepon",
  "customers.serials": "Serial",
  "customers.when": "Waktu",
  "discount.allProducts": "Semua produk",
  "discount.bundlePrice": "Harga bundel",
  "discount.fixedAmountOff": "Potongan nominal tetap",
  "discounts.on": "Aktif",
  "discounts.order": "Order",
  "expense.expense": "Pengeluaran",
  "expense.guide": "Panduan",
  "finance.expenses": "Pengeluaran",
  "finance.in": "Masuk",
  "finance.income": "Pemasukan",
  "finance.kind": "Jenis",
  "finance.net": "Bersih",
  "finance.order": "Order",
  "finance.pending": "Tertunda",
  "finance.what": "Untuk apa",
  "inbound.noPaymentsRecorded": "Belum ada pembayaran tercatat.",
  "inbound.ordered": "Dipesan",
  "inbound.supplier": "Supplier",
  "inboundForm.noProductsYetThatIs": "Belum ada produk — itu diperbolehkan.",
  "pos.amount": "Nominal",
  "pos.discountCode": "Kode diskon",
  "pos.holdUntil": "Ditahan sampai",
  "pos.none": "Tidak ada",
  "pos.serial": "Serial",
  "products.model": "Model",
  "products.noStockHasEverBeen":
    "Belum pernah ada stok padanya, jadi tidak ada yang hilang.",
  "reservations.note": "Catatan",
  "reservations.serial": "Serial",
  "returnCustomer.serial": "Serial",
  "returnSupplier.code": "Kode",
  "returnSupplier.serial": "Serial",
  "returns.fromCustomer": "Dari pelanggan",
  "returns.toSupplier": "Ke supplier",
  "settings.channel": "Kanal",
  "settings.source": "Sumber",
  "snTracking.buyPrice": "Harga beli",
  "snTracking.by": "Oleh",
  "snTracking.from": "Dari",
  "snTracking.to": "Ke",
  "snTracking.when": "Waktu",
  "stock.by": "Oleh",

  // Module constants keyed by their English — `statusOf` in DiscountsPage and
  // RANGES in CashflowPage, both translated at their render sites.
  Off: "Nonaktif",
  Expired: "Kedaluwarsa",
  Scheduled: "Terjadwal",
  "Used up": "Habis terpakai",
  Running: "Berjalan",
  "7 days": "7 hari",
  "30 days": "30 hari",
  "90 days": "90 hari",

  // ── FillGuideModal ────────────────────────────────────────────────────────
  "fill.guide.title": "Mengisi banyak sel sekaligus",
  "fill.guide.progress": "{{current}} dari {{total}}",
  "fill.guide.select.title": "Pilih sel mana saja",
  "fill.guide.select.body":
    "Tahan Ctrl (⌘ di Mac) lalu klik untuk menambahkan sel ke pilihan. " +
    "Sel-selnya tidak harus berada di kolom yang sama. Ketik sekali dan " +
    "semua sel yang terpilih akan terisi nilai itu.",
  "fill.guide.range.title": "Atau satu blok sekaligus",
  "fill.guide.range.body":
    "Klik satu sel, lalu Shift-klik sel lain. Semua yang ada di antara kedua " +
    "sudut itu ikut terpilih — melebar antar kolom, bukan hanya turun ke " +
    "bawah.",
  "fill.guide.enter.title": "Enter turun ke bawah",
  "fill.guide.enter.body":
    "Enter turun ke baris berikutnya dan menyorot isi yang sudah ada, jadi " +
    "angka berikutnya langsung menggantikannya. Di baris terakhir, Enter " +
    "menambah satu baris baru dan masuk ke sana.",
  "fill.guide.enterUp.title": "Shift-Enter kembali ke atas",
  "fill.guide.enterUp.body":
    "Jalan yang sama tapi terbalik, untuk baris yang baru saja terlewat. " +
    "Berhenti di baris teratas — tidak berputar ke bawah, dan tidak pernah " +
    "menambah baris.",
  "fill.guide.arrows.title": "Atau tahan Alt dan pakai tombol panah",
  "fill.guide.arrows.body":
    "Tahan Alt (⌥ atau ⌘ di Mac) bersama ↑ atau ↓ untuk berpindah persis " +
    "seperti Enter. Tombol panah tanpa Alt milik kotak angka, yang menaikkan " +
    "dan menurunkan nilainya di tempat.",
  "fill.guide.tab.title": "Tab menyeberang baris",
  "fill.guide.tab.body":
    "Tab pindah ke kolom berikutnya dalam satu baris dan Shift-Tab kembali, " +
    "lalu lanjut ke baris di bawahnya. Apa pun yang tadi terpilih menyusut ke " +
    "sel tempat Anda mendarat, jadi Tab juga cara halus keluar dari pilihan.",
  "fill.guide.escape.title": "Esc membatalkan pilihan",
  "fill.guide.escape.body":
    "Esc melepas pilihan sekaligus kursornya. Klik biasa melakukan hal yang " +
    "sama dengan lebih halus — pilihan menyusut kembali ke satu sel yang Anda " +
    "klik.",

  // ── Revision round 2026-08-26 ───────────────────────────────────────────
  // Inbound: the Order & payment grid, the Purchase card, the Rp/% discount,
  // the empty product list, and the per-serial photo at QC.
  "inbound.photo": "Foto",
  "inbound.purchase": "Pembelian",
  "inbound.total": "Total",
  "inboundForm.discountPercent": "Persentase diskon",
  "inboundForm.noProductsYet":
    "Belum ada produk. Tambahkan produk atau buat PO tanpa produk.",
  "inboundForm.paidNowHint": "Kosongkan jika belum ada uang yang ditransfer.",
  "inboundForm.pctOfSubtotal": "{{pct}}% dari {{sub}}",
  "inboundForm.purchase": "Pembelian",
  "inboundForm.total": "Total",

  // Stok opname: menyimpan sendiri, dan bilang sudah tersimpan.
  "opname.photo": "Foto",
  "opname.saveDraftHint":
    "Hitungan tersimpan otomatis sambil jalan — ini menyimpannya sekarang.",
  "opname.savedAt": "Draf tersimpan {{time}}",
  "opname.savedNothingYet": "Draf tersimpan",
  "opname.saving": "Menyimpan…",
  "opname.unsaved": "Ada perubahan belum tersimpan",

  // Foto per serial — diambil saat QC, dibaca saat opname.
  "photos.add": "Tambah foto",
  "photos.addHint": "Foto kondisi {{serial}}",
  "photos.added": "{{count}} foto ditambahkan ke {{serial}}.",
  "photos.alt": "Foto {{serial}}",
  "photos.more": "{{count}} lagi",
  "photos.none": "Tidak ada foto",
  "photos.notAnImage": "{{name}} bukan gambar.",
  "photos.remove": "Hapus foto ini",
  "photos.removed": "Foto dihapus.",
  "photos.tooBig": "{{name}} terlalu besar — batasnya 6MB.",

  // Kasir: saldo marketplace, dan daftar diskon lengkap dengan syaratnya.
  "pos.allProducts": "Semua produk",
  "pos.balanceNotReleased": "Saldo belum cair dari {{channel}}",
  "pos.balanceNotReleasedBody":
    "Setelah saldo cair, konfirmasi jumlah dan pencairan saldo di halaman " +
    "“Pemasukan & Pengeluaran”. Tidak ada metode pembayaran yang perlu dipilih di sini.",
  "pos.blockBundleShort":
    "Tambah {{need}} unit lagi dari “{{scope}}” untuk melengkapi paketnya.",
  "pos.blockEmptyBasket":
    "Tambahkan unit ke penjualan dulu — diskon butuh sesuatu untuk dipotong.",
  "pos.blockEnded": "Sudah berakhir pada {{date}}.",
  "pos.blockInactive": "Sedang dimatikan. Nyalakan lagi di halaman Diskon.",
  "pos.blockNoSaving": "Berlaku, tapi tidak memotong apa pun di keranjang ini.",
  "pos.blockNotStarted": "Baru mulai berlaku {{date}}.",
  "pos.blockOutOfScope":
    "Tidak ada barang dari “{{scope}}” di penjualan ini. Tambahkan satu dan diskonnya berlaku.",
  "pos.blockUsedUp":
    "Kuota {{limit}} pemakaian sudah habis. Naikkan batasnya di halaman Diskon.",
  "pos.bundleLanding":
    "{{count}} × {{code}} atas {{units}} unit yang memenuhi syarat — potongan {{saving}}. " +
    "Paket mengambil unit termahal lebih dulu.",
  "pos.holdsCollected": "{{count}} unit yang ditahan sudah diambil.",
  "pos.loadedFromHold": "{{count}} unit dimuat dari {{code}}.",
  "pos.marketplacePendingToast":
    "Marketplace belum mencairkan dananya — tandai diterima di Saldo Tertahan & Piutang setelah dananya masuk.",
  // ── New Transaction — the till, rebuilt 2026-08-27 ───────────────────────
  // The catalogue on the left, the basket and all of the money on the right,
  // and everything about the PEOPLE in an optional second step. "Keranjang"
  // over "Basket" and "Ongkir" over "Pengiriman" throughout: these are the
  // words the shop already says at the counter.
  "pos.addDiscount": "Tambah diskon",
  "pos.addTradeIn": "Tambahkan",
  "pos.allCategories": "Semua",
  "pos.allOnThisSale": "Semua unit ini sudah masuk transaksi ini.",
  "pos.amountOff": "Potong {{amount}}",
  "pos.backToTill": "Kembali ke kasir",
  "pos.basket": "Keranjang",
  "pos.basketEmpty":
    "Keranjang masih kosong. Pilih produk di sebelah kiri, atau scan serialnya.",
  "pos.belowCost": "di bawah modal",
  "pos.bundleWorth":
    "{{count}} paket isi {{per}}, potongan {{saving}}. Belum diterapkan.",
  "pos.channel": "KANAL",
  "pos.closesHolds": "Transaksi ini menutup {{count}} reservasi.",
  "pos.deliveryFee": "Ongkir",
  "pos.deliveryFeeHint":
    "Ditagihkan ke pelanggan dan masuk ke total. Kolom yang sama dengan biaya tambahan di keranjang.",
  "pos.detailsOptional": "Semua di halaman ini opsional",
  "pos.detailsOptionalBody":
    "Pelanggan datang langsung dan bayar tunai tidak butuh satu pun — tekan saja Bayar & selesaikan di atas. Isi yang memang ada.",
  "pos.detailsStep": "Detail",
  "pos.hideDetails": "Sembunyikan detail",
  "pos.discountAmount": "Nominal diskon",
  "pos.done": "Selesai",
  "pos.emptyLine": "baris kosong",
  "pos.extra": "Biaya tambahan",
  "pos.extraAmount": "Nominal biaya tambahan",
  "pos.extraCharge": "Biaya tambahan",
  "pos.extraPlaceholder": "Biaya tambahan (mis. ongkir)",
  "pos.footerInfo": "{{count}} unit · Total {{total}}",
  "pos.fromReservations": "Reservasi ({{count}})",
  "pos.fromWhatIsOnTheShelf":
    "Dari stok yang ada dan dari yang biasa dibeli bersamaan",
  "pos.heldForSomeone":
    "Sedang ditahan untuk pelanggan. Menjualnya di sini melepas reservasinya.",
  "pos.itemCount": "{{count}} unit",
  "pos.linePrice": "Harga untuk {{serial}}",
  "pos.linesBelowCost": "{{count}} baris dijual di bawah modal.",
  "pos.listPrice": "harga {{price}}",
  "pos.loadFromHold": "Ambil unit dan pelanggan dari reservasi",
  "pos.noNote": "Belum ada catatan QC",
  "pos.noneLeft": "Habis",
  "pos.nothingOnHold": "Tidak ada yang sedang ditahan",
  "pos.onHold": "Ditahan",
  "pos.optionalStep": "Opsional",
  "pos.payAndFinish": "Bayar & selesaikan",
  "pos.paymentUpper": "PEMBAYARAN",
  "pos.pctOff": "Potong {{pct}}%",
  "pos.pickACode": "Pilih kode",
  "pos.pickAria": "Pilih {{serial}}",
  "pos.pickAUnit": "Belum ada unit",
  "pos.pickFrom": "Pilih {{product}}",
  "pos.pickFromGrade": "Pilih {{product}}, grade {{grade}}",
  "pos.searchSerial": "Cari serial",
  "pos.noSerialMatches": "Tidak ada unit di sini dengan serial seperti itu.",
  "pos.pickThisOne": "Pilih",
  "pos.qualifiesFor": "Keranjang ini memenuhi syarat {{code}}",
  "pos.recordAtALoss": "Catat walau rugi",
  "pos.remaining": "Sisa {{count}}",
  "pos.removeLineAria": "Hapus {{serial}}",
  "pos.removeTradeIn": "Hapus tukar tambah {{label}}",
  "pos.searchOrScan":
    "Cari produk / varian — atau ketik atau scan serial, langsung masuk keranjang",
  "pos.searchShelf": "Cari stok",
  "pos.namedNotSellable": "{{serial}} tidak bisa dijual — statusnya",
  "pos.stockCatalogue": "Katalog stok",
  "pos.storeDiscount": "Diskon toko",
  "pos.subtotal": "Subtotal",
  "pos.total": "Total",
  "pos.tradeCredit": "Tukar tambah",
  "pos.tradeIn": "Trade-in (tukar tambah / beli unit pelanggan)",
  "pos.tradeInTitle": "Ambil unit pelanggan sebagai potongan",
  "pos.tradeSerial": "Serial",
  "pos.tradeSerialHint":
    "Kosongkan kalau tokonya tidak mengambil unitnya — potongannya tetap masuk, tapi tidak ada unit yang tercatat.",
  "pos.tradeSerialPlaceholder": "Scan atau ketik",
  "pos.tradeSerialTaken": "{{serial}} sudah dipakai unit lain di sistem.",
  "pos.tradeValue": "Nilai tukar tambah",
  "pos.tradeValueHint":
    "Memotong yang dibayar pelanggan, dan menjadi modal unitnya kalau masuk stok.",
  "pos.tradeValueRequired": "Isi nilai yang diberikan tokonya.",
  "pos.tradeWhat": "Unitnya apa?",
  "pos.tradeWhatHint":
    "Tulis dengan kata-kata — bisa jadi bukan varian yang toko ini jual. Yang mem-QC nanti yang menentukan produknya.",
  "pos.tradeWhatPlaceholder": "mis. MacBook Air 2017 8/128, lecet",
  "pos.tradeWhatRequired": "Sebutkan unitnya apa.",
  "pos.transactionMargin": "Margin transaksi",
  "pos.whichMachine": "Unit yang mana?",
  "pos.whoBought": "Pelanggan",
  "pos.whoSold": "Atribusi",
  "pos.willBeSavedAs": "Akan disimpan sebagai:",
  "pos.noDiscountsAtAll": "Belum ada diskon yang dibuat.",
  "pos.nothingLeftOnHold": "Tidak ada unit reservasi itu yang masih ditahan.",
  "pos.units": "Unit",

  // Reservasi: satu baris per pelanggan, isinya bisa banyak unit.
  "reservations.addReservation": "Tambah reservasi",
  "reservations.checkOutSelected": "Jual {{count}}",
  "reservations.heldN": "{{count}} unit sekarang ditahan.",
  "reservations.heldOfTotal": "sisa {{held}} dari {{total}}",
  "reservations.notePlaceholder":
    "Kapan diambil, apa yang diminta, hal lain yang perlu diketahui orang berikutnya",
  "reservations.pickedCount":
    "{{picked}} dari {{held}} unit yang ditahan dipilih",
  "reservations.release": "Lepas",
  "reservations.releaseBody":
    "{{units}} langsung kembali ke stok yang siap dijual.",
  "reservations.releaseSelected": "Lepas yang dipilih",
  "reservations.releasedN": "{{count}} unit kembali ke stok.",
  "reservations.selectAllAria": "Pilih semua unit yang masih ditahan",
  "reservations.selectAria": "Pilih {{serial}}",
  "reservations.units": "Unit",

  // Row actions that became icons on 2026-08-26. The aria-label carries the
  // sentence the button text used to, and names the record it acts on.
  "customers.editAria": "Ubah {{name}}",
  "customers.deleteBlocked":
    "Pelanggan ini punya transaksi dan tidak bisa dihapus.",
  "customers.historyAria": "Riwayat pembelian {{name}}",
  "inbound.rejectAria": "Retur {{serial}} ke supplier",
  "inbound.rejectHint": "Tolak unitnya dan buka retur ke supplier",
  "inbound.serviceAria": "Kirim {{serial}} ke servis",
  "inbound.serviceHint": "Kirim ke meja servis, bukan ke rak",
  "knowledge.editAria": "Ubah “{{question}}”",

  // ── Revision round 2026-08-28 ───────────────────────────────────────────
  //
  // Five owner asks: the New/Second condition, the grade shown wherever a
  // serial is, QC at the return desk, the barcode rules and the label page
  // setup, and hiding an AppleDB model instead of marking it.

  // The grade, wherever one is shown. "Baru" is the shop's own word for
  // sealed stock; the letters are letters in both languages.
  "grade.new": "Baru",
  "grade.newHint":
    "Tersegel — belum pernah dipakai, jadi tidak ada yang diperiksa",
  "grade.letterHint": "Grade kondisi dari checklist QC",
  "grade.ungraded": "Tidak ada",

  // The grading checklist, now shared by QC and the return desk.
  "grading.title": "Nilai unit ini",
  "grading.currently": "sekarang {{grade}}",
  "grading.noConfig": "Belum ada pengaturan untuk “{{category}}”",
  "grading.noConfigBody":
    "Pengaturan → Grading adalah tempat sebuah kategori mendapat checklist-nya. Sementara itu, pilih hurufnya sendiri di bawah.",
  "grading.notChecked": "Belum diperiksa",
  "grading.calculated": "Hasil hitung",
  "grading.noneYet": "isi checklist-nya, atau pilih sendiri",
  "grading.override": "Timpa",
  "grading.useCalculated": "Pakai hasil hitung",
  "grading.cTitle": "Grade C — pikirkan lagi",
  "grading.cBody":
    "Unit seaus ini biasanya lebih baik dikembalikan ke supplier atau dikirim ke servis daripada ditaruh di rak.",
  "grading.apply": "Terapkan grade",
  "grading.applyN": "Terapkan grade {{grade}}",

  // Inbound & QC — the condition toggle and the barcode rules.
  "inbound.condition": "Kondisi",
  "inbound.conditionNew": "Baru",
  // "Second" is what the shop says in Indonesian too — "seken" is the spoken
  // form, "bekas" the written one. The written one goes on a form.
  "inbound.conditionSecond": "Bekas",
  "inbound.describeOptional": "Opsional untuk unit baru",
  "inbound.descriptionRequiredHint":
    "Wajib sebelum unit bekas bisa diterima. Opsional untuk unit baru — tidak ada yang perlu dijelaskan dari dus tersegel.",
  "inbound.scanTooShort":
    "Hasil scan cuma {{n}} karakter. Barcode serial itu {{min}}–{{max}}; coba scan lagi.",
  "inbound.scanTooLong":
    "Hasil scan {{n}} karakter. Barcode serial itu {{min}}–{{max}} — dua scan masuk ke satu kolom bisa begini.",
  "inbound.scanCharset":
    "“{{scanned}}” bukan serial — hanya huruf kapital dan angka. Pastikan scanner disetel ke {{symbology}} dan ini memang barcode unitnya.",
  "inbound.scanNoPrefix":
    "“{{scanned}}” tidak diawali S, berarti itu salah satu barcode lain di bagian bawah unit. Arahkan ke barcode yang nomornya diawali S.",
  "inbound.scanNoSupplierCode":
    "{{supplier}} belum punya kode dua huruf, jadi serial hasil scan tidak bisa didaftarkan atas namanya. Pengaturan → Supplier tempat memberinya kode.",
  "inbound.thisSupplier": "Supplier ini",

  // The grade column, wherever a serial is listed.
  "inventory.grade": "Grade",
  "snTracking.grade": "Grade",
  "reservations.grade": "Grade",

  // Printing labels — page setup and the barcode.
  "labels.title": "Cetak label — {{count}} serial",
  "labels.nothingSelected": "Tidak ada yang dipilih untuk dicetak.",

  // What the print dialog says about a serial it will not encode. Two levels:
  // an error stops the run, a warning prints anyway — see `inspectStoredSerial`.
  "labels.cannotPrintTitle": "{{count}} label tidak bisa dicetak",
  "labels.cannotPrintBody":
    "Perbaiki dulu serialnya di unit — stiker yang kodenya tidak cocok dengan tulisan di bawahnya lebih buruk daripada tidak ada stiker sama sekali.",
  "labels.checkTitle": "{{count}} serial terlihat janggal",
  "labels.checkBody":
    "Semua ini tetap tercetak dan terbaca dengan benar. Ada baiknya dicek ulang ke unitnya sebelum stikernya ditempel.",
  "labels.faultEmpty": "tidak punya serial untuk dikodekan",
  "labels.faultUnencodable": "ada karakter yang tidak bisa dibawa barcode",
  "labels.faultCharset": "ada karakter selain huruf kapital dan angka",
  "labels.faultConfusable":
    "ada huruf I atau O, yang tidak pernah dicetak Apple",
  "labels.faultLength": "panjangnya bukan {{min}}–{{max}} karakter",
  "labels.blankSerial": "(kosong)",
  "labels.andMore": "…dan {{count}} lagi",
  "labels.blockedToast": "Ada serial yang tidak bisa dikodekan. Perbaiki dulu.",
  "labels.print": "Cetak",
  "labels.close": "Tutup",

  // AppleDB import — hide, not "not selling".
  "products.hide": "Sembunyikan",
  "products.unhide": "Tampilkan",
  "products.hideAria": "Sembunyikan {{name}}",
  "products.unhideAria": "Tampilkan {{name}}",
  "products.hideHint":
    "Keluarkan model yang tidak dijual toko ini dari daftar, supaya update AppleDB berikutnya langsung terbaca. Tidak ada yang dihapus — sakelar di atas mengembalikan yang disembunyikan.",
  "products.unhideHint": "Kembalikan ke daftar impor",
  "products.hiddenToast": "{{name}} disembunyikan.",
  "products.unhiddenToast": "{{name}} kembali ke daftar.",
  "products.showHidden": "Tampilkan yang disembunyikan",
  "products.showHiddenN": "Tampilkan yang disembunyikan ({{count}})",

  // The return desk — QC on the way back in.
  "returnCustomer.receive": "Terima",
  "returnCustomer.receiveHint":
    "Buka QC — jelaskan kondisinya dan beri grade, lalu kembalikan ke stok",
  "returnCustomer.receiveAria": "Terima kembali {{serial}}",
  "returnCustomer.wasNewTitle": "Unit ini keluar dalam kondisi baru",
  "returnCustomer.wasNewBody":
    "Unit sudah terjual dan dibuka, jadi kembali ke rak sebagai bekas. Jelaskan kondisinya saat kembali, dan beri grade kalau bisa.",
  "returnCustomer.conditionBack": "Kondisi saat kembali",
  "returnCustomer.conditionPlaceholder":
    "Lecet, kelengkapan dus, keluhan pelanggan…",
  "returnCustomer.newGrade": "Grade baru",
  "returnCustomer.gradePlaceholder": "Grade",
  "returnCustomer.gradeIt": "Beri grade",
  "returnCustomer.gradeOptional": "Opsional — bisa kembali ke rak tanpa grade.",
  "returnCustomer.restock": "Kembalikan ke stok",
  "returnCustomer.describeBeforeRestock":
    "Jelaskan dulu kondisinya saat kembali sebelum ditaruh di rak.",
  "returnCustomer.backInStock": "Unit sudah kembali ke stok siap jual.",

  // Settings — the supplier's two-letter serial code.

  // ── 2026-09-01 revision: adjustments, the dark nav, the opname scope
  //    editor and delete, and the reshaped till. ──
  "adjust.addAdjustment": "Tambah penyesuaian",
  "adjust.amount": "Jumlah",
  "adjust.amountRp": "Jumlah (Rp)",
  "adjust.channel": "Kanal",
  "adjust.date": "Tanggal",
  "adjust.enterTheAmount": "Isi jumlahnya.",
  "adjust.expense": "Pengeluaran",
  "adjust.expenseRecorded": "Pengeluaran tercatat.",
  "adjust.guide": "Panduan",
  "adjust.history": "Riwayat penyesuaian",
  "adjust.income": "Pemasukan",
  "adjust.incomeReasonHint":
    "Transfer menambah saldo tanpa menjadi pendapatan.",
  "adjust.incomeRecorded": "Pemasukan tercatat.",
  "adjust.linksThisSpend":
    "Menghubungkan pengeluaran ini dengan pelanggan yang bilang datang dari kanal tersebut",
  "adjust.method": "Cara uang berpindah",
  "adjust.methodHint":
    "Tunai menggeser laci kas; transfer atau kartu menggeser bank.",
  "adjust.note": "Catatan",
  "adjust.notePlaceholder":
    "Opsional — ini untuk apa, dengan kata-kata Anda sendiri",
  "adjust.pickADate": "Pilih tanggalnya.",
  "adjust.pickAMethod": "Pilih cara uang berpindah.",
  "adjust.pickAReason": "Pilih alasannya.",
  "adjust.reason": "Alasan",
  "adjust.record": "Catat",
  "adjust.searchReasonOrNote": "Cari alasan atau catatan",
  "adjust.type": "Jenis",
  "adjust.what": "Untuk apa",
  "adjust.whatGoesInEach": "Isi tiap kategori",
  "adjust.whatGoesWhere": "Apa saja isi tiap kategori?",
  "adjust.whichChannel": "Kanal yang mana?",
  "finance.addAdjustment": "Tambah penyesuaian",
  "finance.allChannelsPending": "Semua kanal · {{total}}",
  "finance.channelPendingOption":
    "{{channel}} · {{total}} dari {{count}} penjualan",
  "finance.kindExpense": "Pengeluaran",
  "finance.kindIncome": "Pemasukan",
  "finance.kindSale": "Penjualan",
  "finance.pendingTitle": "Tertahan — menunggu penarikan",
  "finance.whichMarketplace": "Marketplace yang mana",
  "inbound.acceptAll": "Terima semua ({{count}})",
  "inbound.acceptAllBody":
    "Semuanya langsung masuk stok siap jual. Unit yang deskripsinya belum diisi tidak ikut, dan unit mana pun masih bisa dikembalikan ke QC setelahnya.",
  "inbound.acceptAllDone": "{{count}} unit diterima ke stok.",
  "inbound.acceptAllHint":
    "Masukkan semua unit yang sudah dinilai di faktur ini ke stok siap jual",
  "inbound.acceptAllNoneReady":
    "Belum ada yang siap. Unit second wajib punya deskripsi sebelum bisa diterima.",
  "inbound.acceptAllOk": "Terima semuanya",
  "inbound.acceptAllTitle": "Terima {{count}} unit?",
  "inbound.batteryHealth": "Kesehatan Baterai",
  "inbound.cancel": "Batal",
  "nav.newTransaction": "Transaksi Baru",
  "opname.allFound": "Lengkap",
  "opname.applyScope": "Terapkan",
  "opname.countedQty": "Terhitung",
  "opname.difference": "Selisih",
  "opname.editScope": "Ubah cakupan",
  "opname.editScopeHint":
    "Ubah apa yang dihitung. Yang sudah discan tidak hilang.",
  "opname.editScopeTitle": "Ubah cakupan penghitungan ini",
  "opname.expectedNothing":
    "Tidak ada unit di dalam cakupan ini. Perluas cakupannya, atau semua serial yang Anda scan akan terbaca tidak terduga.",
  "opname.expectedQty": "Seharusnya",
  "opname.scopeChangeBody":
    "Memperluas cakupan menambah unit yang diharapkan ada; mempersempitnya mengurangi. Serial yang sudah Anda scan tapi berada di luar cakupan baru tidak dihapus — ia tetap ada di daftar sebagai Milik lokasi lain, karena memang ada orang yang membacanya dari unit.",
  "opname.scopeChangeTitle": "Semua yang sudah discan tetap tersimpan",
  "opname.scopeUpdated": "Cakupan diperbarui. Tidak ada hitungan yang hilang.",
  "opname.shortBy": "kurang {{count}}",
  "opnameList.deleteAria": "Hapus hitungan {{code}}",
  "opnameList.deleteBody":
    "Ini membuang hitungan beserta semua yang sudah discan ke dalamnya. Statusnya masih draft, jadi tidak ada unit yang tersentuh — tapi tidak ada yang bisa dikembalikan.",
  "opnameList.deleteHint": "Hapus draft hitungan ini",
  "opnameList.deleteOk": "Hapus",
  "opnameList.deleteRefused":
    "Hitungan itu sudah diposting sejak dialog ini dibuka. Hitungan yang sudah diposting tidak bisa dihapus.",
  "opnameList.deleteScanned": "{{count}} serial sudah discan.",
  "opnameList.deleteTitle": "Hapus hitungan ini?",
  "opnameList.deleteToConfirm": "untuk mengonfirmasi.",
  "opnameList.deleteTypeAria": "Ketik nomor referensinya untuk mengonfirmasi",
  "opnameList.deleteTypeIt": "Ketik",
  "opnameList.deleted": "{{code}} dihapus.",
  "opnameList.untitled": "Hitungan tanpa nama",
  "opnameScope.allCategories": "Semua kategori",
  "opnameScope.allConditions": "New dan second",
  "opnameScope.allRacks": "Semua rak",
  "opnameScope.allWarehouses": "Semua gudang",
  "opnameScope.categories": "Kategori produk",
  "opnameScope.categoriesHint": "Kosongkan untuk menghitung semua kategori.",
  "opnameScope.condition": "Kondisi",
  "opnameScope.conditionHint": "Kosongkan untuk menghitung new maupun second.",
  "opnameScope.conditionNew": "New",
  "opnameScope.conditionSecond": "Second",
  "opnameScope.narrowed":
    "Hanya unit yang cocok dengan semua kriteria yang Anda pilih.",
  "opnameScope.racks": "Rak",
  "opnameScope.racksHint":
    "Kosongkan untuk semua rak di gudang tersebut. Menyebut rak berarti unit yang masih di QC tidak ikut, karena belum ada di rak mana pun.",
  "opnameScope.warehouses": "Gudang",
  "opnameScope.warehousesHint": "Kosongkan untuk menghitung semua gudang.",
  "opnameScope.wholeShop": "Semua unit yang dimiliki toko.",
  "pos.addedToSale": "{{serial}} ditambahkan ke transaksi.",
  "pos.additionalFee": "Biaya tambahan",
  "pos.addressStillNeeds": "Alamat pengiriman masih kurang: {{fields}}.",
  "pos.addressWillBeRemembered":
    "Alamat baru disimpan ke pelanggan ini saat transaksi dicatat.",
  "pos.alreadyOnSale": "{{serial}} sudah ada di transaksi ini.",
  "pos.alreadyOnThisSale": "{{count}} di transaksi ini: {{serials}}",
  "pos.bargain": "Nego",
  "pos.bargainOf": "turun {{amount}}",
  "pos.bargained": "Nego",
  "pos.cannotBeSold": "{{serial}} berstatus {{status}} — tidak bisa dijual.",
  "pos.channelAndPayment": "Kanal & metode pembayaran",
  "pos.clearDiscount": "Lepas kodenya",
  "pos.close": "Tutup",
  "pos.comingOff": "−{{amount}}",
  "pos.customerAdded": "{{name}} ditambahkan.",
  "pos.customerDetail": "Detail pelanggan",
  "pos.feeAmount": "Jumlah",
  "pos.feeCategory": "Untuk apa",
  "pos.feeCategoryHint":
    "Pilih salah satu, atau ketik sendiri. Ini tercetak di invoice di sebelah nominalnya.",
  "pos.feePlaceholder": "mis. Ongkir",
  "pos.inspectAria": "Detail harga untuk {{serial}}",
  "pos.inspectLine": "Harga list, harga jual sekarang, dan marginnya",
  "pos.listPriceLabel": "Harga asli",
  "pos.margin": "Margin",
  "pos.marginOfRevenue":
    "Margin dihitung dari harga jual, bukan dari modal — konvensi yang dipakai laporan laba rugi.",
  "pos.moneyOffTheBill": "Diskon & tukar tambah",
  "pos.negotiateOnTheLine":
    "Harga yang dinego di kasir bukan diskon — ketik langsung di baris keranjang, dan tercatat sebagai nego.",
  "pos.noCustomer": "Tidak dicatat",
  "pos.notAUnit": "{{serial}} bukan unit yang kami kenal.",
  "pos.nothingOff": "Tidak ada potongan",
  "pos.oneFeeOnly":
    "Satu biaya bernama per transaksi. Transaksi yang butuh dua memerlukan tabel OrderFee seperti purchase order punya.",
  "pos.pickASavedAddress": "Kirim ke alamat yang tersimpan",
  "pos.pickAtLeastOne": "Pilih minimal satu unit dari inventori.",
  "pos.priceDetail": "Detail harga",
  "pos.reservationPickerHint":
    "Memilih salah satu akan memuat unit dan pelanggannya ke transaksi di bawah. Reservasi baru dilepas saat transaksi dicatat, bukan sekarang.",
  "pos.saleRecorded": "Transaksi tercatat.",
  "pos.savedAddress": "Alamat tersimpan",
  "pos.savedAddressHint":
    "Atau biarkan kosong dan isi kolom di bawah untuk alamat baru.",
  "pos.sellPrice": "Harga jual",
  "pos.unattributed": "Belum ada nama",
  "pos.upsell": "Dijual di atas list",
  "pos.upsellCredit":
    "{{amount}} di atas harga list pada transaksi ini menjadi kredit untuk mereka.",
  "pos.upsellOf": "{{amount}} di atas list",
  "pos.upsold": "Upsell",
  "pos.whatWePaid": "Modal toko",
  "pos.worthOffering": "Layak ditawarkan bersama transaksi ini",
  "settings.upsell": "Upsell",
  "trade.add": "Tambahkan",
  "trade.allowance": "Nilai tukar",
  "trade.allowanceHint":
    "Mengurangi yang dibayar pelanggan, dan menjadi modal unit ini kalau masuk stok.",
  "trade.allowanceRequired": "Isi berapa yang toko berikan untuk unit ini.",
  "trade.category": "Kategori",
  "trade.condition": "Kondisi",
  "trade.new": "New",
  "trade.note": "Catatan",
  "trade.notePlaceholder": "Apa pun yang perlu diketahui QC",
  "trade.product": "Produk",
  "trade.scanOrType": "Scan atau ketik",
  "trade.searchProduct": "Cari produk atau varian",
  "trade.second": "Second",
  "trade.serial": "Serial",
  "trade.serialHint":
    "Nomor yang tercetak di unitnya. Unit baru {{min}}–{{max}} karakter; unit second diterima apa adanya. Unit masuk QC dengan serial ini, persis seperti unit dari purchase order.",
  "trade.serialTaken": "{{serial}} sudah menjadi milik unit yang kami punya.",
  "trade.title": "Tukar Tambah",
  "trade.what": "Unit apa ini?",
  "trade.whatHint":
    "Dengan kata-kata, sebagaimana akan terbaca di invoice — lecetnya dan umurnya, bukan cuma modelnya.",
  "trade.whatPlaceholder": "mis. MacBook Air 2017 8/128, lecet di lid",
  "trade.whatRequired": "Sebutkan unit apa ini.",
  "trade.withSerialNote":
    "Dengan serial, unit masuk QC dengan nilai tukar sebagai modalnya. Tanpa serial, hanya uangnya yang mengurangi tagihan.",
  Sales: "Penjualan",
  "Account transfer": "Transfer antar rekening",
  Refund: "Pengembalian",
  "Takings this app did not record — an off-app sale, or an old till.":
    "Pemasukan yang tidak dicatat aplikasi ini — penjualan di luar aplikasi, atau kasir lama.",
  "Money moved in from another account of the business. Not revenue — it raises the balance without being a sale.":
    "Uang yang dipindahkan dari rekening lain milik usaha. Bukan pendapatan — menambah saldo tanpa menjadi penjualan.",
  "The customer paid extra on a dearer exchange. Written by the return form so a return's cash side shows on Income & Expense.":
    "Pelanggan membayar lebih pada tukar tambah yang lebih mahal. Ditulis form retur agar sisi uang dari retur muncul di Pemasukan & Pengeluaran.",
  "Money handed back to a customer after a return or an exchange. Written by the return form; keep to it so the balance and the return history cannot disagree.":
    "Uang yang dikembalikan ke pelanggan setelah retur atau tukar tambah. Ditulis form retur; jangan diubah agar saldo dan riwayat retur tidak berbeda.",
  "Shopping bag": "Tas belanja",
  Installation: "Pemasangan",
  "Extended warranty": "Perpanjangan garansi",
  "Data transfer": "Pemindahan data",

  // ── 2026-09-01: the machine's two barcodes — Apple's and the shop's. ──
  "inbound.scanAmbiguous":
    "“{{scanned}}” terbaca sebagai kedua barcode sekaligus — kode supplier yang diawali S membuat panjangnya sama. Dibaca sebagai barcode Apple. Cocokkan serialnya dengan unitnya.",
  "inbound.scanLandedOriginal": "{{serial}} tercatat — {{product}}.",
  "inbound.scanNoMarker":
    "“{{scanned}}” tidak diawali S. Arahkan scanner ke barcode yang nomornya diawali S.",
  "scanner.ambiguousRead": "Hasil scan ini adalah kedua barcode sekaligus.",
  "scanner.ambiguousReadWhy":
    "Kode supplier yang diawali S membuat panjang keduanya sama. Dibaca sebagai barcode Apple — cocokkan serialnya dengan unitnya.",
  "scanner.notInStock": "Belum ada unit dengan serial ini",
  "scanner.notASerialBarcode": "Bukan barcode serial",
  "scanner.serialBarcode": "Barcode serial",
  "scanner.inStockAs": "Ada di stok sebagai {{serial}}",
  "scanner.notASerialBarcodeWhy":
    "Barcode serial adalah S ditambah 10–12 karakter. Unit baru hanya diterima dari barcode ini; barcode unit second diterima apa adanya.",
  "scanner.originalBarcodeRead": "Serial {{serial}}",
  "serial.hasStoreBarcode": "Barcode toko",
  "serial.hasStoreBarcodeWhy":
    "Serial ini membawa kode asal supplier, jadi stiker toko sendiri bisa discan kembali ke unit ini.",
  "serial.noStoreBarcode": "Belum ada barcode toko",
  "serial.noStoreBarcodeWhy":
    "Serial Apple polos tanpa kode asal. Tidak ada yang salah — stok yang masuk sebelum sistem kode ini memang begini — tapi hanya barcode Apple sendiri yang bisa menemukannya.",

  // ── 2026-09-01, second pass: the barcode rules restated, the two-step
  //    till, repeatable fees and the fuller trade-in. ──
  "inbound.scanEmpty": "Tidak ada yang discan.",
  "inbound.scanLength":
    "“{{scanned}}” terdiri dari {{n}} karakter. Barcode unit baru adalah S lalu {{min}}–{{max}} karakter — hasil terlalu pendek berarti scanner terangkat terlalu cepat, terlalu panjang berarti dua scan tanpa Enter di antaranya.",
  "inbound.serialCharset":
    "“{{serial}}” mengandung selain huruf kapital dan angka.",
  "inbound.serialNoMarker":
    "“{{serial}}” tidak diawali S. Barcode unit baru selalu punya S — scanner-nya terarah ke kode regulasi atau part number di sebelahnya.",
  "inbound.serialHintBare": "{{min}}–{{max}} karakter",
  "inbound.serialShape":
    "“{{serial}}” terdiri dari {{n}} karakter. Barcode unit baru adalah S lalu {{min}}–{{max}} karakter.",
  "inbound.serialLengthTyped":
    "“{{serial}}” terdiri dari {{n}} karakter. Serial unit baru {{min}}–{{max}} karakter.",
  "inbound.serialHintGrade": "Pilih grade untuk mencatatnya",
  "inbound.serialWaitsForGrade":
    "{{serial}} disimpan — pilih grade unitnya dan serial langsung tercatat.",
  "inbound.regradeSerialCheck":
    "{{serial}} diterima sebagai serial unit second. Serial unit baru {{min}}–{{max}} karakter tanpa S — kalau yang ini tidak begitu, perbaiki di kotak serial.",
  "inbound.serialHintMarker": "Harus diawali S",
  "inbound.serialHintCharset": "Hanya huruf kapital dan angka",
  "inbound.serialHintLength": "S lalu {{min}}–{{max}} karakter",
  "pos.addFee": "Tambah biaya",
  "pos.backToProducts": "Kembali ke produk",
  "pos.continue": "Lanjut",
  "pos.noFeesYet":
    "Tidak ada biaya tambahan di transaksi ini. Tambahkan biaya untuk ongkir, tas, pemasangan — apa pun yang dibayar pelanggan di luar unitnya.",
  "pos.paymentDetailHint":
    "Tidak ada yang wajib di sini — transaksi bisa diselesaikan dari panel di sebelahnya.",
  "pos.removeFee": "Hapus biaya ini",
  "pos.removeFeeAria": "Hapus biaya {{n}}",
  "pos.seeFewer": "Tampilkan lebih sedikit",
  "pos.seeMore": "Lihat {{count}} lagi",
  "pos.severalCharges": "{{count}} biaya",
  "trade.bought": "Dibeli seharga",
  "trade.description": "Deskripsi",
  "trade.descriptionPlaceholder": "mis. MacBook Air 2017 8/128, lecet di lid",
  "trade.descriptionRequired": "Jelaskan unitnya — lecet dan umurnya.",
  "trade.gradeRequired": "Pilih grade — A, B atau C.",
  "trade.gradeLabel": "Grade",
  "trade.gradePlaceholder": "A, B atau C",
  "trade.configureGrade": "Atur grade",
  "trade.checklistNeedsCategory":
    "Checklist-nya per kategori — pilih kategorinya, atau produknya.",
  "trade.pickCategory": "Pilih kategori",
  "trade.productRequired":
    "Pilih produknya — unit dicatat di bawah produk itu.",
  "trade.price": "Harga",
  "trade.priceHint":
    "Mengurangi yang dibayar pelanggan, dan menjadi modal unit ini saat masuk stok.",
  "trade.priceRequired": "Isi berapa yang toko bayar untuk unit ini.",
  "trade.serialRequired": "Scan atau ketik serial unitnya.",
  "trade.serialScanNoMarker":
    "Itu bukan barcode nomor seri — satu Mac punya beberapa barcode. Cari yang tercetak di bawah huruf S.",
  "trade.serialShape":
    "“{{serial}}” bukan serial unit baru. Ketik {{min}}–{{max}} karakter yang tercetak di unitnya, atau scan barcode-nya.",

  // ── 2026-09-01: the till's two steps and its confirmation. ──
  "pos.belowCostBody":
    "Kadang memang disengaja — menghabiskan stok mati, menepati janji. Mencatatnya tidak masalah; yang tidak boleh adalah lewat tanpa disadari.",
  "pos.confirmCancel": "Belum",
  "pos.confirmOk": "Catat",
  "pos.confirmTitle": "Catat transaksi ini?",
  "pos.itemsLabel": "Unit",
  "pos.nextSale": "Transaksi berikutnya",
  "pos.printInvoice": "Cetak invoice",
  "pos.recordedSubtitle": "{{code}} · {{total}} · {{count}} unit",
  "pos.recordedTitle": "Transaksi tercatat",
  "pos.addProduct": "Tambah produk",

  // ── 2026-09-02: strings that were English-only until the review. ──
  // Three groups, one cause each: antd validation messages passed as bare
  // strings, the recommender's reasons (which used to be sentences built in
  // `lib/recommend.ts`, where no `t()` is in scope), and the discount shapes
  // (same, in `lib/pricing.ts`).
  "form.nameIt": "Beri nama",
  "form.nameThem": "Beri nama",
  "form.atLeastOne": "Minimal satu",
  "form.pickCustomer": "Pilih pelanggan",
  "form.pickUnit": "Pilih minimal satu unit",
  "form.pickSource": "Datang dari mana?",
  "form.pickTime": "Pilih waktu",
  "form.enterReceived": "Isi jumlah yang diterima",
  "form.sayWhatHappened": "Tuliskan apa yang sebenarnya terjadi",

  "pos.suggestCompletesBundle":
    "Menambahkan ini melengkapi {{code}} — {{name}}.",
  "pos.whyStepUp":
    "{{step}} lebih mahal dari {{name}} {{variant}} di transaksi ini.",
  "pos.whyModelRule":
    "{{pct}}% penjualan sebelumnya untuk barang di keranjang ini juga mengambil salah satu dari ini.",
  "pos.whyCategoryRule":
    "Dibeli bersama {{category}} pada {{count}} transaksi sebelumnya.",
  "pos.whyNoHistory":
    "Cocok dipasangkan dengan {{products}} di transaksi ini — belum ada nota yang memuat keduanya.",

  "reservations.noUnitMatch": "Tidak ada unit yang cocok.",
  "reservations.moreUnits":
    "{{count}} unit lain cocok — ketik lagi untuk mempersempit.",

  // Written INTO the ledger, not merely shown — see the call site.
  "pos.ledgerBargain":
    "Nego di {{code}}: {{from}} → {{to}} (transaksi ini saja)",
  "pos.ledgerUpsell":
    "Naik harga di {{code}}: {{from}} → {{to}} (transaksi ini saja)",
  "pos.ledgerTradeIn": "Tukar tambah di {{code}}: {{label}}",

  "discounts.shapePct": "{{pct}}%",
  "discounts.shapePctCapped": "{{pct}}% maksimal {{max}}",
  "discounts.shapeNominal": "Potongan {{amount}}",
  "discounts.shapeBundle": "{{qty}} apa saja seharga {{price}}",

  // The store on PostgreSQL (2026-09-13) — components/StoreGate.tsx.
  "store.loading": "Memuat data toko…",
  "store.loadFailed": "Data toko tidak bisa dimuat",
  "store.retry": "Coba lagi",
  "store.notSaved": "Tidak tersimpan — {{reason}}",
  "store.offline":
    "Offline — {{count}} perubahan menunggu disimpan. Perubahan tetap ada dan dikirim begitu koneksi kembali.",

  // ── B2Soft migration (2026-09-13) ─────────────────────────────────────────
  // `SALE_CHANNELS` label, run through t() at the till's chips.
  Other: "Lainnya",
  "customers.oldDebtLabel": "Piutang lama (sebelum aplikasi)",
  "customers.oldDebtHint":
    "Utang pelanggan dari sebelum aplikasi ini, tanpa penjualan di sini. Dicatat sekali dan ditambahkan ke sisa tagihan penjualannya.",
  "customers.oldDebt": "Piutang dari sebelum aplikasi ini",
  "customers.oldDebtSince": "{{amount}} per {{date}}",
  "piutang.fromBefore": "Dari sebelum aplikasi ini",
  "piutang.editOldDebt": "Koreksi di data pelanggan",
  "piutang.editOldDebtAria": "Buka {{name}} di Pelanggan",

  // ── Trade-in cost breakdown (2026-09-15) ──────────────────────────────────
  "pos.purchasePrice": "Harga beli",
  "pos.purchaseShippingTax": "Ongkir & pajak pembelian",
  "pos.repairsPaid": "Biaya servis",

  // ── The keyboard (2026-09-15) — components/KeyboardShortcutsModal.tsx ─────
  "keyboard.title": "Pintasan papan ketik",
  "keyboard.groupFields": "Saat mengisi",
  "keyboard.groupGrids": "Tabel baris barang",
  "keyboard.groupLists": "Daftar",
  "keyboard.groupAnywhere": "Di mana saja",
  "keyboard.keySpace": "Spasi",
  "keyboard.enter":
    "Kolom berikutnya. Di kolom terakhir sebuah dialog, langsung mengonfirmasi; di tempat lain, berhenti di tombol simpan.",
  "keyboard.tab":
    "Kontrol berikutnya atau sebelumnya, termasuk tombol dan sakelar",
  "keyboard.escape": "Menutup daftar pilihan atau dialog",
  "keyboard.gridUpDown": "Kolom yang sama, satu baris ke atas atau ke bawah",
  "keyboard.gridLeftRight":
    "Sel sebelumnya atau berikutnya, setelah kursor sampai di ujung teks",
  "keyboard.addRow": "Tambah baris",
  "keyboard.listUpDown": "Baris sebelumnya atau berikutnya",
  "keyboard.listHomeEnd": "Baris pertama atau terakhir di halaman daftar ini",
  "keyboard.listOpen": "Buka baris yang sedang disorot",
  "keyboard.search": "Lompat ke kotak pencarian halaman ini",
  "keyboard.help": "Tampilkan daftar ini",
  "keyboard.stays":
    "Enter diam di tempat setelah pemindaian, supaya hasil pindai tetap masuk ke kotak yang dituju — begitu juga di kotak pencarian, dan di kotak yang baru saja menolak isiannya.",

  // ── Inbound & QC, revised 2026-09-15 ──────────────────────────────────────
  // The header is editable, the payments are a ledger you can correct, and
  // "Stage" became a payment status.
  "inbound.paymentStatus": "Status pembayaran",
  "inboundList.paymentStatus": "Status pembayaran",
  Open: "Belum dibayar",
  Draft: "Draf",
  Ordered: "Dipesan",
  "inbound.orderStatus": "Status pesanan",
  "inbound.pickSupplier": "Pilih pemasok",
  "inbound.invoiceNumber": "Nomor faktur dari pemasok",
  "inbound.noInvoice": "Tanpa faktur",
  "inbound.noInvoiceAria": "Pemasok tidak menerbitkan faktur",
  "inbound.unreceiveTitle": "Tandai pesanan ini belum tiba?",
  "inbound.unreceiveBody":
    "Serial & QC dibangun dari pesanan yang sudah tiba, jadi bagian itu hilang sampai pesanan ditandai tiba lagi. Unit yang sudah diterima tetap membawa serial, grade, dan riwayatnya.",
  "inbound.unreceiveOk": "Tandai belum tiba",
  "inbound.productsInInvoice": "Produk dalam faktur",
  "inbound.editAPayment": "Ubah pembayaran ini",
  "inbound.editPayment": "Ubah pembayaran ini",
  "inbound.editPaymentAria": "Ubah pembayaran {{amount}}",
  "inbound.saveChanges": "Simpan perubahan",
  "inbound.paymentUpdated": "Pembayaran diperbarui.",
  "inbound.delete": "Hapus",
  "inbound.deletePayment": "Hapus pembayaran ini",
  "inbound.deletePaymentAria": "Hapus pembayaran {{amount}}",
  "inbound.deletePaymentTitle": "Hapus pembayaran ini?",
  "inbound.deletePaymentBody":
    "{{amount}} untuk {{what}} berhenti dihitung pada faktur ini, dan sisa tagihan naik sebesar itu. Catat lagi kalau memang benar dibayar.",
  "inbound.paymentDeleted": "Pembayaran dihapus.",
  "inbound.depositPaymentLocked":
    "Dibayar dari deposit — perbaiki di akun pemasok, supaya uangnya kembali ke deposit.",
  "inbound.pickMethod": "Bagaimana uangnya berpindah",
  "inbound.pickAMethod": "Sebutkan dulu bagaimana uangnya berpindah.",
  "inbound.methodNeededForAmount":
    "Nominal butuh metode — saldo harus tahu uangnya keluar dari laci atau dari bank.",
  "inboundList.deleteOrder": "Hapus pesanan ini",
  "inboundList.deleteTitle": "Hapus {{code}}?",
  "inboundList.deleteBody":
    "Baris dan pembayarannya berhenti dihitung. Uang yang sudah dibayar tetap ada di akun pemasok.",
  "inboundList.deleteBodyWithUnits":
    "Baris dan pembayarannya berhenti dihitung, dan {{count}} unit yang masih menunggu di QC ikut terhapus. Uang yang sudah dibayar tetap ada di akun pemasok.",
  "inboundList.delete": "Hapus",
  "inboundList.deleted": "{{code}} dihapus.",
  "inboundList.cannotDeleteTitle": "{{code}} tidak bisa dihapus",
  "inboundList.cannotDeleteBody":
    "{{count}} unit di dalamnya sudah keluar dari QC: {{serials}}. Faktur adalah satu-satunya catatan modal sebuah unit, jadi selesaikan dulu unit-unit itu — buka lagi QC-nya, atau keluarkan lewat penyesuaian stok.",

  // ── The order form's auto-save and draft (2026-09-15) ─────────────────────
  "inboundForm.cancel": "Batal",
  "inboundForm.back": "Kembali",
  "inboundForm.saveDraft": "Simpan draf",
  "inboundForm.draftSaved":
    "Tersimpan sebagai draf. Sudah ada di daftar Inbound — lanjutkan kapan saja.",
  "inboundForm.saved": "Pesanan tersimpan.",
  "inboundForm.savedNoProducts":
    "Pesanan tersimpan. Tambahkan produknya dari halaman pesanan saat barangnya tiba.",
  "inboundForm.restoredTitle": "Dilanjutkan dari yang terakhir diketik",
  "inboundForm.restoredBody":
    "Pesanan ini masih diketik saat halaman terakhir ditutup. Belum ada yang tersimpan ke Inbound — tekan Simpan draf untuk itu.",
  "inboundForm.startFresh": "Mulai pesanan baru",

  // ── Counting by quantity (2026-09-15) — accessories have no serial ────────
  "opname.byQuantityTitle": "Dihitung per jumlah",
  "opname.byQuantityOf": "{{count}} produk",
  "opname.byQuantityHint":
    "Barang-barang ini tidak punya serial untuk dipindai. Isi berapa banyak yang benar-benar ada di rak — kosongkan kalau belum dihitung, dan isi 0 kalau sudah dicek dan memang tidak ada.",
  "opname.foundQty": "Ada berapa?",
  "opname.foundQtyAria": "Ada berapa {{product}}",
  "opname.notCountedYet": "belum dihitung",
  "opname.addCountedProduct": "Tambah produk yang belum ada di daftar ini",
  "opname.countedByQty":
    "{{product}} dihitung per jumlah — isi angkanya di kartu Dihitung per jumlah.",
  "opname.note": "Catatan",
  "opname.countNoteAria": "Kenapa jumlah {{product}} berbeda",
  "opname.countNotePlaceholder": "Kenapa berbeda?",
  "opname.overBy": "{{count}} lebih",
  "opname.needCountNotes": "{{count}} produk dengan selisih perlu catatan",
  "opname.needCountNotesBody":
    "Rak yang isinya berbeda dari catatan sistem perlu satu baris penjelasan sebelum stock opname bisa diposting.",
  "opname.postBodyCounted":
    "{{count}} produk yang dihitung per jumlah tidak cocok: stoknya dikoreksi sesuai hasil hitung.",
  "opname.countSurplusReason": "Ditemukan saat stock opname",

  // ── Categories tracked by serial, or counted (2026-09-15) ────────────────
  "settings.tabCategories": "Kategori produk",
  "settings.category": "Kategori",
  "settings.categoryProducts": "Produk",
  "settings.trackedBySerial": "Dilacak per serial",
  "settings.trackedBySerialLocked":
    "{{count}} masih di stok. Jual, retur, atau keluarkan lewat penyesuaian dulu sebelum mengubah cara kategori ini dicatat.",
  "settings.trackedBySerialAria": "Lacak {{name}} per serial",
  "settings.categoryTrackingTitle": "Produk mana yang punya serial",
  "settings.categoryTrackingBody":
    "Kategori yang dilacak dikenali satu per satu: QC menanyakan serialnya, dan stock opname memindai tiap unit. Kategori yang dihitung tidak — aksesoris tidak punya serial yang bisa dibaca siapa pun, jadi QC menerimanya tanpa serial dan stock opname menjawab dengan angka. Unit yang sudah ada di stok tetap memakai serial yang sudah dimilikinya.",
  "settings.countedNow": "Dihitung per jumlah: {{names}}",
  "inbound.countedItem": "Dihitung — tanpa serial",
  "inbound.countedOnAccept": "Dihitung — tidak perlu serial",
  "inbound.takeInCounted": "Terima",
  "inbound.takeInCountedAria": "Terima satu {{product}}",
  "inbound.takenIn": "Sudah masuk. Terima ke stok kalau sudah selesai.",

  // ── The nav collapses by hand (2026-09-15) ───────────────────────────────
  "nav.collapse": "Ciutkan menu",
  "nav.expand": "Lebarkan menu",

  // ── Rows a keyboard can reach (2026-09-15) ───────────────────────────────
  "inboundList.openOrder": "Buka {{code}}",
  "opnameList.openCount": "Buka {{code}}",
  "discounts.openDiscount": "Buka {{name}}",

  // ── Inbound: invoice, units, QC dialog and expenses (2026-09-18) ────────
  "inbound.invoiceSection": "Barang masuk",
  "inbound.invoiceSummary": "{{products}} produk · {{units}} unit · {{total}}",
  "inbound.invoiceEmpty": "Belum ada produk",
  "inbound.invoiceNoLines":
    "Belum ada apa pun di invoice ini. Tambahkan setiap produk yang ditagih supplier di bawah.",
  "inbound.invoiceReceived": "{{count}} diterima",
  "inbound.invoiceBilled": "{{amount}} ditagihkan",
  "inbound.invoicePriceVaries":
    "Setiap unit punya harganya sendiri — ubah di daftar di bawah.",
  "inbound.invoiceRemove": "Hapus dari invoice",
  "inbound.invoiceRemoveAria": "Hapus {{product}}",
  "inbound.invoiceRemoveBlocked":
    "Unit produk ini sudah ada yang diterima. Hapus serialnya dulu.",
  "inbound.invoiceRemoveTitle": "Hapus {{product}} dari invoice?",
  "inbound.invoiceRemoveBody":
    "Semua unitnya keluar dari invoice. Kalau supplier menagihnya tapi tidak pernah mengirim, tandai unitnya Tidak datang saja — dengan begitu tetap tercatat di invoice.",
  "inbound.noProductYet": "baris yang belum dipilih produknya",
  "inbound.unitPrice": "Harga satuan",
  "inbound.notArrivedCount": "{{count}} tidak datang",
  "inbound.addProductAria": "Produk yang ditambahkan",
  "inbound.addQtyAria": "Berapa unit",
  "inbound.addCostAria": "Harga satuan tiap unit",
  "inbound.addCostPlaceholder": "Harga satuan (opsional)",
  "inbound.addUnits": "Tambah {{count}} unit",
  "inbound.addHint":
    "Setiap unit dapat barisnya sendiri di daftar di bawah, mulai dari harga ini — ubah salah satunya di sana dan yang lain tidak ikut berubah.",
  "inbound.qtyRefused":
    "Hanya unit yang belum punya serial yang bisa dikeluarkan dari invoice. Hapus serial yang sudah di-scan dulu, atau tandai unitnya Tidak datang.",
  // The invoice as one line per product (owner ask 2026-09-20).
  "inbound.cogs": "HPP",
  "inbound.lineDiscount": "Diskon",
  "inbound.lineDiscountOf": "Diskon untuk {{product}}",
  "inbound.lineCogsHint":
    "Total baris ditambah bagiannya atas ongkir, pajak dan biaya lain di invoice ini.",
  "inbound.unitPriceOfLine": "Harga satuan {{product}}",
  "inbound.discountTooBig":
    "Diskon tidak boleh lebih besar dari nilai barisnya ({{amount}}).",
  "inbound.openDetails": "Lihat semua unit ({{done}}/{{total}})",
  "inbound.openDetailsAria": "Serial dan QC untuk {{product}}",
  "inbound.detailsSubtitle":
    "{{count}} unit · {{price}} per unit · HPP baris {{cogs}}",
  "inbound.detailsAddUnit": "Tambah unit lagi",
  "inbound.detailsNoUnits":
    "Belum ada unit di baris ini. Tambahkan satu untuk mulai mencatat serial.",
  "inbound.addLine": "Tambah produk",
  "inbound.addLineOf": "Tambah {{count}} unit",
  "inbound.addLineHint":
    "Satu baris untuk satu produk dengan satu harga. Dua unit produk yang sama dengan harga berbeda dimasukkan sebagai dua baris.",
  "inbound.noUnitsYetAdd2":
    "Tambahkan produk yang ditagih supplier di bawah — satu baris masing-masing, dengan harganya sendiri.",
  "inbound.lineArrivedAria": "{{product}} ternyata datang",
  "inbound.lineNotArrivedAria": "{{product}} tidak datang",
  "inbound.unitsSection": "Unit",
  "inbound.noUnitsYet": "Belum ada apa pun di invoice ini.",
  "inbound.noUnitsYetAdd":
    "Tambahkan produk yang ditagih supplier di bawah — setiap unit dapat barisnya sendiri di sini.",
  "inbound.addUnitProductAria": "Produk yang ditambahkan ke unit",
  "inbound.addUnitQtyAria": "Berapa unit yang ditambahkan",
  "inbound.addUnitsHint":
    "Juga menambah baris di faktur. Setiap unit dapat baris dan harganya sendiri.",
  "inbound.takeInAll": "Terima semua yang dihitung ({{count}})",
  "inbound.takenInCount":
    "{{count}} sudah masuk. Terima ke stok kalau sudah selesai.",
  "inbound.stateNotArrived": "Tidak datang",
  "inbound.markNotArrived": "Tidak datang",
  "inbound.arrivedAfterAll": "Ternyata datang",
  "inbound.arrivedAfterAllAria": "Unit {{n}} ternyata datang",
  "inbound.previouslyUnit": "Sebelumnya {{product}}",
  "inbound.notOnInvoice": "Tidak ada di invoice",
  "inbound.addToInvoice": "Tambahkan ke invoice",
  "inbound.productFirst": "Pilih produknya dulu",
  "inbound.unitN": "unit {{n}}",
  "inbound.moreAria": "Aksi lain untuk {{name}}",
  "inbound.removeSerialMenu": "Hapus serial ini",
  "inbound.removeRowMenu": "Hapus dari invoice",
  "inbound.removeRowTitle": "Hapus unit ini dari invoice?",
  "inbound.removeRowBody":
    "Pakai ini kalau barisnya ditambahkan karena salah. Kalau supplier menagihnya tapi tidak pernah mengirim, tandai Tidak datang saja — dengan begitu tetap tercatat di invoice.",
  "inbound.removeRowOk": "Hapus dari invoice",
  "inbound.costRefused": "{{value}} bukan harga satuan yang valid.",
  "inbound.scanFullRowsInbound":
    "Semua unit di order ini sudah punya serial. Tambahkan unitnya di bagian Barang masuk kalau memang ada tambahan.",
  "inbound.autoArrived": "Order ditandai sudah datang.",
  "inbound.closeWaiting": "{{count}} unit belum punya serial",
  "inbound.markArrivedBody":
    "{{count}} unit menunggu serial. Memindainya otomatis menandai order sudah datang; tombol ini hanya mencatat bahwa kardusnya sudah sampai.",
  "inbound.unreceiveBodyRows":
    "Unit yang sudah diterima tetap di order ini dengan serial, grade, dan riwayatnya — hanya status order yang berubah.",
  "inbound.cogsLine": "HPP {{amount}}",
  "inbound.expensesShare": "Bagian biaya",
  "inbound.repairCost": "Perbaikan",
  "inbound.returnShort": "Retur",
  "inbound.reopenQc": "Buka lagi QC",
  "inbound.invoiceChanges": "Perubahan dari invoice",
  "inbound.changeNotOnInvoice": "Tidak ada di invoice",
  "inbound.changeNotArrived": "Tidak datang",
  "inbound.noInvoiceIssued": "Tidak ada invoice",
  "inboundList.noInvoice": "Tanpa invoice",

  // The QC dialog
  "inbound.qc": "QC",
  "inbound.qcAria": "QC {{serial}}",
  "inbound.qcNeedsSerial": "Isi serialnya dulu",
  "inbound.qcTitle": "QC · {{what}}",
  "inbound.qcDecided":
    "QC unit ini sudah selesai. Buka lagi QC untuk mengubah apa pun.",
  "inbound.qcBatteryHealthMode": "Kesehatan baterai",
  "inbound.qcFccCcMode": "FCC & CC",
  "inbound.qcFcc": "FCC",
  "inbound.qcCc": "CC",
  "inbound.qcGradePlaceholder": "A, B, atau C",
  "inbound.qcConfigureGrade": "Atur grade",
  "inbound.qcService": "Servis",
  "inbound.qcReject": "Tolak",
  "inbound.qcDone": "Selesai",
  "inbound.qcNeedsDescription":
    "Isi deskripsi unit ini sebelum masuk stok — unit bekas perlu setidaknya satu frasa.",
  "inbound.qcAccepted": "{{serial}} lolos QC dan masuk stok.",
  "common.close": "Tutup",

  // Expenses
  "inbound.expenses": "Biaya",
  "inbound.noExpenses":
    "Belum ada biaya — tambahkan ongkir, pajak, atau biaya lain untuk pengiriman ini.",
  "inbound.addExpense": "Tambah biaya",
  "inbound.editExpense": "Ubah biaya",
  "inbound.editExpenseAria": "Ubah {{expense}}",
  "inbound.expenseKind": "Jenis",
  "inbound.expenseLabel": "Nama",
  "inbound.expenseLabelHint": "Opsional — mis. JNE Cargo",
  "inbound.expenseAmountNeeded": "Isi berapa biayanya.",
  "inbound.expenseInCogs": "Bagi ke HPP per unit",
  "inbound.expenseInCogsEach":
    "Sekitar {{each}} di modal masing-masing dari {{n}} unit.",
  "inbound.expenseInCogsLater": "Dibagi rata ke unit-unit di invoice ini.",
  "inbound.expenseNotInCogs":
    "Tetap jadi utang di invoice, tapi tidak masuk ke modal unit mana pun.",
  "inbound.expensePaid": "Sudah dibayar",
  "inbound.expensePaidHint":
    "Mencatat pembayaran untuk sisa yang belum dibayar, hari ini.",
  "inbound.expenseUnpaidHint":
    "Menyimpan akan membatalkan {{amount}} yang tercatat sebagai pembayarannya.",
  "inbound.expenseAdded":
    "Biaya ditambahkan — sekarang jadi utang di invoice ini.",
  "inbound.expenseAddedPaid": "Biaya ditambahkan dan pembayarannya dicatat.",
  "inbound.expenseUpdated": "Biaya diperbarui.",
  "inbound.expenseRemoveTitle": "Hapus biaya ini?",
  "inbound.expenseRemoveBody":
    "Tidak lagi jadi utang di invoice ini, dan tidak lagi dihitung ke modal unit.",
  "inbound.expenseRemoveBodyPaid":
    "Tidak lagi jadi utang, dan {{amount}} yang tercatat sebagai pembayarannya ikut dibatalkan.",
  "inbound.expenseRemoveOk": "Hapus biaya",
  "inbound.expenseRemoved": "Biaya dihapus.",
  "inbound.inCogsTag": "Masuk HPP",
  "inbound.notInCogsTag": "Tidak masuk HPP",
  "inbound.expensePaidTag": "Lunas",
  "inbound.expensePartlyTag": "Dibayar sebagian",
  "inbound.expenseUnpaidTag": "Belum dibayar",
  "inbound.payWhatIsOwed": "Bayar sisanya — {{amount}}",
  "inbound.paymentRecordedFor": "Pembayaran dicatat untuk {{what}}.",

  // Module-level labels, keyed by their English (see test/i18n.test.ts).
  "Partially paid": "Dibayar sebagian",
  "Fully paid": "Lunas",
  Customs: "Bea cukai",

  // ── 2026-09-19: the redesign brief (see CLAUDE.md) ─────────────────────────
  "inboundForm.owedAmount": "{{amount}} belum dibayar",
  "inboundForm.stillOwed": "Belum dibayar",
  "discount.cancel": "Batal",
  // The till's payment (lib/tillPayments.ts).
  "pos.methodTransfer": "Transfer",
  "pos.methodCash": "Tunai",
  "pos.payBy": "Bayar dengan {{method}}",
  "pos.payNeedsMethod": "Pilih cara pelanggan membayar.",
  "pos.paySplitOver": "Jumlah split lebih {{over}} dari total.",
  "pos.payPaidOver": "Yang dibayar tidak boleh lebih dari jumlah split-nya.",
  "pos.paymentAmounts": "Jumlah pembayaran",
  "pos.payMethodCol": "Metode pembayaran",
  // The payment table, one number per marketplace part (2026-09-21).
  "pos.amountPaidCol": "Jumlah bayar",
  "pos.amountPaidFor": "Jumlah bayar, {{method}}",
  "pos.actualPaidOrRefCol": "Dibayar sebenarnya / Nomor referensi",
  "pos.refFor": "Nomor referensi, {{method}}",
  "pos.refPlaceholderFor": "Nomor pesanan {{method}}",
  "pos.refRequired": "Nomor pesanan wajib diisi.",
  "pos.refShort": "Ref {{ref}}",
  "pos.channelOrderNo": "Nomor pesanan {{channel}}",
  "pos.payNeedsRefs":
    "Isi nomor pesanan marketplace untuk setiap pembayaran Shopee atau Tokopedia.",
  "pos.draftUnitGone":
    "{{serials}} sudah tidak dijual dan dikeluarkan dari penjualan ini.",
  "pos.actualPaidFor": "Dibayar, {{method}}",
  "pos.theRest": "sisanya",
  "pos.stillOwedOn": "{{amount}} belum dibayar",
  "pos.customerOwesAmount": "Pelanggan masih berutang {{amount}}",
  "pos.customerOwes": "Utang pelanggan",
  "pos.dueDate": "Jatuh tempo",
  "pos.dueDateAria": "Kapan pelanggan akan membayar",
  "pos.dueOn": "jatuh tempo {{date}}",
  "pos.paymentRefUpper": "REFERENSI PEMBAYARAN",
  "pos.paymentRef": "Referensi pembayaran",
  "pos.marketplaceHoldsPart":
    "Marketplace menahan bagiannya sampai dicairkan — tandai diterima di Saldo Tertahan & Piutang.",
  // Inbound & QC — QC on the row, in any order.
  "inbound.serialWaitsForProduct":
    "{{serial}} disimpan — pilih produk unitnya dan serial langsung tercatat.",
  "inbound.gradePlaceholder": "Grade",
  "inbound.gradeNew": "Baru",
  "inbound.checklistNeedsProduct":
    "Checklist-nya per kategori — pilih produknya.",
  "inbound.checklistAria": "Checklist grading untuk {{name}}",
  "inbound.decisionNeedsSerial": "Isi serialnya dulu",
  "inbound.acceptTip": "Lolos QC — masuk stok siap jual",
  "inbound.acceptNeedsDescription":
    "Beri deskripsi unit ini dulu — unit second perlu minimal satu frasa.",
  "inbound.notArrivedAria": "Unit {{n}} tidak datang",
  "inbound.acceptedShort": "Diterima",
  "inbound.photosTip": "Foto",
  "inbound.photosAria": "Foto {{name}}",
  "inbound.photosTitle": "Foto · {{what}}",
  "inbound.photosNotKept":
    "Perangkat ini tidak punya ruang untuk menyimpan foto ini. Isi nomor serinya agar tersimpan — kalau halaman dimuat ulang sebelum itu, fotonya hilang.",
  "inbound.unitCol": "Unit",
  "inbound.batteryCol": "Baterai",
  "inbound.cogsCol": "HPP",
  "inbound.cogsHint":
    "Harga unit ditambah bagiannya dari ongkir, pajak dan biaya lain di invoice, serta biaya servis.",
  "inbound.invoiceUnitPrice": "Harga unit {{n}}",
  "inbound.addHintPerUnit":
    "Setiap unit punya kotak harganya sendiri, di sini dan di daftar di bawah.",
  "photos.addedDraft": "{{count}} foto ditambahkan.",
  "photos.altDraft": "Foto unit ini",
  "photos.addHintDraft": "Foto kondisi unit ini",
  // The Inbound list's columns and row buttons.
  "inboundList.date": "Tanggal",
  "inboundList.totalPrice": "Total harga",
  "inboundList.totalPaid": "Total dibayar",
  "inboundList.unpaidAmount": "{{amount}} belum dibayar",
  "inboundList.addPayment": "Tambah pembayaran",
  "inboundList.addPaymentAria": "Tambah pembayaran ke {{code}}",
  "inboundList.addPaymentClosed":
    "Invoice ditutup — buka lagi untuk mencatat pembayaran.",
  "inboundList.deleteAria": "Hapus {{code}}",
  // The order wizard: a product and how many, then a price per unit.
  "inboundForm.productsOptional":
    "Opsional. Kalau barang belum datang dan belum ada yang tahu isinya, biarkan kosong — order tetap tersimpan, dan produknya ditambahkan dari halaman order saat barangnya tiba.",
  "inboundForm.addUnit": "Tambah unit",
  "inboundForm.noUnitsYet":
    "Belum ada unit. Pilih produk dan jumlahnya di bawah, atau biarkan kosong.",
  "inboundForm.unitPrice": "Harga unit",
  "inboundForm.unitPriceOf": "Harga unit {{n}}",
  "inboundForm.removeUnit": "Hapus unit {{n}}",
  "inboundForm.addUnits": "Tambah {{count}} unit",
  "inboundForm.noLinesYet":
    "Belum ada produk. Tambahkan satu di bawah, atau biarkan kosong.",
  "inboundForm.removeLine": "Hapus baris {{n}}",
  "inboundForm.detailsSubtitle":
    "{{count}} unit · {{price}} per unit · HPP baris {{cogs}}",
  "inboundForm.detailsFooter":
    "Tidak ada yang wajib diisi di sini. Setiap serial yang dimasukkan menjadi unit di QC begitu order disimpan.",
  "inboundForm.serialRefused":
    "{{serial}} bukan serial unit baru — nomor di casing {{min}}–{{max}} karakter, barcode-nya S lalu jumlah yang sama.",
  "inboundForm.serialsNotReady":
    "{{count}} serial belum bisa dicatat — setiap unit perlu grade, dan serial unit baru harus lolos pengecekannya. Buka Unit di barisnya untuk menyelesaikan, atau simpan sebagai draft.",
  "inboundForm.serialTwice": "{{serial}} sudah ada di order ini.",
  "inboundForm.serialFault": "Cek lagi dengan stikernya.",
  "inboundForm.notEnteredYet": "Belum diisi",
  "inboundForm.unitCount": "{{count}} unit",
  // Stock Opname — the counting table (owner brief 2026-09-19).
  "opname.unitsTitle": "Unit dalam hitungan ini",
  "opname.colUnit": "Unit",
  "opname.description": "Deskripsi",
  "opname.action": "Aksi",
  "opname.statusFound": "Ditemukan",
  "opname.statusNotScanned": "Belum discan",
  "opname.statusElsewhere": "Milik lokasi lain",
  "opname.statusUnregistered": "Tidak ada di sistem",
  "opname.statusNotCounted": "Belum dihitung",
  "opname.unknownUnit": "Unit tidak dikenal",
  "opname.deleteScan": "Hapus scan ini — unitnya tidak diubah",
  "opname.deleteScanAria": "Hapus scan {{serial}}",
  "opname.tallyCounting":
    "{{found}} ditemukan · {{notYet}} belum discan · {{unexpected}} tak terduga",
  "opname.onlyCountedByQty":
    "Tidak ada yang berserial untuk discan di cakupan ini — hitung per jumlah di bawah.",
  // S/N Tracking — the list of every serial.
  "snTracking.anyUnit": "Semua kategori, produk atau unit",
  "snTracking.checkHistory": "Cek riwayat",
  "snTracking.checkHistoryAria": "Cek riwayat {{serial}}",
  "snTracking.clearFilters": "Bersihkan filter",
  "snTracking.findInTree": "Cari kategori, produk atau unit",
  "snTracking.lastMovement": "Pergerakan terakhir",
  "snTracking.movedBetween": "Pergerakan terakhir antara",
  "snTracking.movedSince": "Bergerak sejak",
  "snTracking.movedUntil": "Bergerak sampai",
  "snTracking.searchPlaceholder": "Cari atau scan serial, produk atau gudang",
  "snTracking.serial": "Serial",
  "snTracking.unit": "Unit",
  "snTracking.variantPriceHint": "Belum diberi harga — harga jual variannya",
  // Transaction History — the owner's columns.
  "transactions.anyChannel": "Semua kanal",
  "transactions.anyPaymentStatus": "Semua status pembayaran",
  "transactions.customer": "Pelanggan",
  "transactions.date": "Tanggal",
  "transactions.dueOn": "Jatuh tempo {{date}}",
  "transactions.exported": "{{count}} baris diekspor.",
  "transactions.ofTotal": "dari {{total}}",
  "transactions.orderNumber": "No. order",
  "transactions.orderRef": "No. order / referensi",
  "transactions.overdueSince": "Lewat jatuh tempo sejak {{date}}",
  "transactions.paymentRef": "Referensi pembayaran",
  "transactions.paymentStatus": "Status pembayaran",
  "transactions.received": "Diterima",
  "transactions.refHint":
    "Referensi pembayaran — nomor pesanan dari marketplace",
  "transactions.refLine": "Ref {{ref}}",
  "transactions.searchOrders":
    "Cari order, referensi, serial, produk atau pelanggan",
  "transactions.selectedSum": "Diterima {{received}} dari {{total}}",
  "transactions.soldBetween": "Terjual antara",
  "transactions.soldFrom": "Terjual dari",
  "transactions.soldUntil": "Terjual sampai",
  "transactions.stCompleted": "Selesai",
  "transactions.stPartlyReturned": "Diretur sebagian",
  "transactions.stReturned": "Diretur",
  "transactions.total": "Total",
  "transactions.unit": "Unit",
  "transactions.units": "Unit",
  // Pending & Receivables — the correction dialog and its note.
  "finance.recordWithdrawals": "Catat pencairan",
  "settle.amendTitle": "Koreksi pencairan dari {{channel}}",
  "settle.saveCorrection": "Simpan koreksi",
  // Returns & exchange — buy-back or return, from one rule.
  "returnCustomer.pickAUnit": "Centang minimal satu unit yang dikembalikan.",
  "returnCustomer.warehouse": "Kembali ke gudang",
  "returnCustomer.pickAWarehouse": "Pilih gudang",
  "returnCustomer.needWarehouse": "Pilih gudang tujuan unit ini kembali.",
  "returnCustomer.needReason": "Sebutkan kenapa unitnya dikembalikan.",
  "returnCustomer.recordedRefund":
    "Retur dicatat — kembalikan {{amount}}. Terima unitnya saat sudah kembali.",
  "returnCustomer.recorded":
    "Retur dicatat — terima unitnya saat sudah kembali.",
  "returnCustomer.paySettled": "Lunas",
  "returnCustomer.payMarketplace": "Di marketplace",
  "returnCustomer.payPartly": "Dibayar sebagian",
  "returnCustomer.payOwed": "Belum dibayar",
  "returnCustomer.serialLookup": "Serial",
  "returnCustomer.notSold":
    "{{serial}} bukan unit yang sedang ada di pelanggan. Pilih transaksinya di bawah.",
  "returnCustomer.scanSerial": "Scan atau ketik serial yang dikembalikan",
  "returnCustomer.findSale": "Cari transaksinya",
  "returnCustomer.transaction": "Transaksi",
  "returnCustomer.nothingOut":
    "Semua unit transaksi ini sudah kembali, atau sedang dalam perjalanan.",
  "returnCustomer.unitCol": "Unit",
  "returnCustomer.priceCol": "Harga",
  "returnCustomer.expenseCol": "Harga tambahan",
  "returnCustomer.tickAria": "{{serial}} dikembalikan",
  "returnCustomer.qtyBackAria": "Berapa {{product}} yang dikembalikan",
  "returnCustomer.countedOut": "{{code}} · {{count}} masih di pelanggan",
  "returnCustomer.eachPrice": "{{price}} per pcs",
  "returnCustomer.extraFor": "Harga tambahan untuk {{item}}",
  "returnCustomer.returnFee": "Biaya tambahan",
  "returnCustomer.returnFeeHint":
    "Biaya untuk menerima retur — dipotong dari uang yang dikembalikan ke pelanggan.",
  "returnCustomer.handBack": "Kembalikan {{amount}}",
  "returnCustomer.customerPays":
    "Pelanggan membayar {{amount}} untuk penukaran",
  "returnCustomer.paymentStatus": "Status pembayaran",
  "returnCustomer.replacement": "Pengganti",
  "returnCustomer.description": "Deskripsi",
  "returnCustomer.statusBack": "Kembali ke stok",
  "returnCustomer.addReplacement": "Tambahkan {{item}}",
  "returnCustomer.addSale": "Tambah transaksi — kode atau pelanggan",
  "returnCustomer.alreadyChosen": "{{serial}} sudah ada di daftar penukaran.",
  "returnCustomer.checkShopee": "Cek berkas Shopee",
  "returnCustomer.exchangeFor": "Ditukar dengan",
  "returnCustomer.exchangeHint":
    "Opsional. Scan atau cari barang yang diambil pelanggan sebagai gantinya.",
  "returnCustomer.inventoryList": "Unit di inventori",
  "returnCustomer.itemsOf": "Unit di {{code}}",
  "returnCustomer.noMatch": "Tidak ada stok yang cocok.",
  "returnCustomer.notForSale": "{{serial}} tidak ada di rak untuk dijual.",
  "returnCustomer.notOutAnymore": "{{serial}} sudah tidak ada di pelanggan.",
  "returnCustomer.onHand": "{{count}} tersedia",
  "returnCustomer.putOn": "Masukkan pengganti ke",
  "returnCustomer.recordedExchange":
    "Penukaran dicatat — terima unit yang dikembalikan saat sudah kembali.",
  "returnCustomer.recordedExchangeTopUp":
    "Penukaran dicatat — terima {{amount}} dari pelanggan. Terima unit yang dikembalikan saat sudah kembali.",
  "returnCustomer.removeReplacement": "Hapus {{item}}",
  "returnCustomer.removeSale": "Keluarkan {{code}} dari retur ini",
  "returnCustomer.replacementGone":
    "{{item}} sudah tidak ada di rak — pilih pengganti lain.",
  "returnCustomer.replacementQtyFor": "Jumlah {{item}}",
  "returnCustomer.searchReplacement":
    "Scan serial, atau cari produk, varian atau kode",
  "returnCustomer.searchReplacementAria": "Cari pengganti di inventori",
  "returnCustomer.staleReplacements":
    "Sudah tidak ada di rak, jadi tidak diikutkan: {{list}}",
  // The two-table form and the three-column history (2026-09-21).
  "returnCustomer.returnSide": "Retur",
  "returnCustomer.returnTable": "Unit yang dikembalikan",
  "returnCustomer.exchangeTable": "Unit yang keluar",
  "returnCustomer.unitName": "Nama unit",
  "returnCustomer.unitSerial": "Serial unit",
  "returnCustomer.serialUnit": "Serial unit",
  "returnCustomer.gradeCol": "Grade",
  "returnCustomer.transactionNumber": "Nomor transaksi",
  "returnCustomer.typeTheTransaction":
    "Ketik nomor transaksi, atau pindai serialnya",
  "returnCustomer.noSuchSale":
    "{{text}} bukan transaksi yang masih ada barangnya di pelanggan.",
  "returnCustomer.pickUnits": "Unit pada {{code}}",
  "returnCustomer.selectNUnits": "Pilih {{count}} unit",
  "returnCustomer.nothingPicked":
    "Ketik nomor transaksi di atas, lalu pilih unitnya.",
  "returnCustomer.removeBack": "Keluarkan {{item}}",
  "returnCustomer.changeUnits": "Ubah unitnya",
  "returnCustomer.startOver": "Mulai ulang",
  "returnCustomer.addExchangeUnit": "Unit tukar",
  "returnCustomer.closeExchange": "Tanpa tukar",
  "returnCustomer.pickReplacement": "Pilih unit — serial atau nama",
  "returnCustomer.countedOption": "{{name}} — stok {{count}}",
  "returnCustomer.nothingListed":
    "Scan serial yang dikembalikan, atau tambahkan transaksinya.",
  "returnCustomer.nothingOutYet": "Pilih unit pengganti untuk pelanggan.",
  "returnCustomer.exchangeWaits": "Tambahkan dulu unit yang dikembalikan.",
  "returnCustomer.transactionRef": "Nomor transaksi / referensi",
  "returnCustomer.exchangeUnit": "Unit pengganti",
  // Every clickable serial's history, in a popup (2026-09-21).
  "serialHistory.title": "Riwayat — {{serial}}",
  "shopeeRefund.fileCol": "Di berkas",
  "shopeeRefund.noSale": "Tidak ada transaksi dengan nomor pesanan ini",
  "shopeeRefund.none":
    "Tidak ada pengembalian dana di berkas ini — {{count}} pesanan dicek.",
  "shopeeRefund.notShopee":
    "Berkas ini bukan laporan saldo penjual atau export pesanan Shopee.",
  "shopeeRefund.orderCol": "Nomor pesanan Shopee",
  "shopeeRefund.recordFor": "Catat retur {{code}}",
  "shopeeRefund.recorded": "Retur sudah dicatat",
  "shopeeRefund.returnCol": "Retur",
  "shopeeRefund.returnedQty": "Jumlah dikembalikan: {{count}}",
  "shopeeRefund.saleCol": "Transaksi",
  "shopeeRefund.summary":
    "{{count}} pesanan dengan pengembalian dana di berkas ini. Tidak ada yang dicatat sampai Anda mencatat returnya.",
  "shopeeRefund.title": "Pengembalian dana di berkas Shopee",
  "shopeeRefund.which":
    "Laporan saldo penjual (Saldo Penjual → Export) menampilkan setiap pesanan yang dananya dikembalikan Shopee. Export pesanan juga bisa.",
  // Inventory, flat since 2026-09-19.
  "inventory.unitAndSku": "Unit & SKU",
  "inventory.anyGrade": "Semua grade",
  "inventory.unitPrice": "Harga satuan",
  "inventory.sellPrice": "Harga jual",
  "inventory.cogsOne": "HPP {{amount}}",
  "inventory.action": "Aksi",
  "inventory.setPrice": "Atur harga",
  "inventory.setPriceFor": "Atur harga untuk {{what}}",
  "inventory.printBarcode": "Cetak barcode",
  "inventory.printBarcodeFor": "Cetak barcode untuk {{what}}",
  "inventory.openLineAria": "Lihat unit {{what}}",
  "inventory.moveDoc": "Dokumen",
  "inventory.moveQty": "Jml",
  "inventory.moveWhat": "Keterangan",
  "inventory.moveWhen": "Waktu",
  "inventory.nUnits": "{{n}} unit",
  // What a unit cost, taken apart (the "i").
  "cost.title": "Rincian HPP {{serial}}",
  "cost.showAria": "Lihat rincian HPP {{serial}}",
  "cost.unitPrice": "Harga satuan",
  "cost.expenseShare": "Bagian ongkir, pajak & biaya",
  "cost.repairs": "Perbaikan",
  "cost.cogs": "HPP",
  // The price grid: the marketplace price is the variant's.
  "price.cogs": "HPP",
  "price.variantHint":
    "Harga marketplace itu per varian, bukan per unit: harga toko tertinggi dari unit yang dijual, ditambah {{pct}}%.",
  "price.listing": "Harga marketplace: {{price}}",
  "price.listingChanges":
    "Harga marketplace setelah disimpan: {{before}} → {{after}}",
  "price.notListed":
    "Marketplace: belum tayang — tidak ada unit varian ini yang dijual.",
  "settings.listingMarkupVariantHint":
    "Ditambahkan ke harga toko tertinggi dari unit yang dijual dalam satu varian; hasilnya jadi harga marketplace varian itu.",
  "stock.adjustTitle": "Sesuaikan {{serial}}",
  "stock.noBatteryCounted":
    "Dihitung per jumlah, bukan per serial — tidak ada baterai yang dicatat",
  // Export stock.
  "stockExport.button": "Ekspor stok",
  "stockExport.title": "Ekspor stok",
  "stockExport.warehouses": "Gudang",
  "stockExport.categories": "Kategori",
  "stockExport.products": "Produk",
  "stockExport.columns": "Kolom",
  "stockExport.columnsHint":
    "Kalau Gudang dicentang, sheet dikelompokkan per gudang lengkap dengan totalnya; kalau tidak, tiap produk jadi satu baris untuk semua gudang. Grade bikin tiap grade punya baris sendiri.",
  "stockExport.colUnit": "Unit (produk & varian)",
  "stockExport.colQty": "Jml",
  "stockExport.colWarehouse": "Gudang",
  "stockExport.colUnitPrice": "Harga satuan",
  "stockExport.colSellPrice": "Harga jual",
  "stockExport.colSku": "Kode SKU",
  "stockExport.colGrade": "Grade",
  "stockExport.download": "Unduh .xlsx",
  "stockExport.downloadPdf": "Unduh .pdf",
  "stockExport.downloadBoth": "Unduh keduanya",
  "stockExport.format": "Berkas",
  "stockExport.formatXlsx": "Excel (.xlsx)",
  "stockExport.formatPdf": "PDF",
  "stockExport.formatHint":
    "Excel berisi angka asli yang bisa diurutkan dan dijumlahkan; PDF tampil sama di semua layar dan tidak bisa diubah. Centang keduanya untuk mengunduh masing-masing satu.",
  "stockExport.noFormat": "Pilih minimal satu berkas untuk diunduh.",
  "stockExport.preview": "{{units}} unit dalam {{rows}} baris akan diekspor.",
  "stockExport.nothing": "Tidak ada stok yang cocok dengan filter ini.",
  "stockExport.done": "Stok diekspor: {{units}} unit dalam {{rows}} baris.",
  // Payable & Receivable (owner ask 2026-09-21) — utang and piutang together.
  "utang.title": "Utang & piutang",
  "utang.weOwe": "Utang ke supplier",
  "utang.weOweHint": "Faktur yang masih ada sisa tagihan, paling lama di atas.",
  "utang.owedToUs": "Piutang pelanggan",
  "utang.owedToUsHint":
    "Penjualan tunai dan transfer yang belum lunas. Uang yang masih ditahan marketplace ada di Saldo Tertahan & Piutang.",
  "utang.payable": "Utang — yang harus dibayar ke supplier",
  "utang.receivable": "Piutang — yang belum dibayar pelanggan",
  "utang.supplier": "Supplier",
  "utang.noSupplier": "Tanpa nama supplier",
  "utang.name": "Nama",
  "utang.transactions": "Transaksi",
  "utang.document": "Transaksi",
  "utang.date": "Tanggal",
  "utang.billed": "Total",
  "utang.settled": "Dibayar",
  "utang.amount": "Jumlah",
  "utang.oldestSince": "Tertua sejak {{date}}",
  "utang.promised": "Dijanjikan {{date}}",
  "utang.overdue": "Lewat jatuh tempo",
  "utang.andMore": "dan {{count}} lagi",
  "utang.fromBefore": "Dari sebelum aplikasi ini",
  "utang.walkIn": "Pelanggan umum",
  "utang.searchSupplier": "Cari supplier atau nomor faktur",
  "utang.searchCustomer": "Cari pelanggan, nomor telepon, atau kode order",
  "utang.searchSupplierOrInvoice": "Cari supplier atau nomor faktur",
  "utang.searchCustomerOrOrder":
    "Cari pelanggan, nomor telepon, atau transaksi",
  "utang.nothingPayable": "Semua faktur sudah lunas.",
  "utang.nothingReceivable": "Semua pelanggan sudah membayar.",
  // Tabs, columns, and export controls (owner ask 2026-09-21 malam).
  "utang.customer": "Pelanggan",
  "utang.phone": "Nomor telepon",
  "utang.inboundNumber": "Nomor inbound",
  "utang.transactionId": "ID transaksi",
  "utang.total": "Total",
  "utang.owed": "Sisa",
  "utang.viewInvoice": "Lihat invoice",
  "utang.grandTotal": "Total keseluruhan",
  "utang.payableExportTitle": "Utang — yang harus dibayar ke supplier",
  "utang.receivableExportTitle": "Piutang — yang belum dibayar pelanggan",
  "utang.exportPrintedAt": "Dicetak {{when}}",
  // Receivable and Payable as two leaves, and the payment dialog behind both
  // (owner ask 2026-09-22).
  "utang.weOweTotal": "Utang kita",
  "utang.owedToUsTotal": "Piutang pelanggan",
  "debtPay.add": "Tambah pembayaran",
  "debtPay.recordRow": "Catat pembayaran",
  "debtPay.recordRowAria": "Catat pembayaran untuk {{code}}",
  "debtPay.titlePayable": "Bayar supplier",
  "debtPay.titleReceivable": "Terima pembayaran pelanggan",
  "debtPay.save": "Catat pembayaran",
  "debtPay.pickSupplier": "Pilih supplier",
  "debtPay.pickCustomer": "Pilih pelanggan",
  "debtPay.amount": "Jumlah",
  "debtPay.amountAuto": "Dijumlahkan dari baris yang dicentang.",
  "debtPay.amountPlaceholder": "Ketik, atau centang barisnya",
  "debtPay.method": "Dibayar dengan",
  "debtPay.date": "Tanggal",
  "debtPay.note": "Catatan",
  "debtPay.inBalance": "Masuk hitungan saldo toko",
  "debtPay.inBalanceOff":
    "Melunasi utang tanpa mengubah saldo kas atau bank — untuk uang yang tidak lewat rekening toko.",
  "debtPay.outOfCash": "Diambil dari laci kas.",
  "debtPay.outOfBank": "Diambil dari saldo bank.",
  "debtPay.intoCash": "Masuk ke laci kas.",
  "debtPay.intoBank": "Masuk ke saldo bank.",
  "debtPay.invoices": "faktur",
  "debtPay.transactions": "transaksi",
  "debtPay.selected": "{{count}} {{what}} dipilih · {{amount}}",
  "debtPay.owedInAll": "Total sisa: {{amount}}",
  "debtPay.toDeposit":
    "{{amount}} melebihi sisa tagihan faktur-faktur ini. Kelebihannya disimpan sebagai deposit di {{name}}, untuk dipakai ke faktur berikutnya.",
  "debtPay.tooMuchInvoice": "{{amount}} melebihi sisa tagihan faktur ini.",
  "debtPay.tooMuch":
    "{{amount}} melebihi utang {{name}}. Pelanggan tidak bisa membayar di muka.",
  "debtPay.pickRow": "Bayar {{code}}",
  "debtPay.nothingOwed": "Tidak ada yang terutang.",
  "debtPay.owed": "Sisa",
  "debtPay.paid": "Dibayar",
  "debtPay.saved": "{{amount}} tercatat untuk {{count}} dokumen.",
  "debtPay.logReason": "Pembayaran dicatat di Piutang",
  "debtPay.depositNote": "Kelebihan bayar dari halaman Utang",
  "inbound.inBalanceOn": "Diambil dari laci kas atau bank, sesuai metodenya.",
  "supplier.inBalanceHint":
    "Matikan bila uangnya tidak keluar dari kas atau rekening bank toko.",
  "cashflow.kindSupplierPayment": "Pembayaran supplier",
  "cashflow.kindDeposit": "Deposit supplier",
  "cashflow.kindCustomerPayment": "Pembayaran pelanggan",
  "cashflow.paidTo": "Dibayar ke {{name}}",
  "cashflow.depositWith": "Deposit di {{name}}",
  "cashflow.oldDebtTo": "{{name}} — utang dari sebelum aplikasi ini",
  "cashflow.notInBalance": "Tidak masuk saldo",
  "export.xlsx": "Ekspor .xlsx",
  "export.pdf": "Ekspor .pdf",
  // Shopee report upload (owner ask 2026-09-21). docs/shopee-fees.md.
  "piutang.uploadShopee": "Unggah laporan Shopee",
  "piutang.imported": "{{count}} pencairan dicatat — {{amount}}.",
  "shopeeImport.title": "Unggah laporan Shopee",
  "shopeeImport.drop": "Letakkan berkas .xlsx Shopee di sini",
  "shopeeImport.which":
    "Laporan saldo penjual (Saldo Penjual → Export) atau laporan penghasilan (Penghasilan Saya → Export) memuat apa yang benar-benar dibayarkan Shopee. Export pesanan juga bisa, dan akan diestimasi dari tarif resmi.",
  "shopeeImport.unreadable":
    "Berkas itu tidak bisa dibaca sebagai spreadsheet.",
  "shopeeImport.orderExportTitle":
    "Ini export pesanan — tidak memuat nilai pencairan",
  "shopeeImport.orderExportBody":
    "Satu-satunya kolom uang di dalamnya adalah tagihan pembeli, bukan yang dibayarkan Shopee ke toko. Semua angka di bawah DIESTIMASI dari tarif resmi. Koreksi satu per satu saat pencairan benar-benar masuk.",
  "shopeeImport.noOrders":
    "Tidak ada nomor pesanan yang ditemukan di berkas itu.",
  "shopeeImport.conditionalHint":
    "Dua komponen biaya tidak bisa dibaca dari export mana pun — apakah pembeli mengambil cicilan 0%, dan apakah penjualan lewat afiliasi. Keduanya membuat biaya satu penjualan berkisar 6,9% sampai 12,0%, jadi ditanyakan, bukan ditebak.",
  "shopeeImport.noInstalment": "Tanpa cicilan 0%",
  "shopeeImport.spay3": "SPayLater XTRA 0%, 3 bulan (2,5%)",
  "shopeeImport.spay6": "SPayLater XTRA 0%, 6 bulan (4,0%)",
  "shopeeImport.affiliate": "Terjual lewat afiliasi (1% + PPN)",
  "shopeeImport.estimated": "Estimasi",
  // The upload's table (owner revision 2026-09-21).
  "shopeeImport.refCol": "Nomor referensi",
  "shopeeImport.orderNominal": "Nominal pesanan",
  "shopeeImport.receivable": "Nominal diterima",
  "shopeeImport.deductionDetail": "Rincian potongan",
  "shopeeImport.detailFor": "Rincian potongan untuk {{ref}}",
  "shopeeImport.notInFile": "Tidak ada di berkas ini",
  "shopeeImport.noRefYet": "Penjualan belum punya nomor pesanan Shopee",
  "shopeeImport.paidIn": "Masuk {{when}}",
  "shopeeImport.reasonShared": "Dua penjualan memakai nomor ini",
  "shopeeImport.reasonNothing": "Tidak dibayar — pengembalian dana atau retur",
  "shopeeImport.reasonUnreadable": "Angka Shopee tidak terbaca",
  "shopeeImport.reasonParts": "Bukan pencairan biasa",
  "shopeeImport.mismatchLegend":
    "{{count}} ditandai di atas: yang dibayarkan Shopee tidak cocok dengan tarif resminya, atau barisnya perlu dicek. Tombol ⓘ di samping nominal diterima menampilkan potongannya.",
  "shopeeImport.estimatedReason":
    "Diestimasi dari tarif resmi Shopee — koreksi saat pencairan masuk.",
  "shopeeImport.record": "Catat {{count}} pencairan",
  "shopeeImport.summary":
    "{{count}} dari {{total}} dipilih · {{amount}} akan dicatat sebagai diterima.",
  "shopeeImport.leftovers":
    "{{unknown}} nomor pesanan di berkas tidak cocok dengan penjualan yang menunggu, {{ambiguous}} cocok dengan lebih dari satu, {{already}} sudah pernah dicatat, dan {{missing}} penjualan yang menunggu tidak ada di berkas.",
  // The seller balance report (owner ask 2026-09-21, later the same day).
  "shopeeImport.nothingPaid":
    "Shopee tidak membayar apa pun untuk pesanan ini ({{amount}}) — pengembalian dana atau retur. Tangani di Retur, bukan di sini.",
  "shopeeImport.unreadableRow":
    "Angka Shopee untuk pesanan ini tidak bisa dibaca. Catat secara manual.",
  "shopeeImport.reviewParts":
    "Bukan pencairan biasa: {{parts}}. Periksa penjualannya, lalu centang.",
  "shopeeImport.reviewAbove":
    "Shopee membayar {{amount}} lebih banyak daripada yang dimungkinkan tarifnya. Periksa nominal penjualannya, lalu centang.",
  "shopeeImport.totalDeducted": "Potongan",
  "shopeeImport.inTheBalance": "Di saldo: {{parts}}",
  "shopeeImport.unmatchedList":
    "Tidak cocok — belum ada penjualan dengan nomor pesanan Shopee ini sebagai referensinya: {{list}}",
  "shopeeImport.andMore": "dan {{count}} lagi",
  "shopeeImport.balanceOther":
    "Juga ada di saldo, dan tidak dicatat di sini: {{list}}.",
  "shopeeImport.notDone":
    "{{count}} baris pesanan belum selesai diproses dan tidak diikutkan.",
  // The shop's own product naming convention (owner ask 2026-09-21).
  "products.codePreview": "Kode SKU akan terbaca: {{code}}",
  "products.namingHint":
    "Konvensi toko: lini, ukuran, tahun atau chip, prosesor. Unit Apple silicon dinamai dengan chip-nya, bukan tahunnya.",
  "products.eGAir13": 'mis. AIR 13" 2020 I5, atau AIR 13" M2',
  // ── 2026-09-24: a debt names its debtor (see CLAUDE.md) ──────────────────
  "pos.payNeedsDebtor":
    "{{amount}} belum dibayar — isi nama atau nomor telepon pelanggan (salah satu cukup).",
  "pos.customerNeeded": "Wajib diisi — ada sisa yang belum dibayar",
  "pos.nameOrPhone": "Nama atau nomor telepon — salah satu cukup.",
  "customers.nameOrPhone": "Nama atau nomor telepon — salah satu cukup.",
  // The debt dialog's second door: the document's number.
  "debtPay.fromTransaction": "Atau mulai dari transaksi",
  "debtPay.fromInvoice": "Atau mulai dari nomor inbound",
  "debtPay.findTransaction": "Ketik nomor transaksi atau nomor pesanan",
  "debtPay.findInvoice": "Ketik nomor inbound",
  "debtPay.noSuchDocument": "Tidak ada sisa tagihan dengan nomor itu.",

  // ── Inbound: the unit's own row actions, read-only viewing, outside the
  //    invoice (owner asks 2026-09-24) ──────────────────────────────────────
  "inbound.editInvoice": "Edit invoice",
  "inbound.doneEditing": "Selesai mengedit",
  "inbound.saveInvoice": "Simpan invoice",
  "inbound.editingBanner": "Anda sedang mengedit invoice ini",
  "inbound.scanReadOnly":
    "Invoice ini hanya bisa dibaca. Tekan Edit invoice sebelum memindai.",
  "inbound.paidInFullTitle": "Invoice ini sudah lunas",
  "inbound.paidInFullBody":
    "Tutup sekarang? Invoice yang ditutup hanya bisa dibaca — unit, baris, dan uangnya berhenti menerima perubahan. Anda bisa membukanya lagi kapan saja.",
  "inbound.keepOpen": "Biarkan terbuka",
  "inbound.deleteUnitRow": "Hapus unit ini",
  "inbound.deleteUnitRowAria": "Hapus unit {{n}}",
  "inbound.deleteUnitRowTitle": "Hapus {{what}}?",
  "inbound.deleteUnitRowOk": "Hapus unit",
  "inbound.deleteUnitRowBody":
    "Barisnya keluar dari invoice. Kalau supplier menagihnya tapi tidak pernah mengirimnya, tandai Tidak datang saja — itu menjaganya tetap di invoice.",
  "inbound.deleteUnitRowBodySerial":
    "Unit, serialnya, dan semua yang tercatat atasnya ikut terhapus, dan invoice kehilangan barisnya. Kalau supplier menagihnya tapi tidak pernah mengirimnya, tandai Tidak datang saja — itu menjaganya tetap di invoice.",
  "inbound.addOutside": "Tambahkan diluar invoice",
  "inbound.addOutsideHint":
    "Toko menerimanya tetapi tidak tertagih di invoice supplier. Barisnya ditandai kuning; harganya tidak berubah.",
  "inbound.notArrivedSection": "Ditagih tapi tidak datang",
  "inbound.outsideSection": "Datang diluar invoice",
  "inbound.exceptionLine": "{{count}} × {{product}}",

  // ── Closing the book (2026-09-24; retired 2026-10-27, these two are inert) ─
  "payEdit.bookClosed":
    "Buku sudah ditutup untuk tanggal ini. Buka kembali di Riwayat Transaksi untuk mengubah uang transaksi ini.",
  "editSale.bookClosed":
    "Buku sudah ditutup untuk tanggal ini. Buka kembali di Riwayat Transaksi dulu.",

  // ── Payable & Receivable, grouped per party (owner ask 2026-09-24) ───────
  "utang.invoiceCount": "{{count}} invoice belum lunas",
  "utang.saleCount": "{{count}} transaksi belum lunas",
  "utang.selectedLabel": "{{count}} dipilih",
  "debtPay.recordPartyAria": "Catat pembayaran untuk {{name}}",

  // ── Chatbot: switches, action items, profile (2026-09-29) ────────────────
  "chatSwitch.title": "Bot boleh menjawab",
  "chatSwitch.stock": "Stok",
  "chatSwitch.stockHint": "Apakah unit tersedia, dan grade-nya.",
  "chatSwitch.price": "Harga",
  "chatSwitch.priceHint":
    "Harga unit, dari POS. Unit tanpa harga selalu diteruskan ke Anda.",
  "chatSwitch.reservations": "Janji datang",
  "chatSwitch.reservationsHint":
    "Membuat, mengecek, memindah, dan membatalkan janji datang milik pelanggan itu sendiri. Tidak ada unit yang ditahan.",
  "chatSwitch.photos": "Foto",
  "chatSwitch.photosHint": "Mengirim foto QC toko untuk sebuah unit.",
  "chatSwitch.onMeans": "Nyala: bot menjawab ini sendiri.",
  "chatSwitch.offMeans": "Mati: diteruskan ke Anda, dengan tugas.",
  "chatSwitch.ownerOnly": "Hanya pemilik yang bisa mengubah ini.",
  "chatSwitch.needsStock": "Perlu Stok dinyalakan.",
  "chatSwitch.saveFailed": "Saklar tidak bisa diubah.",
  "chatTesters.button": "Penguji ({{n}})",
  "chatTesters.title": "Nomor penguji",
  "chatTesters.hint":
    "Penguji yang mengirim /new memulai chat dari awal: bot melupakan pesan sebelumnya dan serah-terima yang masih terbuka di chat itu ditutup. Dari nomor lain, /new adalah pesan biasa.",
  "chatTesters.placeholder": "0812… atau 62812…, lalu Enter",
  "chatTesters.save": "Simpan",
  "chatTesters.saveFailed": "Nomor penguji tidak bisa disimpan.",
  "chatAction.negotiation": "Nego",
  "chatAction.price": "Harga",
  "chatAction.stock": "Stok",
  "chatAction.reservation": "Booking",
  "chatAction.photos": "Foto",
  "chatAction.other": "Perlu Anda",
  "task.need.price": "Perlu cek harga",
  "task.need.stock": "Perlu cek stok",
  "task.need.unit": "Perlu cek kondisi unit",
  "task.need.offer": "Perlu jawab tawaran",
  "task.need.recommend": "Perlu pilihkan unit",
  "task.need.booking": "Perlu urus booking",
  "task.need.payment": "Perlu cek pembayaran",
  "task.need.tradeIn": "Perlu taksir tukar tambah",
  "task.need.sellToShop": "Perlu taksir unit pelanggan",
  "task.need.shipping": "Perlu cek ongkir",
  "task.need.warranty": "Perlu urus garansi",
  "task.need.complaint": "Perlu tangani keluhan",
  "task.need.media": "Perlu lihat kiriman pelanggan",
  "task.need.photos": "Perlu kirim foto",
  "task.need.template": "Perlu dibalas dengan template",
  "task.need.tellBooking": "Perlu kabari booking",
  "task.need.reply": "Perlu dibalas",
  "task.reason.noSource": "tidak ada sumber untuk jawabannya",
  "task.reason.unknownSource": "sumber jawabannya tidak dikenal",
  "task.reason.tooLong": "draf terlalu panjang",
  "task.reason.empty": "draf kosong",
  "task.reason.amount": "angka di draf tidak ada sumbernya",
  "task.reason.availability": "stok di draf tidak ada sumbernya",
  "task.reason.discount": "draf menawarkan diskon",
  "task.reason.noAnswer": "bot tidak punya jawabannya",
  "task.reason.windowClosed": "jendela 24 jam sudah tutup",
  "task.reason.noText": "pesan tanpa teks",
  "task.reason.botFailed": "bot gagal membalas, cek log worker",
  "task.reason.noPhotos": "belum ada fotonya",
  "task.reason.noPrice": "harga belum diisi di POS",
  "task.reason.confirmFailed": "konfirmasi gagal",
  "task.reason.notAutomatic": "belum bisa dibuat otomatis",
  "task.reason.notTold": "belum disampaikan ke pelanggan",
  "handoff.photos": "Minta foto",
  // ── Chatbot v2 screen (2026-10-15) ──────────────────────────────────────
  "chatbot.chat": "Chat",
  "chatbot.knowledgeBase": "Basis Pengetahuan",
  "chatbot.evaluation": "Evaluasi",
  "chatbot.settings": "Pengaturan",
  "chat.recentChats": "Chat terbaru",
  "chat.tagLead": "Prospek",
  "chat.tagReservation": "Ada reservasi",
  "chat.tagEscalation": "Perlu staf",
  "chat.unreadN": "{{n}} belum dibaca",
  "chat.queued": "Masuk antrean. Terkirim dalam beberapa detik.",
  "chat.sendFailed": "Balasan tidak bisa dikirim.",
  "chat.draftFailed": "Draf tidak bisa dibuat.",
  "chat.mediaQueued":
    "{{n}} foto masuk antrean. Terkirim dalam beberapa detik.",
  "chat.mediaWindowClosed":
    "Batas 24 jam sudah lewat, jadi WhatsApp tidak akan mengirim fotonya.",
  "chat.mediaNotFound":
    "Tidak ada unit dengan serial itu, atau unitnya belum punya foto QC.",
  "chat.mediaFailed": "Foto tidak bisa dilampirkan.",
  // What was sent: photos in the thread, edit and unsend (2026-10-23).
  "chat.photoGone": "Foto sudah tidak tersimpan",
  "chat.sentPhoto": "Foto terkirim",
  "chat.sentByShop": "Terkirim",
  // A picture from staff's own device (2026-10-27).
  "chat.sentByName": "Dikirim oleh {{name}}",
  "chat.attach": "Lampirkan",
  "chat.attachPicture": "Kirim gambar dari perangkat ini",
  "chat.pictureTitle": "Kirim gambar dari perangkat ini",
  "chat.pictureChoose": "Pilih gambar",
  "chat.pictureChooseAnother": "Pilih gambar lain",
  "chat.pictureWrongType": "Hanya gambar JPG, PNG atau WebP yang bisa dikirim.",
  "chat.pictureTooBig": "Gambar lebih dari 5 MB. Pilih yang lebih kecil.",
  "chat.pictureEmpty": "Berkas itu kosong.",
  "chat.pictureUnreadable": "Berkas itu tidak bisa dibaca.",
  "chat.pictureQueued": "Gambar masuk antrean. Terkirim dalam beberapa detik.",
  "chat.pictureWindowClosed":
    "Batas 24 jam sudah lewat, jadi WhatsApp tidak akan mengirim gambarnya.",
  "chat.pictureFailed": "Gambar tidak bisa dikirim.",
  "chat.picturePreview": "Gambar yang akan dikirim",
  "chat.pictureCaption": "Keterangan",
  "chat.pictureCaptionHint": "Keterangan (opsional)",
  "chat.pictureRules": "JPG, PNG atau WebP, maksimal 5 MB.",
  "chat.messageActions": "Aksi pesan",
  "chat.editMessage": "Ubah",
  "chat.unsend": "Tarik pesan",
  "chat.unsendTitle": "Tarik pesan ini?",
  "chat.unsendBody":
    "Pesan juga terhapus di pelanggan. Mereka akan melihat bahwa ada pesan yang dihapus.",
  "chat.unsent": "Pesan ditarik.",
  "chat.unsendFailed": "Pesan tidak bisa ditarik.",
  "chat.unsentLabel": "Pesan ditarik",
  "chat.editTitle": "Ubah pesan",
  "chat.saveEdit": "Simpan",
  "chat.editHint":
    "WhatsApp mengizinkan pesan diubah 15 menit setelah terkirim. Pelanggan melihatnya bertanda diedit.",
  "chat.edited": "Pesan diubah.",
  "chat.editFailed": "Pesan tidak bisa diubah.",
  "chat.editedLabel": "Diedit",
  "chat.editedBy": "Diedit oleh {{name}} · {{time}}",
  "chat.unsentBy": "Ditarik oleh {{name}} · {{time}}",
  // Clear chat / Delete conversation (2026-10-27).
  "chat.chatActions": "Aksi chat",
  "chat.clearChat": "Bersihkan chat",
  "chat.clearTitle": "Bersihkan chat ini?",
  "chat.clearBody":
    "Chat hilang dari daftar dan bot mulai dari awal: percakapan, status lead, dan yang dipelajari bot tentang pelanggan (nama, kebutuhan, budget, preferensi) dilupakan. Tidak ada yang dihapus: basis pengetahuan, data pelanggan, dan catatan dari tim tetap ada. Kalau pelanggan menulis lagi, chat muncul kembali dengan pesan barunya saja.",
  "chat.clearOk": "Bersihkan chat",
  "chat.cleared": "Chat dibersihkan.",
  "chat.clearFailed": "Chat tidak bisa dibersihkan.",
  "chat.deleteConversation": "Hapus percakapan",
  "chat.deleteTitle": "Hapus percakapan ini untuk selamanya?",
  "chat.deleteOk": "Hapus percakapan",
  "chat.deleteBody":
    "Semua pesan, yang sudah dikirim, dan ingatan bot tentang chat ini, termasuk yang dipelajari tentang pelanggan, dihapus dan tidak bisa dikembalikan. Data pelanggan, penilaian 👍/👎 dan koreksi basis pengetahuan tetap ada.",
  "chat.deleteTypeIt": "Ketik nomor",
  "chat.deleteToConfirm": "untuk konfirmasi.",
  "chat.deleteTypeAria": "Ketik nomor pelanggan untuk konfirmasi",
  "chat.deleted": "Percakapan dihapus.",
  "chat.deleteFailed": "Percakapan tidak bisa dihapus.",
  "chat.notDelivered": "Tidak terkirim",
  "chat.queuedLabel": "Dalam antrean",
  "chat.aiOn": "AI nyala",
  "chat.aiOff": "AI mati",
  "chat.showProfile": "Profil pelanggan",
  "chat.customerProfile": "Profil pelanggan",
  "chat.bot": "Bot",
  "chat.staff": "Staf",
  "chat.windowClosedLine":
    "Batas 24 jam sudah lewat — balasan bebas tidak akan sampai.",
  "chat.reply": "Balasan",
  "chat.draftHint":
    "Bot membaca chat ini dan menuliskan balasan untuk Anda. Tidak ada yang terkirim sebelum Anda menekan Kirim.",
  "chat.draftNeedsLogin": "Perlu login Claude di server",
  "chat.attachMedia": "Lampirkan foto unit",
  "chat.attachMediaTitle": "Kirim foto QC unit",
  "chat.attachSend": "Kirim foto",
  "chat.attachMediaHint":
    "Maksimal tiga foto QC unit dikirim ke pelanggan ini.",
  "chat.unitSerial": "Serial unit",
  "chatProfile.estimate": "perkiraan",
  "chatProfile.editField": "Ubah {{field}}",
  "chatProfile.budget": "Budget",
  "chatProfile.budgetMin": "Budget dari",
  "chatProfile.budgetMax": "Budget sampai",
  "chatProfile.save": "Simpan",
  "chatProfile.cancel": "Batal",
  "chatProfile.saveFailed": "Tidak bisa disimpan.",
  "chatProfile.removeFact": "Hapus {{value}}",
  "chatProfile.lead": "Prospek",
  "chatProfile.scoreHint":
    "Seberapa besar kemungkinan pelanggan ini membeli menurut bot, 0–100.",
  "chatProfile.botScore": "Skor bot {{score}}",
  "chatProfile.summary": "Ringkasan",
  "chatProfile.summaryWants": "Mau",
  "chatProfile.summaryNext": "Selanjutnya",
  "chatProfile.about": "Tentang",
  "chatProfile.name": "Nama",
  "chatProfile.age": "Usia",
  "chatProfile.occupation": "Pekerjaan atau sekolah",
  "chatProfile.usage": "Kebutuhan",
  "chatProfile.addUsage": "Tambah kebutuhan",
  "chatProfile.useCase": "Kata pelanggan",
  "chatProfile.apps": "Aplikasi",
  "chatProfile.addApp": "Tambah aplikasi",
  "chatProfile.preferences": "Preferensi",
  "chatProfile.addPreference": "Tambah preferensi",
  "chatProfile.preference": "Kata pelanggan",
  "chatProfile.other": "Lainnya",
  "chatProfile.addOther": "Tambah hal lain",
  "chatProfile.currentDevice": "Perangkat sekarang",
  "chatProfile.reservations": "Reservasi",
  "chatProfile.visit": "Kunjungan: {{when}}",
  "chatProfile.openTasks": "Tugas terbuka",
  "chatEval.good": "Bagus",
  "chatEval.bad": "Buruk",
  "chatEval.statusOpen": "Perlu ditinjau",
  "chatEval.statusApplied": "Diterapkan",
  "chatEval.statusDismissed": "Diabaikan",
  "chatEval.reasonWrongFact": "Fakta salah",
  "chatEval.reasonWrongTone": "Nada salah",
  "chatEval.reasonTooLong": "Terlalu panjang",
  "chatEval.reasonMissedQuestion": "Pertanyaan terlewat",
  "chatEval.reasonShouldEscalate": "Seharusnya diteruskan ke staf",
  "chatEval.reasonShouldNotEscalate": "Seharusnya tidak diteruskan ke staf",
  "chatEval.reasonOther": "Lainnya",
  "chatEval.saveFailed": "Penilaian tidak bisa disimpan.",
  "chatEval.badSaved": "Tersimpan. Ada di tab Evaluasi untuk ditinjau.",
  "chatEval.goodHint": "Balasan yang bagus",
  "chatEval.undoHint": "Tekan lagi untuk menarik penilaian",
  "chatEval.appliedLocked":
    "Penilaian ini sudah menjadi jawaban di Basis Pengetahuan — hapus di sana",
  "chatEval.reviewedLocked": "Penilaian ini sudah ditinjau",
  "chatEval.withdrawn": "Penilaian ditarik.",
  "chatEval.withdrawFailed": "Penilaian tidak bisa ditarik.",
  "chatEval.rateGood": "Balasan bagus",
  "chatEval.badHint": "Balasan yang buruk: jelaskan kenapa",
  "chatEval.rateBad": "Balasan buruk",
  "chatEval.badTitle": "Apa yang salah dengan balasan ini?",
  "chatEval.save": "Simpan",
  "chatEval.reason": "Alasan",
  "chatEval.reasonRequired": "Pilih alasan.",
  "chatEval.note": "Catatan",
  "chatEval.betterAnswer": "Jawaban yang lebih baik (opsional)",
  "chatEval.loadFailed": "Evaluasi tidak bisa dimuat.",
  "chatEval.applied": "Diterapkan. Mulai sekarang bot membaca jawaban ini.",
  "chatEval.applyFailed": "Tidak bisa diterapkan.",
  "chatEval.dismissFailed": "Tidak bisa diabaikan.",
  "chatEval.colDate": "Tanggal",
  "chatEval.colCustomer": "Pelanggan",
  "chatEval.colMessage": "Pesan pelanggan",
  "chatEval.colReply": "Balasan bot",
  "chatEval.colRating": "Penilaian",
  "chatEval.colReason": "Alasan",
  "chatEval.colAgent": "Agen",
  "chatEval.colNote": "Catatan / jawaban lebih baik",
  "chatEval.colStatus": "Status",
  "chatEval.colActions": "Aksi",
  "chatEval.apply": "Terapkan",
  "chatEval.dismiss": "Abaikan",
  "chatEval.delete": "Hapus",
  "chatEval.deleteTitle": "Hapus penilaian ini?",
  "chatEval.deleteAppliedBody":
    "Jawaban yang sudah masuk ke Knowledge Base tetap ada.",
  "chatEval.deleteOk": "Hapus",
  "chatEval.deleted": "Penilaian dihapus.",
  "chatEval.deleteFailed": "Tidak bisa menghapusnya.",
  "chatEval.openChat": "Buka chat",
  "chatEval.search": "Cari nomor, pesan, atau catatan",
  "chatEval.reload": "Muat ulang",
  "chatEval.applyTitle": "Terapkan jawaban yang lebih baik",
  "chatEval.whatTheBotSaid": "Yang dikatakan bot",
  "chatEval.betterAnswerLabel": "Jawaban yang lebih baik",
  "chatAgent.router": "Router",
  "chatAgent.advisor": "Penasihat Penjualan",
  "chatAgent.operations": "Operasional",
  "chatAgents.titleOne": "Agen",
  "chatAgents.loadFailed": "Agen tidak bisa dimuat.",
  "chatAgents.openPersona": "Persona {{name}}",
  "chatAgents.persona": "Persona",
  "chatAgents.saved": "Tersimpan. Bot memakainya mulai balasan berikutnya.",
  "chatAgents.wasReset": "Kembali ke persona bawaan.",
  "chatAgents.saveFailed": "Persona tidak bisa disimpan.",
  "chatAgents.default": "Bawaan",
  "chatAgents.edited": "Diubah",
  "chatAgents.reset": "Kembalikan ke bawaan",
  "chatAgents.close": "Tutup",
  "chatAgents.save": "Simpan",
  "chatAgents.prompt": "Prompt persona",
  "chatSim.noAi": "Tanpa AI",
  "chatSim.title": "Simulator",
  "chatSim.botName": "Bot Nusantara",
  "chatSim.restart": "Mulai dari awal",
  "chatSim.conversation": "Percakapan simulasi",
  "chatSim.empty":
    "Tulis seperti pelanggan. Tidak ada yang dikirim, dibooking, atau disimpan.",
  "chatSim.cost": "Biaya AI: {{cost}}",
  "chatSim.steps": "{{n}} langkah",
  "chatSim.noCredential":
    "Bot belum punya kredensial Claude di server, jadi tidak bisa menjawab.",
  "chatSim.failed": "Simulator tidak bisa menjawab.",
  "chatSim.handoff": "Diteruskan ke staf · {{topic}}",
  "chatSim.photos": "Akan melampirkan foto: {{ids}}",
  "chatSim.thinking": "Bot sedang menulis…",
  "chatSim.message": "Pesan Anda",
  "chatSim.placeholder": "Ketik pesan…",
  "chatSim.send": "Kirim",
  "products.skuSaved": "{{code}} disimpan.",
  "products.editSkuAria": "Ubah {{code}}",
  "products.editSku": "Ubah SKU",
  "products.saveSku": "Simpan",
  "products.skuCode": "Kode SKU",
  "products.skuCodeRequired": "Isi kode SKU",
  "products.skuCodeTaken": "Kode ini sudah dipakai varian lain",
  "opening.at": "Per tanggal",
  "opening.atHint":
    "Uang yang lunas sebelum tanggal ini sudah termasuk dalam angka ini dan tidak menggerakkan saldo lagi.",
  "opening.bank": "Saldo bank",
  "opening.cash": "Uang tunai di laci",
  "opening.saved": "Saldo awal disimpan.",
  "opening.title": "Saldo awal",
  "priceImport.apply": "Perbarui {{n}} unit",
  "priceImport.button": "Impor harga jual",
  "priceImport.conflict": "Dua harga untuk unit yang sama",
  "priceImport.done": "Harga {{n}} unit diperbarui.",
  "priceImport.heldNow": "Stok sekarang",
  "priceImport.moved":
    "{{n}} baris punya jumlah unit yang berbeda dari saat daftar diekspor (ditandai). Harga diterapkan ke stok yang ada sekarang.",
  "priceImport.onList": "Di daftar",
  "priceImport.newPrice": "Harga baru",
  "priceImport.noPrices":
    'Kolom harga tidak ditemukan. Gunakan Ekspor stok dan tambahkan kolom harga (mis. "Harga IG") di samping Unit dan Gudang.',
  "priceImport.noProduct": "Produk tidak ditemukan",
  "priceImport.noStock": "Tidak ada stok di sini",
  "priceImport.noWarehouse": "Gudang tidak ditemukan",
  "priceImport.now": "Sekarang",
  "priceImport.ok": "Akan diperbarui",
  "priceImport.onlyQc": "Masih QC — tidak diubah",
  "priceImport.pick": "Pilih daftar harga (.xlsx)",
  "priceImport.problems":
    "{{n}} baris tidak mengubah apa pun; alasannya ada di sampingnya.",
  "priceImport.problemsOnly": "Hanya baris yang tidak mengubah apa pun",
  "priceImport.qcLeft":
    "{{n}} unit yang masih QC tidak diubah — harganya ditentukan di invoice inbound-nya.",
  "priceImport.result": "Hasil",
  "priceImport.summary":
    "{{n}} unit akan mendapat harga jual baru, dari {{rows}} baris daftar.",
  "priceImport.title": "Impor harga jual",
  "priceImport.unchanged": "Harga sudah sama",
  "priceImport.unit": "Unit",
  "priceImport.units": "Diubah",
  "priceImport.unreadable": "File ini tidak bisa dibaca sebagai .xlsx.",
  "priceImport.warehouse": "Gudang",
  "dupReview.becomes": "Menjadi",
  "dupReview.different": "Ini produk berbeda",
  "dupReview.differentConfirm": "Ini produk yang berbeda?",
  "dupReview.differentOk": "Ya, berbeda",
  "dupReview.drops": "Sama dengan {{code}} — dihapus (tidak pernah dipakai)",
  "dupReview.joins": "Digabung ke {{code}} · {{n}} unit pindah",
  "dupReview.keepWhich": "Simpan produk yang mana?",
  "dupReview.label": "Pilihan",
  "dupReview.markedDifferent": "Dicatat — tidak akan disarankan lagi.",
  "dupReview.merge": "Gabung ke {{name}}",
  "dupReview.mergeConfirm": "Gabung ke {{name}}?",
  "dupReview.mergeDetail":
    "Unit pindah dengan catatan di riwayatnya. Varian yang punya penjualan tetap ada untuk nota lama. Tidak bisa dibatalkan dari sini.",
  "dupReview.mergeOk": "Gabung",
  "dupReview.merged": "Digabung ke {{name}}.",
  "dupReview.modelLine": "{{v}} varian · {{u}} unit disimpan",
  "dupReview.moves": "Pindah sebagai {{code}}",
  "dupReview.none": "Tidak ada produk yang tercatat dua kali.",
  "dupReview.stuck": "Tidak bisa ditempatkan",
  "dupReview.stuckWhy":
    "Beberapa varian tidak bisa ditempatkan di {{name}} — biasanya karena produk yang disimpan punya pilihan prosesor dan varian ini tidak menyebutnya. Pilih produk lain untuk disimpan.",
  "dupReview.title": "Tinjau produk ganda",
  "dupReview.variant": "Varian",
  "products.importDone":
    "{{added}} produk baru, {{linked}} dihubungkan ke produk yang sudah ada, {{skus}} varian ditambahkan. Harga mulai dari Rp 0 — atur sebelum dijual.",
  "products.importNothingNew":
    "Tidak ada yang baru — semua model yang dipilih sudah ada di katalog.",
  "products.inCatalogue": "Di katalog",
  "products.matchLinked": "Sudah terhubung",
  "products.matchLinkedTip": "Sudah terhubung ke {{name}}",
  "products.matchNew": "Baru",
  "products.matchPossible": "Mungkin sama",
  "products.matchPossibleTip":
    "Bisa jadi {{names}} — tidak diimpor. Pilih manual jika memang baru.",
  "products.matchSame": "Produk sama",
  "products.matchSameAs": "Sama dengan {{name}}",
  "products.matchSameTip":
    "Produk yang sama dengan {{name}} — impor akan menghubungkannya ke sana dan hanya menambah varian yang belum ada",
  "products.reviewDuplicates": "Tinjau duplikat ({{n}})",
  "products.addNVariants": "Tambah {{n}} varian",
  "products.appleSilicon": "Apple silicon (M1, M2…)",
  "products.deleteBlocked":
    "Produk ini punya riwayat stok atau penjualan dan tidak bisa dihapus.",
  "products.deleted": "{{name}} dihapus.",
  "products.eGM2": "mis. M2",
  "products.eGMagicMouse": "mis. Magic Mouse 2",
  "products.fullNamesDone": "{{n}} produk diganti namanya.",
  "products.i5i7": "i5, i7…",
  "products.intel": "Intel (i3, i5, i7…)",
  "products.line": "Lini",
  "products.planAddTo":
    "{{name}} sudah ada — {{n}} varian yang belum ada akan ditambahkan ke sana.",
  "products.planAxes":
    "{{name}} sudah ada dengan pilihan yang berbeda (dengan atau tanpa prosesor). Tambahkan dari tombol Varian produk itu.",
  "products.planExists": "{{name}} sudah punya semua varian ini.",
  "products.planNew": "Produk baru {{name}} dengan {{n}} varian.",
  "products.processor": "Prosesor",
  "products.processorOptions": "Pilihan prosesor",
  "products.processorOptionsHint":
    "Setiap prosesor menjadi varian dari produk yang sama.",
  "products.productAdded": "{{name}} ditambahkan dengan {{n}} varian.",
  "products.productName": "Nama produk",
  "products.screenSize": "Ukuran layar",
  "products.useFullNames": "Pakai nama produk lengkap ({{n}})",
  "products.useFullNamesTitle": "Ganti {{n}} nama produk ke nama lengkapnya?",
  "products.variantInUse":
    "Varian ini punya riwayat stok atau penjualan — tidak bisa dihapus",
  "products.variantsAddedTo": "{{n}} varian ditambahkan ke {{name}}.",
  "products.renameMachineCodes": "Ganti kode SKU ({{n}})",
  "products.renameMachineCodesTitle": "Ganti {{n}} kode SKU?",
  "products.renameMachineCodesBody":
    'Setiap kode SKU_… diganti dengan penamaan toko, mis. AIR 13" 2020 I7 8/128. Kode yang diketik manual tidak diubah.',
  "products.renameMachineCodesOk": "Ganti",
  "products.renameMachineCodesDone": "{{n}} kode SKU diganti.",
  "products.useShopNaming": "Pakai penamaan toko",
  "trade.editTitle": "Ubah tukar tambah",
  "trade.save": "Simpan",
  "pos.editTradeIn": "Ubah tukar tambah {{label}}",
  "inventory.rack": "Rak",
  "discount.editDiscount": "Ubah Diskon",
  "discount.notFound": "Diskon ini tidak ada.",
  "discounts.editAria": "Ubah {{name}}",
  "discounts.deleteAria": "Hapus {{name}}",
  "discounts.deleteConfirm": "Hapus {{name}}?",
  "discounts.deleteBlocked":
    "Sudah dipakai di penjualan, jadi tetap tercatat. Nonaktifkan saja.",
  "waConn.title": "Koneksi WhatsApp",
  "waConn.linkFailed": "Gagal memulai penautan.",
  "waConn.logoutTitle": "Putuskan WhatsApp?",
  "waConn.logoutBody":
    "Bot berhenti menjawab di nomor ini sampai ada yang memindai QR baru. Menautkan lagi dihitung dalam batas, dan sering menautkan lalu memutuskan bisa membuat nomor diblokir.",
  "waConn.logoutOk": "Putuskan",
  "waConn.loggedOut": "WhatsApp diputuskan.",
  "waConn.logoutFailed": "Gagal memutuskan.",
  "waConn.connected": "Tersambung",
  "waConn.waiting": "Menunggu dipindai",
  "waConn.connecting": "Menyambung",
  "waConn.disconnected": "Tidak tersambung",
  "waConn.endLoggedOut":
    "Perangkat dihapus dari HP (Perangkat tertaut). Tautkan lagi untuk melanjutkan.",
  "waConn.endQrExpired": "Kode QR tidak dipindai tepat waktu.",
  "waConn.endReplaced":
    "Sesi ini dibuka di tempat lain. Pastikan tidak ada komputer lain yang menjalankannya, lalu tautkan lagi.",
  "waConn.endForbidden":
    "WhatsApp menolak nomor ini. Periksa HP sebelum mencoba lagi.",
  "waConn.warnTitle": "Koneksi tidak resmi — WhatsApp bisa memblokir nomor ini",
  "waConn.warnRepeat":
    "Tautkan sekali lalu biarkan. Jangan menautkan dan memutuskan berulang kali.",
  "waConn.warnDedicated":
    "Sebaiknya pakai nomor khusus toko, bukan nomor pribadi seseorang.",
  "waConn.warnOnline":
    "Biarkan HP tetap menyala dan online: WhatsApp melepas perangkat tertaut bila HP-nya tidak aktif sekitar 14 hari.",
  "waConn.loadFailed": "Gagal membaca koneksi.",
  "waConn.notConfigured":
    "Server ini mengirim WhatsApp lewat Cloud API; tidak ada perangkat yang perlu ditautkan.",
  "waConn.gatewayDown": "Gateway WhatsApp tidak berjalan di server.",
  "waConn.checkAgain": "Periksa lagi",
  "waConn.status": "Status",
  "waConn.number": "Nomor tertaut",
  "waConn.since": "Tersambung sejak",
  "waConn.qrAlt": "Kode QR untuk menautkan WhatsApp",
  "waConn.scanHow":
    "Di HP toko: WhatsApp → Setelan → Perangkat tertaut → Tautkan perangkat, lalu pindai kode ini.",
  "waConn.link": "Tautkan WhatsApp",
  "waConn.logout": "Putuskan",
  "waConn.attemptsLeft":
    "Sisa {{remaining}} dari {{max}} percobaan menautkan dalam satu jam",
  "activity.clearWord": "HAPUS",
  "activity.e.auditLog": "Riwayat aktivitas",
  "activity.clear": "Hapus semua aktivitas",
  "activity.clearTitle": "Hapus semua aktivitas?",
  "activity.clearOk": "Hapus",
  "activity.cleared": "{{count}} baris aktivitas dihapus.",
  "activity.clearFailed": "Aktivitas tidak bisa dihapus.",
  "activity.clearBody":
    "Ini menghapus setiap baris riwayat aktivitas, untuk semua orang. Satu baris yang mencatat bahwa Anda menghapusnya tetap disimpan. Tidak ada yang bisa dikembalikan.",
  "activity.clearTypeIt": "Ketik",
  "activity.clearToConfirm": "untuk konfirmasi.",
  "activity.clearTypeAria": "Ketik kata untuk konfirmasi",
  "labels.summary":
    "{{count}} label, satu stiker 50 × 30 mm per label. Cetak dengan skala 100% tanpa margin.",
  "snTracking.deleteOnlyRow":
    "Unit selalu menyimpan setidaknya satu baris riwayat.",
  "snTracking.deleteLiveSale":
    "Unit ini masih ada di {{code}}. Hapus transaksinya di Riwayat Transaksi.",
  "snTracking.deleteRowTitle": "Hapus baris riwayat ini?",
  "snTracking.deleteRowBody":
    "“{{event}}” pada {{date}} dihapus dari riwayat unit ini untuk selamanya.",
  "snTracking.deleteRowOk": "Hapus baris",
  "snTracking.rowDeleted": "Baris riwayat dihapus.",
  "snTracking.deleteRow": "Hapus baris",
  "snTracking.rowMenu": "Lainnya untuk baris {{seq}}",
  "transactions.deleteReturned":
    "Ada yang diretur dari penjualan ini. Hapus returnya dulu.",
  "transactions.deleteTradeIn":
    "Penjualan ini menerima tukar tambah, yang sekarang ada di stok.",
  "transactions.deleteMoved":
    "Ada unit dari penjualan ini yang sudah berpindah (direservasi, dipindah, atau terjual lagi).",
  "transactions.deletePayout":
    "Pencairan marketplace sudah dicatat untuk penjualan ini.",
  "transactions.deleteLinked":
    "Ada catatan Pemasukan & Pengeluaran yang menaut penjualan ini.",
  "transactions.deleteTitle": "Hapus {{code}}?",
  "transactions.deleteBody":
    "Penjualan dan pembayarannya dihapus untuk selamanya, dan {{count}} unitnya kembali ke rak seperti sebelum dijual. Tidak bisa dibatalkan.",
  "transactions.deleteOk": "Hapus transaksi",
  "transactions.deleted": "{{code}} dihapus.",
  "transactions.deleteSale": "Hapus transaksi",
  "transactions.deleteSaleAria": "Hapus {{code}}",
  "editSale.pickProduct": "Pilih produk di setiap baris aksesori.",
  "editSale.belowReturned":
    "Jumlah di satu baris tidak bisa kurang dari yang sudah diretur.",
  "editSale.notEnoughStock": "Stok {{product}} tidak cukup untuk {{qty}} lagi.",
  "editSale.price": "Harga",
  "editSale.priceFor": "Harga",
  "editSale.accessories": "Aksesori (tanpa serial)",
  "editSale.product": "Produk",
  "editSale.productFor": "Produk",
  "editSale.pickProductOne": "Pilih produk",
  "editSale.qty": "Jml",
  "editSale.qtyFor": "Jumlah",
  "editSale.pricePerPiece": "Harga per buah",
  "editSale.piecePriceFor": "Harga per buah",
  "editSale.removeCounted": "Keluarkan produk ini",
  "editSale.addCounted": "Tambah aksesori",
  "editSale.newTotal": "Total {{total}}",
  "editSale.payoutTitle": "Pencairan {{channel}} — {{amount}}",
  "editSale.payoutReceived": "Dana sudah diterima",
  "editSale.payoutDate": "Diterima pada",
  "editSale.deductionName": "Potongan, mis. Komisi",
  "editSale.deductionNameFor": "Nama potongan",
  "editSale.deductionAmountFor": "Jumlah potongan",
  "editSale.removeDeduction": "Hapus potongan",
  "editSale.addDeduction": "Tambah potongan",
  "editSale.payoutLands": "Diterima {{amount}}",
  "editSale.charges": "Biaya tambahan",
  "editSale.chargeName": "Biaya, mis. Ongkir",
  "editSale.chargeNameFor": "Nama biaya",
  "editSale.chargeAmountFor": "Jumlah biaya",
  "editSale.removeCharge": "Hapus biaya",
  "editSale.addCharge": "Tambah biaya",
  "adjust.moveRecorded": "Uang dipindah antara kas dan bank.",
  "adjust.move": "Kas ↔ bank",
  "cashflow.hideBalance": "Sembunyikan {{what}}",
  "cashflow.showBalance": "Tampilkan {{what}}",
  "cashflow.cashPot": "Kas",
  "cashflow.bankPot": "Bank",
  "adjust.bankToCash": "Pencairan Dana Bank (bank → kas)",
  "adjust.cashToBank": "Setor Tunai ke Bank (kas → bank)",
  "editSale.items": "Barang",
  "editSale.item": "Barang",
  "editSale.itemFor": "Barang",
  "editSale.pickItem": "Pilih barang",
  "editSale.serialOrQty": "Serial / Jml",
  "editSale.serialPlaceholder": "Nomor seri",
  "editSale.pcs": "pcs",
  "editSale.pickItemFirst": "Pilih barangnya dulu",
  "editSale.lineTotal": "{{qty}} × = {{total}}",
  "editSale.removeItem": "Keluarkan barang ini",
  "editSale.addItem": "Tambah barang",
  "editSale.needsSerial": "Ketik nomor seri {{item}}.",
  "pay.addDeduction": "Tambah potongan",
  "pay.deductionName": "Potongan, mis. Komisi",
  "pay.deductionNameFor": "Nama potongan",
  "pay.deductionAmountFor": "Jumlah potongan",
  "pay.removeDeduction": "Hapus potongan",
  "pay.payoutLands": "{{amount}} − {{kept}} potongan = {{received}} diterima",
  "chat.mediaQueuedUnits":
    "Foto {{units}} unit masuk antrean ({{n}} foto). Terkirim dalam beberapa detik.",
  "chat.mediaSkipped":
    "Tidak terkirim, tidak ada foto atau sudah tidak dijual: {{serials}}",
  "chat.pickPhotosTitle": "Kirim foto unit",
  "chat.sendPickedPhotos": "Kirim foto {{n}} unit",
  "chat.pickProduct": "Produk",
  "chat.searchProduct": "Cari produk",
  "chat.noPhotographedUnits": "Belum ada unit dijual yang punya foto.",
  "chat.unitsWithPhotos": "{{n}} unit",
  "chat.serial": "Serial",
  "chat.grade": "Grade",
  "chat.price": "Harga",
  "chat.photos": "Foto",
  "chat.pickPhotosHint":
    "Setiap unit dikirim dengan satu baris namanya, lalu sampai tiga fotonya. Maksimal {{max}} unit sekaligus.",
  "editSale.unitMovedOn":
    "{{serial}} sudah berpindah sejak penjualan ini, jadi tidak bisa dikeluarkan dari sini.",
  "editSale.notOnShelf":
    "{{serial}} tidak ada di rak, jadi tidak bisa ditambahkan ke penjualan.",
  "snTracking.deleteDocumentRow":
    "Status unit saat ini bergantung pada baris ini ({{code}}). Batalkan dari layarnya sendiri — retur, reservasi, atau meja servis.",
  "Profit & Loss": "Laba Rugi",
  "pnl.title": "Laba Rugi",
  "pnl.reportTitle": "Laporan Laba Rugi",
  "pnl.sales": "Penjualan",
  "pnl.outsideSales": "Penjualan di luar aplikasi",
  "pnl.charges": "Pengiriman & biaya tambahan penjualan",
  "pnl.discounts": "Potongan penjualan",
  "pnl.returns": "Retur penjualan",
  "pnl.cogsSold": "Harga pokok unit terjual",
  "pnl.cogsReturned": "Harga pokok unit retur kembali ke stok",
  "pnl.operational": "Operasional",
  "pnl.payroll": "Gaji",
  "pnl.marketing": "Marketing & iklan",
  "pnl.rent": "Sewa dan fasilitas",
  "pnl.professional": "Jasa profesional",
  "pnl.software": "Software & teknologi",
  "pnl.bankFees": "Biaya bank & marketplace",
  "pnl.marketplaceFees": "Biaya marketplace",
  "pnl.interestIn": "Pendapatan bunga",
  "pnl.mismatchIn": "Selisih saldo lebih",
  "pnl.interestOut": "Bunga dan biaya bank",
  "pnl.mismatchOut": "Selisih saldo kurang",
  "pnl.compensation": "Kompensasi pelanggan",
  "pnl.stockAdjust": "Penyesuaian barang",
  "pnl.code": "Kode",
  "pnl.account": "Akun",
  "pnl.amount": "Jumlah",
  "pnl.exportXlsx": "Ekspor .xlsx",
  "pnl.exportPdf": "Ekspor .pdf",
  "pnl.byMonth": "Bulan",
  "pnl.byRange": "Rentang tanggal",
  "pnl.month": "Bulan",
  "pnl.noSales": "Tidak ada penjualan di periode ini.",
  "pnl.revenue": "Pendapatan",
  "pnl.totalRevenue": "Total pendapatan",
  "pnl.cogs": "Biaya pokok penjualan",
  "pnl.totalCogs": "Total biaya pokok penjualan",
  "pnl.grossProfit": "Laba kotor",
  "pnl.operating": "Biaya operasional",
  "pnl.totalOperating": "Total biaya operasional",
  "pnl.operatingProfit": "Pendapatan bersih operasional",
  "pnl.otherIncome": "Pendapatan non operasional",
  "pnl.otherExpense": "Biaya non operasional",
  "pnl.totalOther": "Total pendapatan non operasional",
  "pnl.netProfit": "Laba bersih",
  "pnl.detailTitle": "Laba Rugi — rincian transaksi",
  "pnl.detailSheet": "Transaksi",
  "pnl.date": "Tanggal",
  "pnl.ref": "Transaksi",
  "pnl.description": "Keterangan",
  "pnl.detailHeading": "Transaksi",
  "pnl.pickLine": "Klik baris laporan untuk melihat transaksi di baliknya.",
  "pnl.noItems": "Tidak ada transaksi di baris ini.",
  "pnl.searchProduct": "Cari produk",
  "pnl.product": "Produk",
  "pnl.sold": "Terjual",
  "pnl.cost": "Modal",
  "pnl.profit": "Laba",
  "pnl.perUnit": "Rata-rata laba per unit",
  "pnl.margin": "Margin",
  "pnl.export": "Ekspor",
  "pnl.exportOk": "Unduh",
  "pnl.exportStatement": "Laporannya",
  "pnl.exportDetail": "Semua transaksi di baliknya",
  "pnl.tabStatement": "Laporan",
  "pnl.tabUnits": "Laba per unit",
  "pnl.tabMonths": "Per bulan",
  "pnl.formatXlsx": "Excel (.xlsx)",
  "pnl.formatPdf": "PDF (.pdf)",
  "cashflow.trendTitle": "Pendapatan vs. pengeluaran",
  "cashflow.months3": "3 bulan",
  "cashflow.months6": "6 bulan",
  "cashflow.months12": "12 bulan",
  "cashflow.revenue": "Pendapatan",
  "cashflow.expenses": "Pengeluaran",
  "cashflow.breakdownTitle": "Rincian pengeluaran",
  "cashflow.otherExpenses": "Lainnya",
  "cashflow.noExpenses": "Tidak ada pengeluaran di periode ini.",
  "cashflow.deleteClosed":
    "Buku sudah ditutup untuk bulan ini. Buka kembali untuk menghapus penyesuaian ini.",
  "cashflow.deleteTitle": "Hapus penyesuaian ini?",
  "cashflow.deleteMoveBody":
    "{{description}} — {{amount}}. Kedua sisi perpindahan kas ↔ bank ini dihapus permanen, dan saldo dihitung ulang tanpanya.",
  "cashflow.deleteBody":
    "{{description}} — {{amount}}. Penyesuaian ini dihapus permanen, dan saldo dihitung ulang tanpanya.",
  "cashflow.deleteOk": "Hapus penyesuaian",
  "cashflow.deleted": "Penyesuaian dihapus.",
  "cashflow.deleteAdjustment": "Hapus penyesuaian",
  "cashflow.deleteAdjustmentAria": "Hapus {{description}}",

  // ── Waiting for QC on /inbound, and its count on the nav (2026-10-26) ─────
  "qcWaiting.title": "Menunggu QC ({{count}})",
  "qcWaiting.search": "Cari produk, kode SKU, serial, order atau nomor invoice",
  "qcWaiting.openRow": "Buka {{code}} untuk {{unit}}",
  "qcWaiting.product": "Produk",
  "qcWaiting.serial": "Serial",
  "qcWaiting.noSerialYet": "Belum ada serial",
  "qcWaiting.invoice": "Invoice",
  "qcWaiting.supplier": "Supplier",
  "qcWaiting.arrived": "Tiba",
  "qcWaiting.daysWaiting": "Hari menunggu",
  "inboundList.toQc": "Belum QC",
  "nav.qcWaiting": "{{count}} unit menunggu QC",

  // ── Return to supplier, with its money (2026-10-26) ───────────────────────
  "supplierReturn.title": "Retur {{serial}} ke supplier",
  "supplierReturn.date": "Tanggal",
  "supplierReturn.credit": "Kredit",
  "supplierReturn.creditHint":
    "Yang harus dikembalikan supplier untuk unit ini — harga unitnya, kecuali disepakati lain.",
  "supplierReturn.serviceCharges": "Biaya servis unit ini: {{amount}}",
  "supplierReturn.addService": "Tambah biaya servis",
  "supplierReturn.serviceAdded": "Biaya servis ditambahkan",
  "supplierReturn.offInvoice":
    "{{amount}} memotong invoice {{code}} (sisa belum dibayar {{owed}})",
  "supplierReturn.refundPart": "{{amount}} dikembalikan supplier",
  "supplierReturn.receivedInto": "Diterima ke",
  "supplierReturn.receivedIntoRequired":
    "Pilih ke mana uang kembali, atau bahwa belum dibayar.",
  "supplierReturn.intoBank": "Bank",
  "supplierReturn.intoOtherBank": "Bank lain",
  "supplierReturn.intoCash": "Tunai",
  "supplierReturn.notPaidYet": "Belum dibayar supplier",
  "supplierReturn.fromInvoice": "Dari invoice {{code}}",
  "supplierReturn.held":
    "Sudah direservasi pelanggan — lepas reservasinya dulu.",
  "supplierReturn.notInStock":
    "Hanya unit yang sedang QC, ada di stok, atau di servis yang bisa diretur ke supplier.",
  "supplierReturn.refused":
    "{{serial}} tidak bisa lagi diretur ke supplier — sudah direservasi, terjual, atau diretur.",
  "supplierReturn.done": "{{serial}} sudah diretur ke supplier ({{code}}).",
  "returns.money": "Kredit",
  "returns.offInvoice": "{{amount}} memotong {{code}}",
  "returns.refundReceived": "Diterima: {{amount}}",
  "returns.refundKept": "Refund tetap tercatat: {{amount}}",
  "returns.awaitingRefund": "Menunggu refund {{amount}}",
  "returns.markReceived": "Tandai diterima",
  "returns.markReceivedAria": "Tandai refund {{code}} diterima",
  "returns.receiveTitle": "Refund diterima untuk {{code}}",
  "returns.refundAmount": "Jumlah diterima",
  "returns.refundAmountRange":
    "Antara Rp 1 dan sisa yang ditunggu ({{amount}}).",
  "returns.refundRecorded": "{{amount}} diterima untuk {{code}}.",
  "returns.undoSupplierBody":
    "{{code}} tetap ada di riwayat, ditandai ditarik, dan unitnya kembali ke posisi sebelum diretur. Kreditnya dihapus dari invoice. Refund yang sudah dibayar supplier tetap tercatat diterima.",
  "inbound.returnCredit": "Kredit retur supplier",
  "inbound.returnCreditLocked":
    "Kredit dari retur supplier — tarik returnya untuk menghapusnya.",
  "supplier.entryReturnCredit": "Kredit retur",
  "service.showFinished": "Tampilkan yang selesai",
  "service.finished": "Selesai {{when}}",

  // English-keyed (2026-10-26): the expense category a paid service charge is
  // filed under, and the method a supplier-return credit is written with.
  "Unit expense": "Biaya unit",
  "Supplier return credit": "Kredit retur supplier",
  // English-keyed (2026-10-27): the bank / marketplace fee expense category.
  "Bank / marketplace fee": "Biaya bank / marketplace",
  "Admin charges, transfer fees and what a marketplace kept.":
    "Biaya admin, biaya transfer, dan potongan marketplace.",
  // The sales strategy (2026-10-27): the funnel, the bot's visits, the
  // closing / welcome / restock tasks and "tell me when it's in stock".
  "chatAction.closing": "Closing",
  "chatFunnel.title": "Corong penjualan",
  "chatFunnel.stage": "Tahap",
  "chatFunnel.last7": "7 hari terakhir",
  "chatFunnel.last30": "30 hari terakhir",
  "chatFunnel.chats": "Chat",
  "chatFunnel.leads": "Lead",
  "chatFunnel.visits": "Kunjungan dibooking",
  "chatFunnel.closing": "Siap beli",
  "chatFunnel.chatsHint":
    "Pelanggan yang menghubungi. Nomor tester dan chat yang sudah dibersihkan tidak dihitung.",
  "chatFunnel.leadsHint":
    "Chat yang dinilai bot sebagai calon pembeli serius (🔥).",
  "chatFunnel.visitsHint": "Pelanggan yang membuat janji datang ke toko.",
  "chatFunnel.closingHint":
    "Pelanggan yang bilang mau beli, atau bertanya cara bayar, DP, atau nego harga — diteruskan ke staf untuk menyelesaikan penjualan.",
  "chatFunnel.sales": "Penjualan",
  "chatFunnel.salesHint":
    "Membeli dari nomor ini dalam 30 hari sejak pesan pertamanya.",
  "chatFunnel.loadFailed": "Corong penjualan tidak bisa dimuat.",
  // Why the bot hands over (2026-10-27).
  "chatHandovers.title": "Diteruskan ke staf (7 hari terakhir)",
  "chatHandovers.total": "{{n}} total",
  "chatHandovers.loadFailed": "Data penerusan tidak bisa dimuat.",
  "chatHandovers.none": "Tidak ada yang diteruskan dalam 7 hari terakhir.",
  "chatHandovers.at": "Waktu",
  "chatHandovers.phone": "Nomor",
  "chatHandovers.message": "Pesan pelanggan",
  "chatHandovers.summary": "Tugas",
  "chatHandovers.topic": "Topik",
  "chatHandovers.reason": "Alasan",
  "chatHandovers.count": "Jumlah",
  "chatHandovers.reasonBot": "Bot memilih meneruskan",
  "chatHandovers.reasonRoute": "Isi pesannya (aturan)",
  "chatHandovers.reasonAmount": "Draf menyebut harga tanpa sumber",
  "chatHandovers.reasonStock": "Draf menyebut stok tanpa sumber",
  "chatHandovers.reasonDiscount": "Draf menawarkan diskon",
  "chatHandovers.reasonSource": "Draf tanpa sumber yang valid",
  "chatHandovers.reasonLength": "Draf terlalu panjang atau kosong",
  "chatHandovers.reasonUnfinished": "Bot tidak menyelesaikan jawabannya",
  "chatHandovers.reasonError": "Bot gagal (lihat log worker)",
  "chatHandovers.reasonWindow": "Jendela 24 jam sudah tutup",
  "chatHandovers.reasonNoText": "Pesan tanpa teks",
  "chatProfile.watches": "Menunggu stok",
  "chatProfile.watchAsked": "Ditanyakan {{when}}",
  "chatProfile.watchAskedBudget": "Ditanyakan {{when}}, maksimal {{budget}}",
  "chatProfile.watchClosed": "Ditutup",
  "chatProfile.watchInStock": "Sudah ready — kabari pelanggan",
  "chatProfile.closeWatch": "Tutup",
  "chatProfile.closeWatchAria": "Tutup {{what}}",
  "chatProfile.visitOnly": "Kunjungan, tidak ada unit ditahan",
  "handoff.closing": "Siap beli",
  "handoff.visit": "Kunjungan",
  "handoff.restock": "Stok kembali",
  "task.need.closing": "Perlu closing",
  "task.need.welcome": "Perlu sambut",
  "task.need.notify": "Perlu kabari",
  "pos.visit": "Kunjungan",
  "pos.loadedFromVisit": "{{name}} dimuat dari kunjungan {{code}}.",
  "reservations.visit": "Kunjungan",
  "reservations.came": "Datang",
  "reservations.cameAria": "{{name}} datang untuk {{code}}",
  "reservations.cancel": "Batalkan",
  "reservations.cancelVisit": "Batalkan kunjungan ini?",
  "reservations.cancelVisitBody":
    "{{name}} tidak jadi datang. Tidak ada unit yang ditahan, jadi tidak ada unit yang berpindah.",
  "reservations.cancelVisitOk": "Batalkan kunjungan",
  "reservations.cancelVisitAria": "Batalkan kunjungan {{code}}",
  "reservations.keepVisit": "Tetap simpan",
  "reservations.visitCame": "Kunjungan ditandai datang.",
  "reservations.visitCancelled": "Kunjungan dibatalkan.",

  // ── Reconciliation (2026-10-27) ──────────────────────────────────────────
  // "Rekonsiliasi" is the bookkeeper's word and the one the owner used. A pot
  // is "Bank" / "Kas" — the drawer is the shop's kas, as on Income & Expense.
  Reconciliation: "Rekonsiliasi",
  "finance.reconciliation": "Rekonsiliasi",
  "cashflow.deleteReconciledMonth":
    "Rekonsiliasi bank {{month}} mencocokkan baris ini. Buka kembali rekonsiliasi itu dulu.",
  "cashflow.deleteReconciledDay":
    "Rekonsiliasi {{pot}} tanggal {{day}} mencatat baris ini. Buka kembali rekonsiliasi itu dulu.",
  "cashflow.todayUnreconciled": "Hari ini belum direkonsiliasi",
  "recon.bank": "Bank",
  "recon.cash": "Kas",
  "recon.reconcile": "Rekonsiliasi",
  "recon.blockNotFound": "Catatan ini sudah tidak ada.",
  "recon.blockSaleLocked":
    "Penjualan ini sudah selesai di bulan yang bukunya ditutup. Buka kembali buku untuk mengoreksinya.",
  "recon.blockBooksClosed":
    "Buku sudah ditutup untuk tanggal ini. Buka kembali untuk mengoreksi jumlahnya.",
  "recon.blockServiceCharge":
    "Ini membayar biaya servis — koreksi biayanya di meja servis, dan ini ikut.",
  "recon.blockInvoiceClosed":
    "Invoice supplier sudah ditutup. Buka kembali untuk mengoreksi pembayarannya.",
  "recon.blockBelowAllocated":
    "Dari deposit ini sudah dialokasikan ke invoice lebih dari jumlah ini.",
  "recon.blockNotPositive":
    "Jumlah harus lebih dari nol. Hapus catatannya di layarnya sendiri.",
  "recon.enterOne": "Isi saldo bank, kas yang dihitung, atau keduanya.",
  "recon.matchedPots": "{{pots}} cocok dengan POS.",
  "recon.reconcileTitle": "Rekonsiliasi satu hari",
  "recon.check": "Cocokkan dengan POS",
  "recon.day": "Tanggal",
  "recon.pickDay": "Pilih tanggalnya.",
  "recon.actualBank": "Saldo bank (dari bank)",
  "recon.countedCash": "Kas yang dihitung di laci",
  "recon.savedOpen": "Tersimpan dengan selisih yang masih terbuka.",
  "recon.savedBalanced": "{{pot}} sudah direkonsiliasi.",
  "recon.potTitle": "Rekonsiliasi {{pot}} — {{day}}",
  "recon.save": "Simpan rekonsiliasi",
  "recon.posBalance": "Saldo POS",
  "recon.actual": "Saldo sebenarnya",
  "recon.difference": "Selisih",
  "recon.noMovements":
    "Tidak ada uang yang bergerak di kas/bank ini pada hari ini.",
  "recon.time": "Jam",
  "recon.descriptionItem": "Keterangan / barang",
  "recon.added": "Ditambahkan",
  "recon.amountOf": "Jumlah {{what}}",
  "recon.addTransaction": "Tambah transaksi",
  "recon.note": "Catatan",
  "recon.noteNeeded":
    "Tulis kenapa selisihnya dibiarkan — disimpan sebagai terbuka.",
  "recon.leftOpen":
    "Masih ada selisih {{amount}}. Kalau disimpan sekarang, hari ini tetap terbuka.",
  "recon.whatChanged": "Yang diubah rekonsiliasi ini ({{n}})",
  "recon.when": "Kapan",
  "recon.record": "Catatan",
  "recon.change": "Perubahan",
  "recon.who": "Oleh",
  "recon.reasonExact": "Jumlah sama, hari sama",
  "recon.reasonDateShift": "Jumlah sama, dibukukan belakangan",
  "recon.reasonTypo": "Salah ketik",
  "recon.reasonDeduction": "Potongan",
  "recon.reasonSplit": "Satu baris bank, beberapa transaksi POS",
  "recon.reasonMerge": "Beberapa baris bank, satu transaksi POS",
  "recon.reasonAdded": "Ditambahkan ke POS",
  "recon.reasonManual": "Dipasangkan manual",
  "recon.lineMatched": "Cocok",
  "recon.lineSuggested": "Saran",
  "recon.lineIgnored": "Dikesampingkan",
  "recon.lineUnmatched": "Belum cocok",
  "recon.guessNone": "Kategori belum ditebak",
  "recon.doTypo": "Koreksi jumlah di POS menjadi {{amount}}",
  "recon.doDeduction": "Catat {{amount}} sebagai biaya (pengeluaran)",
  "recon.doSplit":
    "{{n}} transaksi POS ini jumlahnya sama dengan baris bank ini",
  "recon.doMerge":
    "{{n}} baris bank ini jumlahnya sama dengan transaksi POS ini",
  "recon.typoFixed": "Jumlah di POS sudah dikoreksi.",
  "recon.feeLabel": "Biaya terpotong — {{what}}",
  "recon.feeRecorded": "Biaya dicatat sebagai pengeluaran.",
  "recon.paired": "Sudah dicocokkan.",
  "recon.allMonths": "Semua bulan",
  "recon.monthTitle": "Rekening koran — {{month}}",
  "recon.statusReconciled": "Sudah direkonsiliasi",
  "recon.delete": "Hapus",
  "recon.dayDeleted": "Rekonsiliasi {{day}} dihapus.",
  "recon.monthDeleted": "Rekonsiliasi {{month}} dihapus.",
  "recon.deleteDayTitle": "Hapus rekonsiliasi {{day}}?",
  "recon.deleteMonthTitle": "Hapus rekonsiliasi {{month}}?",
  "recon.deleteKeepsCorrections":
    "Koreksi yang sudah dibuat pada transaksi tetap ada.",
  "recon.deleteMonthBody":
    "Ini menghapus mutasi yang diunggah, baris dan pasangannya, catatan yang dibuat untuknya, serta lognya.",
  "recon.deleteTypeIt": "Ketik",
  "recon.deleteToConfirm": "untuk konfirmasi.",
  "recon.deleteTypeAria": "Ketik bulannya untuk konfirmasi",
  "recon.statusOpen": "Terbuka",
  "recon.openingOff":
    "Rekening koran dibuka di {{statement}} dan POS di {{pos}} — selisih {{diff}}. Ada bulan sebelumnya yang tidak cocok; rekonsiliasi bulan itu dulu.",
  "recon.statementOpening": "Saldo awal rekening koran",
  "recon.posOpening": "Saldo awal POS",
  "recon.statementClosing": "Saldo akhir rekening koran",
  "recon.posClosing": "Saldo akhir POS",
  "recon.linesState": "Cocok · dikoreksi · sisa",
  "recon.reopen": "Buka kembali",
  "recon.matchAgain": "Cocokkan lagi",
  "recon.markReconciled": "Tandai bulan ini sudah direkonsiliasi",
  "recon.suggestions": "Saran ({{n}})",
  "recon.reason": "Alasan",
  "recon.bankSide": "Bank",
  "recon.posSide": "POS",
  "recon.whatToDo": "Yang perlu dilakukan",
  "recon.accept": "Terima",
  "recon.reject": "Tolak",
  "recon.statementLines": "Baris rekening koran",
  "recon.searchLines": "Cari keterangan atau jumlah",
  "recon.no": "No.",
  "recon.matchedTo": "Dicocokkan dengan",
  "recon.addToPos": "Tambah ke POS",
  "recon.pair": "Pasangkan",
  "recon.ignore": "Kesampingkan",
  "recon.undo": "Batalkan",
  "recon.posOnly": "Ada di POS, tidak ada di rekening koran ({{n}})",
  "recon.posOnlyNone":
    "Semua transaksi bank POS bulan ini ada di rekening koran.",
  "recon.openRecord": "Buka",
  "recon.pairTitle": "Pasangkan manual",
  "recon.bankLines": "Baris bank",
  "recon.posMovements": "Transaksi POS",
  "recon.pairDiffers":
    "Bank mencatat {{bank}} dan POS {{pos}}. Memasangkan tidak mengubah keduanya; koreksi catatannya kalau POS yang salah.",
  "recon.ignoreTitle": "Kesampingkan baris ini",
  "recon.ignoreWhy": "Kenapa POS tidak perlu mencatat baris ini?",
  "recon.blockNoLines": "Unggah rekening koran dulu",
  "recon.blockLines":
    "{{n}} baris rekening koran belum dicocokkan atau dikesampingkan",
  "recon.blockPosOnly":
    "{{n}} transaksi POS tidak pernah masuk ke bank — pasangkan atau beri penjelasan",
  "recon.explained": "Penjelasan",
  "recon.setAsideTag": "Dikesampingkan",
  "recon.asideBy": "{{who}} · {{when}}",
  "recon.setAside": "Kesampingkan dengan catatan",
  "recon.setAsideTitle": "Kesampingkan transaksi ini",
  "recon.setAsideOk": "Kesampingkan",
  "recon.setAsideWhy": "Kenapa bank tidak pernah mencatatnya?",
  "recon.statusMatched": "Cocok",
  "recon.statusAdjusted": "Dikoreksi",
  "recon.problemNoLines": "File ini tidak berisi mutasi.",
  "recon.problemAddUp":
    "Saldo awal + kredit − debit menjadi {{computed}}, tetapi rekening koran ditutup di {{closing}}.",
  "recon.problemCreditTotal":
    "Total kredit menjadi {{summed}}; rekening koran menyebut {{stated}}.",
  "recon.problemDebitTotal":
    "Total debit menjadi {{summed}}; rekening koran menyebut {{stated}}.",
  "recon.problemCreditCount":
    "{{counted}} kredit terbaca; rekening koran menyebut {{stated}}.",
  "recon.problemDebitCount":
    "{{counted}} debit terbaca; rekening koran menyebut {{stated}}.",
  "recon.problemBalance":
    "Di baris {{line}} saldo berjalan seharusnya {{expected}}; rekening koran mencetak {{printed}}.",
  "recon.posShort": "POS",
  "recon.actualShort": "Sebenarnya",
  "recon.diffShort": "Selisih",
  "recon.changedSince": "Berubah sejak direkonsiliasi",
  "recon.continuePot": "Lanjutkan {{pot}}",
  "recon.reopenPot": "Buka kembali {{pot}}",
  "recon.searchNote": "Cari catatan",
  "recon.notAStatement":
    "File ini tidak terbaca sebagai e-statement BCA atau unduhan mutasi KlikBCA.",
  "recon.unreadable": "File tidak bisa dibaca.",
  "recon.uploaded": "Rekening koran terbaca dan sudah dicocokkan.",
  "recon.month": "Bulan",
  "recon.statementOpenClose": "Saldo awal / akhir rekening koran",
  "recon.posOpenClose": "Saldo awal / akhir POS",
  "recon.openMonth": "Buka",
  "recon.uploadStatement": "Unggah rekening koran",
  "recon.daily": "Harian",
  "recon.monthly": "Bulanan",
  "recon.refusedTitle": "Rekening koran ini tidak diterima",
  "recon.previewTitle": "Rekening koran — {{month}}",
  "recon.replaceAndMatch": "Ganti barisnya dan cocokkan",
  "recon.readAndMatch": "Cocokkan dengan POS",
  "recon.addsUp":
    "{{n}} mutasi terbaca — {{cr}} kredit dan {{db}} debit — dan rekening korannya cocok jumlahnya.",
  "recon.period": "Periode",
  "recon.openingOffShort":
    "Saldo awalnya berbeda {{diff}} dari POS — ada bulan sebelumnya yang tidak cocok.",
  "recon.senNote":
    "{{n}} baris memuat sen. Jumlah disimpan dalam rupiah seperti tercetak; sennya sudah diperiksa dan tidak dibawa.",
  "recon.replaces":
    "Bulan ini sudah punya rekening koran. Baris dan pasangannya diganti; koreksi yang sudah dibuat tetap ada.",
  // DP holds (2026-10-27).
  "DP received": "DP diterima",
  "DP hangus": "DP hangus",
  "cashflow.dpFrom": "DP dari {{name}}",
  "cashflow.dpRefundTo": "DP dikembalikan ke {{name}}",
  "dp.amount": "Jumlah DP",
  "dp.amountNeeded": "Isi jumlah DP.",
  "dp.applied": "DP {{amount}} · sudah dipakai di penjualan",
  "dp.date": "Tanggal DP",
  "dp.decide": "Putuskan DP",
  "dp.decideAria": "Putuskan DP di {{code}}",
  "dp.decideBody":
    "{{name}} sudah DP {{amount}} dan tidak melunasi. Kembalikan, atau hangus?",
  "dp.decideEarly":
    "Masa tahannya belum habis — memutuskan sekarang mengembalikan unitnya ke stok jual.",
  "dp.decideTitle": "Putuskan DP — {{code}}",
  "dp.heldUntil": "DP {{amount}} · ditahan sampai {{until}}",
  "dp.keep": "Hangus (simpan)",
  "dp.kept": "DP {{amount}} · hangus",
  "dp.keptToast": "DP {{amount}} hangus.",
  "dp.method": "Dibayar lewat",
  "dp.noDpNotHeld": "Belum DP — unit masih dijual",
  "dp.notPaid": "Belum DP",
  "dp.note": "Catatan",
  "dp.pickDate": "Pilih tanggal DP.",
  "dp.record": "Catat DP",
  "dp.recordAria": "Catat DP di {{code}}",
  "dp.recordHint":
    "Cek mutasi bank atau hitung uang tunainya dulu. Unit ditahan {{days}} hari dari tanggal DP.",
  "dp.recordOk": "Catat DP dan tahan unit",
  "dp.recordTitle": "Catat DP — {{code}}",
  "dp.recorded":
    "DP {{amount}} tercatat — {{count}} unit ditahan untuk {{name}} sampai {{until}}.",
  "dp.refund": "Kembalikan {{amount}}",
  "dp.refundFrom": "Dikembalikan lewat",
  "dp.refunded": "DP {{amount}} · dikembalikan",
  "dp.refundedToast": "DP {{amount}} dikembalikan ke {{name}}.",
  "dp.waitingDecision": "DP {{amount}} · masa tahan habis, perlu diputuskan",
  "handoff.dp": "DP",
  "handoff.hold": "Reservasi",
  "pnl.dpForfeited": "DP hangus",
  "pos.dp": "DP",
  "pos.dpAlreadyPaid": "DP sudah dibayar ({{code}})",
  "pos.dpConfirmLine": "{{amount}} sudah dibayar ({{code}})",
  "pos.dpPaidShort": "{{amount}} sudah dibayar",
  "pos.dpShort": "DP",
  "pos.expectedOn": "Rencana datang",
  "pos.leftToPay": "Sisa yang dibayar",
  "pos.loadedDp":
    "{{name}} dan DP {{amount}} dari {{code}} dimuat — pilih unitnya dari rak.",
  "pos.reservationPickerHintDp":
    "Memilih satu memuat unit, pelanggan, dan DP-nya ke penjualan di bawah. Hanya reservasi yang sudah DP yang menahan unitnya; tanpa DP unitnya tetap dijual.",
  "pos.reservedNotPaid": "Direservasi untuk {{name}}, belum DP",
  "pos.sellAnyway": "Tetap jual",
  "pos.soldOverAsk":
    "{{serial}} direservasi untuk {{name}}, belum DP. Tetap jual?",
  "pos.soldOverBody":
    "Mencatat penjualan ini melepasnya dari {{code}}, dan rekan mendapat tugas untuk mengabari pelanggannya.",
  "pos.soldOverNote": "{{serial}} terjual ke pembeli lain di {{code}}.",
  "reservations.expectedOn": "Rencana datang",
  "reservations.reservedN":
    "{{count}} unit direservasi — tetap dijual sampai DP-nya dicatat.",
  "settings.dpAmount": "Jumlah DP",
  "settings.dpDays": "Ditahan selama (hari)",
  "settings.dpHint":
    "Hanya DP yang menahan unit. Tanpa DP, reservasi tidak menahan unitnya dari penjualan.",
  "settings.dpTitle": "DP untuk menahan unit",
  "settings.tabDp": "DP",
  "task.need.decideDp": "Perlu putuskan DP",
  "task.need.verifyDp": "Perlu verifikasi DP",
  "transactions.deleteDp":
    "Sebagian penjualan ini dibayar dengan DP reservasi.",
  // Reservation requests the bot files from a chat (2026-10-27).
  "nav.reservationRequests": "{{count}} permintaan reservasi menunggu",
  "requests.approve": "Setujui",
  "requests.placeNote":
    "Alamat tidak disertakan kalau sudah pernah dikirim di chat ini.",
  "requests.approveFailed": "Gagal menyetujui.",
  "requests.approveTitle": "Setujui reservasi — {{name}}",
  "requests.approved": "Disetujui",
  "requests.approvedToast": "Tercatat sebagai {{code}}.",
  "requests.dpProofSent": "Bukti DP dikirim",
  "requests.dpReceived": "DP sudah diterima",
  "requests.expired": "Kedaluwarsa",
  "requests.openChat": "Buka chat",
  "requests.pending": "Menunggu",
  "requests.pickTime": "Pilih hari dan jamnya.",
  "requests.reason": "Alasan",
  "requests.reasonNeeded": "Tulis alasannya singkat.",
  "requests.reject": "Tolak",
  "requests.rejectFailed": "Gagal menolak.",
  "requests.rejectTitle": "Tolak reservasi — {{name}}",
  "requests.rejected": "Ditolak",
  "requests.rejectedToast": "Permintaan ditolak.",
  "requests.replaced": "Diganti",
  "requests.search": "Cari pelanggan, nomor, atau serial",
  "requests.status": "Status",
  "requests.stripTitle": "Permintaan reservasi",
  "requests.tab": "Permintaan",
  "requests.tellCustomer": "Kabari pelanggan",
  "requests.time": "Waktu",
  "requests.units": "Unit",
  "requests.unitsExtra": "Kosongkan untuk jadwal kunjungan tanpa unit.",
  "requests.unitsGone":
    "Sudah tidak dijual: {{units}}. Pilih unit lain atau setujui sebagai kunjungan.",
  "requests.visitOnly": "Hanya kunjungan",
  "requests.waitingForDp": "Menunggu DP",
  "requests.windowClosed":
    "Jendela WhatsApp 24 jam sudah tutup, jadi tidak ada yang terkirim — kabari pelanggan lewat cara lain.",
};
