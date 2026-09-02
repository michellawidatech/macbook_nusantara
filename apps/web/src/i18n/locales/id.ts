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
  "stock.stockOutTitle":
    "Stok keluar — hapusbukukan, atau kirim unit ke servis",
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
  "login.subtitle": "Masuk dengan akun staf Anda.",
  "login.signIn": "Masuk",

  // ── Common ────────────────────────────────────────────────────────────────
  "common.delete": "Hapus",
  "common.cancel": "Batal",
  "common.back": "Kembali",
  "common.next": "Selanjutnya",
  "common.done": "Selesai",
  "common.genericError": "Ada yang salah. Coba lagi.",
  // Shown when a map in `i18n/enumLabels.ts` meets an enum member the UI has
  // not been taught yet. Deliberately not "—": the value exists, we just do not
  // have a name for it.
  "common.unknownValue": "Tidak dikenal",

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

  // ── Inbound & QC — the order detail screen ───────────────────────────
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
  "inbound.batteryRange": "Hanya 0–100%",
  "inbound.batteryRefused":
    "{{value}}% bukan angka kesehatan baterai — hanya 0 sampai 100.",
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
    "“{{serial}}” cuma {{n}} karakter — serial minimal {{min}}: kode dua huruf supplier plus nomor mesinnya. Cek stikernya.",
  "inbound.serialsQc": "Serial & QC",
  "inbound.shipping": "Ongkir",
  "inbound.slotOf": "Unit ke-{{n}} dari {{total}}",
  "inbound.service": "Servis",
  "inbound.serviceOk": "Kirim ke servis",
  "inbound.serviceTitle": "Kirim unit ini ke servis?",
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
  "inbound.gradeSlotAria": "Nilai mesin ini",

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
  "stock.conditionBatteryHealthCompleteness":
    "Kondisi, kesehatan baterai, kelengkapan…",
  "stock.description": "Deskripsi",
  "stock.descriptionCondition": "Deskripsi / kondisi",
  "stock.in": "Masuk",
  "stock.inAndOut": "Masuk dan keluar",
  "stock.intoWarehouse": "Ke gudang",
  "stock.inventoryStockMovement": "Inventaris & Pergerakan Stok",
  "stock.leaveEmptyWhenNobodyHas":
    "Kosongkan kalau belum ada yang membacanya dari mesin — itu tidak sama dengan nol",
  "stock.logAdjustment": "Catat penyesuaian",
  "stock.out": "Keluar",
  "stock.pickOneOrTypeA":
    "Pilih satu, atau ketik alasan baru — yang baru otomatis ditambahkan ke Pengaturan",
  "stock.product": "Produk",
  "stock.reason": "Alasan",
  "stock.removeThisLine": "Hapus baris ini",
  "stock.scanOrTypeASerial": "Scan atau ketik nomor serial",
  "stock.searchAReasonOrType": "Cari alasan, atau ketik yang baru",
  "stock.searchSerialDescriptionOrReason": "Cari serial, deskripsi atau alasan",
  "stock.serial": "Serial",
  "stock.specs": "Spesifikasi",
  "stock.stockIn": "Stok masuk",
  "stock.stockOut": "Stok keluar",
  "stock.tabLog": "Log pergerakan",
  "stock.tabStock": "Stok",
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
  "inventory.batteryHealth": "Kesehatan baterai",
  "inventory.buy": "Beli",
  "inventory.category": "Kategori",
  "inventory.description": "Deskripsi",
  "inventory.inStock": "Ada stok",
  "inventory.nAvailable": "{{n}} tersedia",
  "inventory.nInQc": "{{n}} di QC",
  "inventory.nOnHold": "{{n}} ditahan",
  "inventory.nOnService": "{{n}} di servis",
  "inventory.noLabels": "Tidak ada serial untuk dilabeli",
  "inventory.noSerials": "Produk ini sedang tidak ada stoknya.",
  "inventory.price": "Harga",
  "inventory.printForAria": "Cetak label untuk {{product}}",
  "inventory.printLabelsN": "Cetak {{count}} label",
  "inventory.printN": "Cetak label ({{count}})",
  "inventory.product": "Produk",
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
  "opname.check": "Pemeriksaan",
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
  "opname.nothingCounted": "Belum ada yang dihitung. Mulai scan.",
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
  "opname.removeAria": "Hapus {{serial}}",
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
    "Tidak ada yang dibuat sampai hitungan ini diposting. Setelah itu mesinnya menunggu di QC tanpa grade dan tanpa harga beli, karena belum ada yang memeriksanya — beri grade di Barang Masuk & QC supaya bisa dijual.",
  "opname.surplusProduct": "Produk",
  "opname.surplusPickProduct": "Cari produk",
  "opname.surplusProductHelp":
    "Serial saja tidak menambah jumlah stok produk mana pun. Sebutkan ini mesin yang mana.",
  "opname.surplusReason": "Alasan",
  "opname.surplusReasonHelp":
    "Sebutkan kenapa toko punya mesin yang tidak pernah dibukukan.",
  "opname.surplusReasonPlaceholder":
    "mis. Dibeli di kasir, tidak pernah diinput",
  "opname.surplusCondition": "Kondisi",
  "opname.surplusWarehouse": "Ditemukan di",
  "opname.surplusWarehouseHint":
    "Hitungan ini mencakup lebih dari satu gudang, jadi tidak bisa menentukan di mana mesinnya ditemukan.",
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
    "Kosongkan untuk semua rak di gudang tersebut. Kalau rak dipilih, mesin yang masih di QC tidak ikut dihitung karena belum ada di rak mana pun.",
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
    "Mesin yang ditemukan saat stok opname, bukan dibeli lewat nota. Sudah terhitung sebagai stok tapi belum bisa dijual sebelum digrade di sini.",
  "orphanQc.serial": "Serial",
  "orphanQc.product": "Produk",
  "orphanQc.warehouse": "Gudang",
  "orphanQc.condition": "Kondisi",
  "orphanQc.conditionNew": "Baru",
  "orphanQc.conditionSecond": "Bekas",
  "orphanQc.describe": "Deskripsi",
  "orphanQc.describePlaceholder": "Lecet, kelengkapan dus…",
  "orphanQc.describeOptional": "Opsional untuk mesin baru",
  "orphanQc.describeFirst":
    "Sebutkan dulu kondisi mesin ini sebelum ditaruh di rak.",
  "orphanQc.grade": "Grade",
  "orphanQc.gradeAria": "Beri grade {{serial}}",
  "orphanQc.accept": "Terima",
  "orphanQc.acceptHint": "Taruh di rak dengan harga jual produk ini",
  "orphanQc.accepted": "{{serial}} sudah masuk rak.",
  "orphanQc.writeOffAria": "Hapus {{serial}} dari stok",
  "orphanQc.writeOffTitle": "Hapus {{serial}} dari stok?",
  "orphanQc.writeOffBody":
    "Unitnya keluar dari stok dan tetap tercatat di riwayat. Tidak ada supplier untuk mengembalikannya — mesin ini tidak berasal dari nota mana pun.",
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
  "snTracking.event": "Kejadian",
  "snTracking.fromPo": "Dari PO",
  "snTracking.lifecycle": "Perjalanan hidup",
  "snTracking.location": "Lokasi",
  "snTracking.noUnitWithThisSerial":
    "Tidak ada unit dengan serial ini di sistem. Kalau baru saja datang, mungkin masih menunggu di penerimaan.",
  "snTracking.note": "Catatan",
  "snTracking.pickASerialEveryUnit":
    "Pilih serial — setiap unit dilacak sejak hari kedatangannya, selamanya.",
  "snTracking.printLabel": "Cetak label",
  "snTracking.rawLedgerAppendOnly": "Buku besar mentah (hanya bisa ditambah)",
  "snTracking.ref": "Ref",
  "snTracking.sNTracking": "Riwayat Serial",
  "snTracking.searchASerialNumberTo":
    "Cari nomor serial untuk melihat perjalanan lengkapnya",
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
  "returnCustomer.additionalFeeOptional": "Biaya tambahan (opsional)",
  "returnCustomer.date": "Tanggal",
  "returnCustomer.exchange": "Tukar",
  "returnCustomer.managedInSettingsReasonsPer":
    "Diatur di Pengaturan → Alasan per aktivitas",
  "returnCustomer.pickOrSearchAReason": "Pilih atau cari alasan",
  "returnCustomer.product": "Produk",
  "returnCustomer.reason": "Alasan",
  "returnCustomer.recordAReturn": "Catat retur",
  "returnCustomer.recordReturn": "Catat retur",
  "returnCustomer.replacementUnit": "Unit pengganti",
  "returnCustomer.returnHistory": "Riwayat retur",
  "returnCustomer.searchCodeSerialOrReason": "Cari kode, serial atau alasan",
  "returnCustomer.searchTheSerialThatIs": "Cari serial yang dikembalikan",
  "returnCustomer.soldUnitFromTransactionHistory":
    "Unit terjual (dari riwayat transaksi)",
  "returnCustomer.specifyTheReason": "Sebutkan alasannya",
  "returnCustomer.status": "Status",
  "returnCustomer.type": "Jenis",
  "returnCustomer.unitHandedToTheCustomer":
    "Unit yang diberikan ke pelanggan sebagai gantinya",
  "returnCustomer.whatWasWrongWithIt": "Apa masalahnya?",

  // ── Return — to a supplier ───────────────────────────────────────────
  "returnSupplier.date": "Tanggal",
  "returnSupplier.eGDeadPixelCluster": "mis. dead pixel, engsel longgar",
  "returnSupplier.expectedCredit": "Kredit yang diharapkan",
  "returnSupplier.managedInSettingsReasonsPer":
    "Diatur di Pengaturan → Alasan per aktivitas",
  "returnSupplier.origin": "Asal",
  "returnSupplier.pickOrSearchAReason": "Pilih atau cari alasan",
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
  "finance.costPerCustomer": "Biaya per pelanggan",
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
  "finance.noSpend": "tanpa belanja",
  "finance.nothingPendingAllMarketplaceMoney":
    "Tidak ada yang tertunda — semua uang marketplace sudah ditarik.",
  "finance.nothingWasSpentOnThis": "Tidak ada belanja pada kanal ini",
  "finance.out": "Keluar",
  "finance.pendingNotYetWithdrawn": "Tertunda (belum ditarik)",
  "finance.recentMovements": "Pergerakan terbaru",
  "finance.returnOnSpend": "Imbal hasil belanja",
  "finance.revenue": "Pendapatan",
  "finance.saleAmount": "Nilai penjualan",
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
  "finance.currentBalance": "Saldo saat ini",
  "finance.customRange": "Kustom",
  "finance.enterTheBalance": "Masukkan saldonya",
  "finance.includesOpening":
    "Termasuk saldo awal {{amount}} yang dicatat {{date}}.",
  "finance.noMoneyRecorded":
    "Belum ada yang tercatat. Mulai pembukuan dari uang yang dipegang usaha hari ini.",
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
    "Uang yang dipegang usaha saat ini, sebelum apa pun yang dicatat aplikasi ini. Setiap pemasukan dan pengeluaran setelahnya akan menggesernya.",
  "finance.startingBalanceTitle": "Catat saldo saat ini",
  "finance.today": "Hari ini",

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
  "transactions.channel": "Kanal",
  "transactions.detail": "Rincian",
  "transactions.exportAll": "Ekspor semua",
  "transactions.exportSelected": "Ekspor yang dipilih",
  "transactions.moneyInSettled": "Uang masuk (lunas)",
  "transactions.moneyOut": "Uang keluar",
  "transactions.out": "Keluar",
  "transactions.payment": "Pembayaran",
  "transactions.printThisInvoiceAgain": "Cetak ulang invoice ini",
  "transactions.reference": "Referensi",
  "transactions.salesperson": "Sales",
  "transactions.searchACodeSerialProduct":
    "Cari kode, serial, produk, pelanggan atau pengeluaran",
  "transactions.status": "Status",
  "transactions.stillPending": "Masih tertunda",
  "transactions.transactionHistory": "Riwayat Transaksi",
  "transactions.transactions": "Transaksi",
  "transactions.when": "Waktu",

  // ── Chatbot — the inbox ──────────────────────────────────────────────
  "chat.answersOnItsOwn": "Menjawab sendiri",
  "chat.backToChats": "Kembali ke daftar chat",
  "chat.botAnswers": "Bot menjawab",
  "chat.bought": "Dibeli",
  "chat.canTReachTheServer": "Tidak bisa menghubungi server",
  "chat.change": "Ubah",
  "chat.chats": "Chat",
  "chat.context": "Konteks",
  "chat.couldNotChangeThatSwitch": "Gagal mengubah saklar itu.",
  "chat.couldnTRefreshJustNow": "Gagal menyegarkan barusan",
  "chat.customer": "Pelanggan",
  "chat.customerSince": "Pelanggan sejak",
  "chat.eGCasualIndonesianShort": "mis. Bahasa Indonesia santai, pesan pendek",
  "chat.eGFriendlyShopAdmin": "mis. Admin toko yang ramah",
  "chat.eGTooFormalAnd":
    "mis. terlalu formal, dan kita tidak pernah pakai tanda seru",
  "chat.fixThis": "Perbaiki ini",
  "chat.fixThisMessage": "Perbaiki pesan ini",
  "chat.howTheBotTalks": "Cara bot berbicara",
  "chat.letTheBotAnswerThis": "Biarkan bot menjawab chat ini sendiri",
  "chat.messages": "Pesan",
  "chat.name": "Nama",
  "chat.nameIt": "Beri nama",
  "chat.newVoice": "Gaya bicara baru",
  "chat.noChatsYetAnythingA":
    "Belum ada chat. Apa pun yang dikirim pelanggan lewat WhatsApp akan muncul di sini.",
  "chat.offYouReAnswering": "Mati — Anda yang menjawab",
  "chat.onThisChat": "Di chat ini",
  "chat.oneLineAboutIt": "Satu baris tentangnya",
  "chat.phone": "Telepon",
  "chat.pickAChatOnThe": "Pilih chat di sebelah kiri.",
  "chat.rewriteThisTheWayIt":
    "Tulis ulang sebagaimana seharusnya. Bot belajar dari ini.",
  "chat.save": "Simpan",
  "chat.saveTheFix": "Simpan perbaikan",
  "chat.sayItTheRightWay": "Tuliskan versi yang benar",
  "chat.send": "Kirim",
  "chat.showingTheLastChatsThat":
    "Menampilkan chat terakhir yang berhasil dimuat. Akan dicoba lagi beberapa detik lagi.",
  "chat.status": "Status",
  "chat.tellTheBotWhoTo": "Beri tahu bot harus jadi siapa",
  "chat.theBot": "Bot",
  "chat.theBotIsAnsweringThis": "Bot menjawab chat ini lagi.",
  "chat.theBotIsSwitchedOff": "Bot sedang dimatikan",
  "chat.theBotNeedsTheApi":
    "Bot butuh API berjalan di port 4000. Tanpa itu tidak ada chat yang bisa ditampilkan.",
  "chat.thisChat": "Chat ini",
  "chat.thisIsTheBotS": "Ini gaya bicara bot yang sesungguhnya",
  "chat.tooLateToReplyFreely": "Sudah lewat batas untuk membalas bebas",
  "chat.turnThisOffToAnswer":
    "Matikan untuk menjawab pelanggan ini sendiri. Chat lain tidak terpengaruh.",
  "chat.turnThisOnToLetThe": "Nyalakan agar bot menjawab pelanggan ini lagi.",
  "chat.typeYourReplyOrPress":
    "Ketik balasan Anda, atau tekan Tuliskan untuk saya lalu sunting hasilnya.",
  "chat.useThis": "Pakai ini",
  "chat.voice": "Gaya bicara",
  "chat.whatItHasLearned": "Yang sudah dipelajari",
  "chat.whatItShouldHaveSaid": "Yang seharusnya dikatakan",
  "chat.whatWasSent": "Yang terkirim",
  "chat.whateverIsInUseHere":
    "Apa pun yang dipakai di sini adalah suara bot di mana-mana, termasuk pesan yang dijawabnya sendiri jam 3 pagi. Mengubahnya mengubah apa yang diterima pelanggan.",
  "chat.whatsappOnlyDeliversAFree":
    "WhatsApp hanya mengantar balasan gratis dalam 24 jam sejak pesan terakhir pelanggan. Batas itu sudah lewat, jadi apa pun yang diketik di sini tidak akan sampai. Hubungi lewat cara lain, atau tunggu mereka menulis lagi.",
  "chat.whyOptional": "Alasan (opsional)",
  "chat.writeItAsIfYou":
    "Tulis seolah Anda sedang membekali staf baru di hari pertamanya",
  "chat.writeItForMe": "Tuliskan untuk saya",
  "chat.writtenByTheBot": "ditulis oleh bot",
  "chat.you": "anda",
  "chat.youAnswer": "Anda menjawab",
  "chat.youReHandlingThisChat":
    "Anda yang menangani chat ini. Bot tidak akan membalas sendiri.",
  "chat.yourNoteToTheBot": "Catatan Anda untuk bot",

  // ── Chatbot — the page frame ─────────────────────────────────────────
  "chatbot.inbox": "Pesan Masuk",
  "chatbot.knowledge": "Basis Pengetahuan",

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
  "settings.batteryHealthBands": "Rentang kesehatan baterai",
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
  "settings.shopAddress": "Alamat",
  "settings.shopAddressEg": "Jakarta, Indonesia",
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
  "settings.gradingCatchAll": "cocok untuk semua mesin",
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
    "Sebuah aturan cocok bila mesin yang diperiksa memenuhi semua syaratnya — kriteria yang dibiarkan “Apa saja” tidak diperiksa. Aturan tanpa syarat cocok untuk semua mesin, jadi taruh paling bawah sebagai penampung.",
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
    "Pilihannya ikut terhapus, dan setiap aturan yang menyebutnya berhenti memeriksanya. Grade yang sudah diberikan ke mesin tidak berubah.",
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
  "scanner.noSetupNeededOnThis": "Tidak perlu pengaturan di mesin ini.",
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

  // ── ProTable / DataTable ─────────────────────────────────────────────
  "proTable.clearFilters": "Bersihkan filter ({{count}})",
  "proTable.narrowed": "Menampilkan {{shown}} dari {{total}}",

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
  "returnCustomer.code": "Kode",
  "returnCustomer.exchangeWithAnotherUnit": "Tukar dengan unit lain",
  "returnCustomer.returnToStock": "Kembalikan ke stok",
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
  "transactions.in": "Masuk",

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
    "Saldo belum cair dari {{channel}} — konfirmasi di Pemasukan & Pengeluaran setelah masuk.",
  // ── New Transaction — the till, rebuilt 2026-08-27 ───────────────────────
  // The catalogue on the left, the basket and all of the money on the right,
  // and everything about the PEOPLE in an optional second step. "Keranjang"
  // over "Basket" and "Ongkir" over "Pengiriman" throughout: these are the
  // words the shop already says at the counter.
  "pos.addDiscount": "Tambah diskon",
  "pos.addTradeIn": "Tambahkan",
  "pos.allCategories": "Semua",
  "pos.allOnThisSale": "Semua unit varian ini sudah masuk transaksi ini.",
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
  "pos.marketplaceHolds":
    "Uangnya masih ditahan {{channel}} — konfirmasi di Pemasukan & Pengeluaran setelah cair.",
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
  "pos.pickThisOne": "Pilih",
  "pos.qualifiesFor": "Keranjang ini memenuhi syarat {{code}}",
  "pos.recordAtALoss": "Catat walau rugi",
  "pos.remaining": "Sisa {{count}}",
  "pos.removeLineAria": "Hapus {{serial}}",
  "pos.removeTradeIn": "Hapus tukar tambah {{label}}",
  "pos.searchOrScan":
    "Cari produk / varian — atau scan serial, Enter langsung masuk keranjang",
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
  "customers.historyAria": "Riwayat pembelian {{name}}",
  "inbound.rejectAria": "Tolak {{serial}} dan kembalikan ke supplier",
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
  "grade.ungraded": "—",

  // The grading checklist, now shared by QC and the return desk.
  "grading.title": "Nilai mesin ini",
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
    "Mesin seaus ini biasanya lebih baik dikembalikan ke supplier atau dikirim ke servis daripada ditaruh di rak.",
  "grading.apply": "Terapkan grade",
  "grading.applyN": "Terapkan grade {{grade}}",

  // Inbound & QC — the condition toggle and the barcode rules.
  "inbound.condition": "Kondisi",
  "inbound.conditionNew": "Baru",
  // "Second" is what the shop says in Indonesian too — "seken" is the spoken
  // form, "bekas" the written one. The written one goes on a form.
  "inbound.conditionSecond": "Bekas",
  "inbound.describeOptional": "Opsional untuk mesin baru",
  "inbound.descriptionRequiredHint":
    "Wajib sebelum mesin bekas bisa diterima. Opsional untuk mesin baru — tidak ada yang perlu dijelaskan dari dus tersegel.",
  "inbound.scanTooShort":
    "Hasil scan cuma {{n}} karakter. Barcode serial itu {{min}}–{{max}}; coba scan lagi.",
  "inbound.scanTooLong":
    "Hasil scan {{n}} karakter. Barcode serial itu {{min}}–{{max}} — dua scan masuk ke satu kolom bisa begini.",
  "inbound.scanConfusable":
    "“{{scanned}}” ada huruf I atau O. Apple tidak pernah mencetak keduanya — itu salah baca dari 1 dan 0, jadi scan ulang.",
  "inbound.scanCharset":
    "“{{scanned}}” bukan serial — hanya huruf kapital dan angka. Pastikan scanner disetel ke {{symbology}} dan ini memang barcode mesinnya.",
  "inbound.scanNoPrefix":
    "“{{scanned}}” tidak diawali S, berarti itu salah satu barcode lain di bagian bawah mesin. Arahkan ke barcode yang nomornya diawali S.",
  "inbound.scanNoSupplierCode":
    "{{supplier}} belum punya kode dua huruf, jadi serial hasil scan tidak bisa didaftarkan atas namanya. Pengaturan → Supplier tempat memberinya kode.",
  "inbound.thisSupplier": "Supplier ini",

  // The grade column, wherever a serial is listed.
  "inventory.grade": "Grade",
  "snTracking.grade": "Grade",
  "reservations.grade": "Grade",
  "returnCustomer.grade": "Grade",

  // Printing labels — page setup and the barcode.
  "labels.title": "Cetak label — {{count}} serial",
  "labels.printOn": "Cetak di",
  "labels.sheet": "Lembar kertas",
  "labels.roll": "Roll thermal",
  "labels.paper": "Kertas",
  "labels.labelWidth": "Lebar label (mm)",
  "labels.labelHeight": "Tinggi label (mm)",
  "labels.gap": "Jarak (mm)",
  "labels.margin": "Margin (mm)",
  "labels.symbology": "Kode",
  "labels.code128": "Code 128",
  "labels.qr": "QR",
  "labels.sheetSummary":
    "{{count}} label dalam {{sheets}} lembar, {{cols}} ke samping dan {{rows}} ke bawah, ukuran {{w}} × {{h}}mm. Cetak pada skala 100% — “fit to page” akan menggeser semua label keluar dari backing-nya.",
  "labels.rollSummary":
    "{{count}} label, satu per stiker {{w}} × {{h}}mm. Setel ukuran kertas printer sesuai stikernya, dan cetak pada skala 100%.",
  "labels.nothingSelected": "Tidak ada yang dipilih untuk dicetak.",

  // What the print dialog says about a serial it will not encode. Two levels:
  // an error stops the run, a warning prints anyway — see `inspectStoredSerial`.
  "labels.cannotPrintTitle": "{{count}} label tidak bisa dicetak",
  "labels.cannotPrintBody":
    "Perbaiki dulu serialnya di unit — stiker yang kodenya tidak cocok dengan tulisan di bawahnya lebih buruk daripada tidak ada stiker sama sekali.",
  "labels.checkTitle": "{{count}} serial terlihat janggal",
  "labels.checkBody":
    "Semua ini tetap tercetak dan terbaca dengan benar. Ada baiknya dicek ulang ke mesinnya sebelum stikernya ditempel.",
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
  "returnCustomer.wasNewTitle": "Unit ini keluar sebagai mesin baru",
  "returnCustomer.wasNewBody":
    "Unit sudah terjual dan dibuka, jadi kembali ke rak sebagai bekas. Jelaskan kondisinya saat kembali, dan beri grade kalau bisa.",
  "returnCustomer.conditionBack": "Kondisi saat kembali",
  "returnCustomer.conditionPlaceholder":
    "Lecet, kelengkapan dus, keluhan pelanggan…",
  "returnCustomer.newGrade": "Grade baru",
  "returnCustomer.gradeIt": "Beri grade",
  "returnCustomer.gradeOptional": "Opsional — bisa kembali ke rak tanpa grade.",
  "returnCustomer.restock": "Kembalikan ke stok",
  "returnCustomer.describeBeforeRestock":
    "Jelaskan dulu kondisinya saat kembali sebelum ditaruh di rak.",
  "returnCustomer.backInStock": "Unit sudah kembali ke stok siap jual.",

  // Settings — the supplier's two-letter serial code.
  "settings.supplierCode": "Kode",
  "settings.supplierCodeLabel": "Kode serial (opsional)",
  "settings.supplierCodePlaceholder": "Kode (AS)",
  "settings.supplierCodeHelp":
    "Dipasang di depan setiap serial yang di-scan dari supplier ini — mesin yang terbaca BJ347203KLM disimpan sebagai ASBJ347203KLM.",
  "settings.supplierCodeShape": "Kode supplier tepat dua huruf kapital.",
  "settings.supplierCodeTaken": "{{code}} sudah dipakai supplier lain.",
  "settings.supplierCodeMissing":
    "Serial hasil scan dari supplier ini akan ditolak sampai ia punya kode dua huruf.",

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
  "adjust.note": "Catatan",
  "adjust.notePlaceholder":
    "Opsional — ini untuk apa, dengan kata-kata Anda sendiri",
  "adjust.pickADate": "Pilih tanggalnya.",
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
    "Semuanya langsung masuk stok siap jual. Unit yang deskripsinya belum diisi tidak ikut, dan unit mana pun masih bisa dikembalikan ke QC lewat barisnya.",
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
  "opname.backToExpected": "Kembali ke daftar seharusnya",
  "opname.continueToReview": "Lanjut ke tinjauan",
  "opname.countedQty": "Terhitung",
  "opname.difference": "Selisih",
  "opname.editScope": "Ubah cakupan",
  "opname.editScopeHint":
    "Ubah apa yang dihitung. Yang sudah discan tidak hilang.",
  "opname.editScopeTitle": "Ubah cakupan penghitungan ini",
  "opname.expectedHint":
    "Periksa cakupannya sebelum posting. Produk yang tidak Anda duga muncul di sini — atau yang Anda cari tapi tidak ada sama sekali — biasanya berarti cakupannya lebih luas atau lebih sempit dari yang Anda maksud.",
  "opname.expectedNothing":
    "Tidak ada unit di dalam cakupan ini. Perluas cakupannya, atau semua serial yang Anda scan akan terbaca tidak terduga.",
  "opname.expectedQty": "Seharusnya",
  "opname.expectedSubtitle":
    "Yang menurut catatan toko ada di dalam cakupan ini",
  "opname.expectedTitle": "Seharusnya ada di hitungan ini ({{count}})",
  "opname.scopeChangeBody":
    "Memperluas cakupan menambah unit yang diharapkan ada; mempersempitnya mengurangi. Serial yang sudah Anda scan tapi berada di luar cakupan baru tidak dihapus — ia pindah ke daftar tidak dikenal, karena memang ada orang yang membacanya dari mesin.",
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
  "pos.escrow": "escrow",
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
  "trade.grade": "Jalankan checklist",
  "trade.gradeNeedsProduct":
    "Pilih produknya dulu — checklist-nya per kategori.",
  "trade.grading": "Grading & konfigurasi",
  "trade.new": "New",
  "trade.note": "Catatan",
  "trade.notePlaceholder": "Apa pun yang perlu diketahui QC",
  "trade.pickAProductFirst": "Pilih produk",
  "trade.product": "Produk",
  "trade.productHint":
    "Opsional. Memilihnya berarti unit masuk QC sudah tahu ia produk apa — dan menampilkan berapa modal toko untuk unit sejenis.",
  "trade.regrade": "Ubah grade",
  "trade.scanOrType": "Scan atau ketik",
  "trade.searchProduct": "Cari produk atau varian",
  "trade.second": "Second",
  "trade.serial": "Serial",
  "trade.serialHint":
    "Nomor yang tercetak di mesinnya — {{min}}–{{max}} karakter. Ketik tanpa S; aplikasi yang menambahkannya. Unit masuk QC dengan serial ini, persis seperti unit dari purchase order.",
  "trade.serialTaken": "{{serial}} sudah menjadi milik unit yang kami punya.",
  "trade.title": "Ambil unit sebagai tukar tambah",
  "trade.weListAt": "Kami jual di",
  "trade.wePay": "Modal kami ({{count}})",
  "trade.what": "Unit apa ini?",
  "trade.whatHint":
    "Dengan kata-kata, sebagaimana akan terbaca di invoice — lecetnya dan umurnya, bukan cuma modelnya.",
  "trade.whatPlaceholder": "mis. MacBook Air 2017 8/128, lecet di lid",
  "trade.whatRequired": "Sebutkan unit apa ini.",
  "trade.withSerialNote":
    "Dengan serial, unit masuk QC dengan nilai tukar sebagai modalnya. Tanpa serial, hanya uangnya yang mengurangi tagihan.",
  Sales: "Penjualan",
  "Account transfer": "Transfer antar rekening",
  "Takings this app did not record — an off-app sale, or an old till.":
    "Pemasukan yang tidak dicatat aplikasi ini — penjualan di luar aplikasi, atau kasir lama.",
  "Money moved in from another account of the business. Not revenue — it raises the balance without being a sale.":
    "Uang yang dipindahkan dari rekening lain milik usaha. Bukan pendapatan — menambah saldo tanpa menjadi penjualan.",
  "Shopping bag": "Tas belanja",
  Installation: "Pemasangan",
  "Extended warranty": "Perpanjangan garansi",
  "Data transfer": "Pemindahan data",

  // ── 2026-09-01: the machine's two barcodes — Apple's and the shop's. ──
  "inbound.scanAmbiguous":
    "“{{scanned}}” terbaca sebagai kedua barcode sekaligus — kode supplier yang diawali S membuat panjangnya sama. Dibaca sebagai barcode Apple. Cocokkan serialnya dengan mesinnya.",
  "inbound.scanLandedOriginal":
    "{{serial}} tercatat — {{product}}. Dibaca dari barcode Apple; cetak stiker toko setelah QC menerimanya.",
  "inbound.scanLandedStore":
    "{{serial}} tercatat — {{product}}. Dibaca dari stiker toko sendiri.",
  "inbound.scanNoMarker":
    "“{{scanned}}” tidak diawali S maupun kode supplier toko, jadi ini salah satu barcode lain di bagian bawah mesin. Arahkan ke serial Apple atau ke stiker toko.",
  "scanner.ambiguousRead": "Hasil scan ini adalah kedua barcode sekaligus.",
  "scanner.ambiguousReadWhy":
    "Kode supplier yang diawali S membuat panjang keduanya sama. Dibaca sebagai barcode Apple — cocokkan serialnya dengan mesinnya.",
  "scanner.neitherBarcode": "Itu bukan salah satu dari dua barcode mesin.",
  "scanner.neitherBarcodeWhy":
    "Barcode serial adalah S ditambah 10–12 karakter, dan stiker toko adalah kode supplier dua huruf ditambah jumlah yang sama. Ini kemungkinan besar barcode regulasi atau nomor part di sebelahnya.",
  "scanner.notInStock": "Belum ada unit dengan serial ini",
  "scanner.originalBarcode": "Barcode asli",
  "scanner.originalBarcodeRead": "Serial Apple {{base}}",
  "scanner.storeBarcode": "Barcode toko",
  "scanner.storeBarcodeRead": "Supplier {{code}} · serial Apple {{base}}",
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
    "“{{scanned}}” terdiri dari {{n}} karakter. Barcode serial adalah S ditambah {{min}}–{{max}} karakter — hasil yang terlalu pendek berarti scanner terangkat terlalu cepat, dan yang terlalu panjang berarti dua scan tanpa Enter di antaranya.",
  "inbound.serialCharset":
    "“{{serial}}” mengandung selain huruf kapital dan angka.",
  "inbound.serialNoMarker":
    "“{{serial}}” tidak diawali S. Barcode selalu punya S — scanner-nya terarah ke kode regulasi atau part number di sebelahnya.",
  "inbound.serialNotASerial":
    "“{{serial}}” bukan serial. Ketik {{min}}–{{max}} karakter yang tercetak di casing, atau scan barcode-nya.",
  "inbound.serialHintBare": "{{min}}–{{max}} karakter",
  "inbound.serialShape":
    "“{{serial}}” terdiri dari {{n}} karakter. Serial adalah S ditambah {{min}}–{{max}} karakter.",
  "inbound.serialHintMarker": "Harus diawali S",
  "inbound.serialHintCharset": "Hanya huruf kapital dan angka",
  "inbound.serialHintLength": "S lalu {{min}}–{{max}} karakter",
  "labels.faultShape": "bukan S diikuti {{min}}–{{max}} karakter",
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
  "serial.badSerialWhy":
    "Serial ini bukan S diikuti 10–12 karakter, jadi barcode toko tidak bisa dibuat darinya. Stikernya akan memuat serial apa adanya.",
  "serial.noStoreCodeWhy":
    "Supplier ini belum punya kode dua huruf, jadi barcode toko belum bisa dibuat. Beri kodenya di Settings → Supplier.",
  "serial.noStoreQr": "QR toko: —",
  "serial.storeQr": "QR toko:",
  "serial.storeQrWhy":
    "Isi stiker toko sendiri: kode dua huruf supplier di depan serial mesin. Scan salah satunya sama-sama menemukan unit ini.",
  "trade.bought": "Dibeli seharga",
  "trade.categoryFromProduct": "Mengikuti produk yang dipilih.",
  "trade.description": "Deskripsi",
  "trade.descriptionHint":
    "Dengan kata-kata, sebagaimana akan terbaca di invoice — lecetnya dan umurnya, bukan cuma modelnya.",
  "trade.descriptionPlaceholder": "mis. MacBook Air 2017 8/128, lecet di lid",
  "trade.descriptionRequired": "Jelaskan mesinnya — lecet dan umurnya.",
  "trade.entersQc":
    "Unit masuk QC dengan harga ini sebagai modalnya, persis seperti unit dari purchase order.",
  "trade.gradeNotForNew": "Tidak ada yang perlu diperiksa pada barang segel.",
  "trade.gradeRequired":
    "Jalankan checklist grading — kalau tidak, unit second sampai di bench tanpa keterangan apa pun.",
  "trade.listedAt": "Dijual seharga",
  "trade.noneHeld": "Toko belum pernah mengambil unit seperti ini.",
  "trade.price": "Harga",
  "trade.priceHint":
    "Mengurangi yang dibayar pelanggan, dan menjadi modal unit ini saat masuk stok.",
  "trade.priceRequired": "Isi berapa yang toko bayar untuk unit ini.",
  "trade.seeStock": "Lihat unit-unit di baliknya",
  "trade.seeWhatWePaid": "Lihat modal tiap unitnya",
  "trade.serialRequired": "Scan atau ketik serial mesinnya.",
  "trade.serialShape":
    "“{{serial}}” bukan serial. Ketik {{min}}–{{max}} karakter yang tercetak di mesinnya, atau scan barcode-nya.",
  "trade.unit": "Unit",
  "trade.whatWeListTitle": "Harga jual unit-unit ini",
  "trade.whatWePaidTitle": "Modal unit-unit ini",

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
  "pos.whyStepUp": "{{step}} lebih mahal dari {{name}} {{variant}} di transaksi ini.",
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
};
