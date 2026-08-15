-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('TOKO', 'GUDANG', 'SERVIS', 'TRANSIT');

-- CreateEnum
CREATE TYPE "MarginMode" AS ENUM ('PCT', 'RP');

-- CreateEnum
CREATE TYPE "AttrType" AS ENUM ('TEXT', 'NUMBER', 'SELECT');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('TERSEDIA', 'DIRESERVASI', 'TERJUAL', 'KLAIM_GARANSI', 'RETUR_SUPPLIER', 'REFUND_KLAIM', 'HILANG', 'KOREKSI_KELUAR');

-- CreateEnum
CREATE TYPE "UnitEventType" AS ENUM ('DITERIMA', 'DICATAT', 'DIPINDAH', 'DIRESERVASI', 'RESERVASI_BATAL', 'TERJUAL', 'RETUR_PELANGGAN', 'RETUR_SUPPLIER', 'KLAIM_DIBUKA', 'KLAIM_SELESAI', 'REFUND', 'OPNAME_HILANG', 'OPNAME_DITEMUKAN', 'KOREKSI', 'DIARSIPKAN');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAF', 'DIPESAN', 'SEBAGIAN', 'DITERIMA', 'BATAL');

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('ONGKIR', 'PAJAK', 'BEACUKAI', 'LAIN');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('DIAJUKAN', 'DIKIRIM', 'SELESAI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('LUNAS', 'BELUM', 'APPROVAL', 'BATAL', 'RETUR', 'RETUR_SEBAGIAN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('OFFLINE', 'WA', 'IG');

-- CreateEnum
CREATE TYPE "Fulfillment" AS ENUM ('PICKUP', 'SHIP', 'NONE');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('TUNAI', 'QRIS', 'TRANSFER', 'DEBIT', 'KARTU_KREDIT', 'CICILAN', 'COD', 'BAYAR_TOKO', 'TEMPO');

-- CreateEnum
CREATE TYPE "PayDirection" AS ENUM ('MASUK', 'KELUAR');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('LUNAS', 'TEMPO', 'BELUM', 'GAGAL');

-- CreateEnum
CREATE TYPE "AdjustType" AS ENUM ('VOID', 'REFUND', 'RETUR');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('TERJADWAL', 'SELESAI', 'BATAL');

-- CreateEnum
CREATE TYPE "ResSource" AS ENUM ('STAF', 'AGEN');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PERLU_RESI', 'DIPROSES', 'DIKIRIM', 'DITERIMA', 'RETUR');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'SELESAI');

-- CreateEnum
CREATE TYPE "ClaimRes" AS ENUM ('STOK', 'RETUR', 'REFUND');

-- CreateEnum
CREATE TYPE "DiscScope" AS ENUM ('SEMUA', 'KATEGORI', 'PRODUK');

-- CreateEnum
CREATE TYPE "ReqStatus" AS ENUM ('PENDING', 'DISETUJUI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'ARCHIVE', 'LOGIN', 'LOGIN_GAGAL', 'EKSPOR');

-- CreateEnum
CREATE TYPE "OpnameStatus" AS ENUM ('BERJALAN', 'DIPOSTING', 'BATAL');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('COCOK', 'TIDAK_DIKENAL', 'SALAH_LOKASI');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('BUKA', 'TUTUP');

-- CreateEnum
CREATE TYPE "OpexKind" AS ENUM ('TETAP', 'VARIABEL', 'NONCASH');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('WA_REPLY', 'IG_REPLY', 'IG_DM', 'ALERT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WaDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "WaMsgStatus" AS ENUM ('BARU', 'DIJAWAB_AGEN', 'PERLU_STAF', 'DIJAWAB_STAF');

-- CreateEnum
CREATE TYPE "IgCommentStatus" AS ENUM ('NEW', 'REPLIED', 'DMED', 'DONE', 'HIDDEN');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wa" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoice" TEXT,
    "noInvoice" BOOLEAN NOT NULL,
    "status" "POStatus" NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "subtotal" BIGINT NOT NULL,
    "feesTaxPct" DECIMAL(5,2) NOT NULL,
    "feesTotal" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "locationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "skuId" TEXT,
    "produk" TEXT NOT NULL,
    "spec" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCost" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "allocatedFee" BIGINT NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItemSerial" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "unitId" TEXT,

    CONSTRAINT "PurchaseOrderItemSerial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderFee" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "PurchaseOrderFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderPackage" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "weightGram" INTEGER,
    "note" TEXT,

    CONSTRAINT "PurchaseOrderPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArrivalPhoto" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "ArrivalPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturn" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poId" TEXT,
    "status" "ReturnStatus" NOT NULL,
    "reason" TEXT,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,

    CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "marginMode" "MarginMode" NOT NULL,
    "marginMin" BIGINT NOT NULL,
    "marginMax" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAttribute" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttrType" NOT NULL,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAttributeOption" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CategoryAttributeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryVariantAxis" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CategoryVariantAxis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogModel" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" TEXT,
    "archived" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelAxis" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ModelAxis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelAxisValue" (
    "id" TEXT NOT NULL,
    "axisId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ModelAxisValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPhoto" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ModelPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variantLabel" TEXT,
    "grade" "Grade",
    "price" BIGINT NOT NULL,
    "landed" BIGINT NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL,
    "locationId" TEXT NOT NULL,
    "buy" BIGINT NOT NULL,
    "landed" BIGINT NOT NULL,
    "grade" "Grade",
    "poItemId" TEXT,
    "soldOrderItemId" TEXT,
    "intakeAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitAttribute" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "UnitAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitEvent" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "UnitEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "fromStatus" "UnitStatus",
    "toStatus" "UnitStatus" NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "orderId" TEXT,
    "purchaseOrderId" TEXT,
    "claimId" TEXT,
    "opnameSessionId" TEXT,
    "costDelta" BIGINT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requestId" TEXT,
    "note" TEXT,

    CONSTRAINT "UnitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitNote" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tag" TEXT,
    "staffId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitNotePhoto" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "UnitNotePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpnameSession" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "OpnameStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "staffId" TEXT NOT NULL,

    CONSTRAINT "OpnameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpnameScan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "unitId" TEXT,
    "result" "ScanResult" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpnameScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "street" TEXT,
    "zip" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "custName" TEXT,
    "phone" TEXT,
    "platform" "Platform" NOT NULL,
    "fulfill" "Fulfillment" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discountId" TEXT,
    "discount" BIGINT NOT NULL,
    "extra" BIGINT NOT NULL,
    "extraNote" TEXT,
    "total" BIGINT NOT NULL,
    "paidTotal" BIGINT NOT NULL,
    "cogs" BIGINT NOT NULL,
    "tradeCredit" BIGINT NOT NULL,
    "belowFloor" BOOLEAN NOT NULL,
    "ovReason" TEXT,
    "approvedById" TEXT,
    "soldById" TEXT NOT NULL,
    "shiftId" TEXT,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "unitId" TEXT,
    "skuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "qty" INTEGER NOT NULL,
    "price" BIGINT NOT NULL,
    "sub" BIGINT NOT NULL,
    "cogs" BIGINT NOT NULL,
    "garansiUntil" TIMESTAMP(3),
    "returnedQty" INTEGER NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeIn" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "serial" TEXT,
    "value" BIGINT NOT NULL,
    "unitId" TEXT,
    "note" TEXT,

    CONSTRAINT "TradeIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "poId" TEXT,
    "direction" "PayDirection" NOT NULL,
    "method" "PayMethod" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "PayStatus" NOT NULL,
    "paidAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "ref" TEXT,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAdjustment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "AdjustType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT,

    CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    "maxRp" BIGINT,
    "minRp" BIGINT,
    "description" TEXT,
    "usageLimit" INTEGER,
    "used" INTEGER NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL,
    "scope" "DiscScope" NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountSku" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,

    CONSTRAINT "DiscountSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "canApprove" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "openFloat" BIGINT NOT NULL,
    "expected" BIGINT NOT NULL,
    "declared" BIGINT NOT NULL,
    "variance" BIGINT NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT,
    "custName" TEXT,
    "phone" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "status" "ReservationStatus" NOT NULL,
    "source" "ResSource" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationItem" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "skuId" TEXT,
    "unitId" TEXT,
    "qty" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "ReservationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courier" TEXT,
    "service" TEXT,
    "street" TEXT,
    "zip" TEXT,
    "resi" TEXT,
    "status" "ShipmentStatus" NOT NULL,
    "cost" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "note" TEXT,
    "staffId" TEXT,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "supplierId" TEXT,
    "status" "ClaimStatus" NOT NULL,
    "resolution" "ClaimRes",
    "openedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "staffId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalCode" (
    "zip" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "subdistrict" TEXT NOT NULL,

    CONSTRAINT "PostalCode_pkey" PRIMARY KEY ("zip")
);

-- CreateTable
CREATE TABLE "PriceLog" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "before" BIGINT NOT NULL,
    "after" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT NOT NULL,
    "below" BOOLEAN NOT NULL,
    "approvedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "PriceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceReq" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "before" BIGINT NOT NULL,
    "after" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ReqStatus" NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "PriceReq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "field" TEXT,
    "before" TEXT,
    "after" TEXT,
    "requestId" TEXT,
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinSettings" (
    "id" TEXT NOT NULL,
    "cash" BIGINT NOT NULL,
    "equipment" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpexItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" "OpexKind" NOT NULL,
    "recurring" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "OpexItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCash" (
    "id" TEXT NOT NULL,
    "opening" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashEntry" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "amount" BIGINT NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT,

    CONSTRAINT "PettyCashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyQuota" (
    "key" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "DailyQuota_pkey" PRIMARY KEY ("key","day")
);

-- CreateTable
CREATE TABLE "AppleDbCache" (
    "id" TEXT NOT NULL,
    "models" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleDbCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaRawEvent" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WaRawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT,
    "text" TEXT,
    "msgType" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "direction" "WaDirection" NOT NULL,
    "status" "WaMsgStatus" NOT NULL,
    "intent" TEXT,
    "entities" JSONB NOT NULL,
    "replyText" TEXT,
    "answeredByAgent" BOOLEAN NOT NULL,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaThreadMemory" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "customerId" TEXT,
    "summary" TEXT,
    "summaryAt" TIMESTAMP(3),
    "summaryTurns" INTEGER NOT NULL,
    "coveredThroughAt" TIMESTAMP(3),
    "coveredThroughId" TEXT,
    "directive" TEXT,
    "directiveAt" TIMESTAMP(3),
    "directiveById" TEXT,
    "clarifyCount" INTEGER NOT NULL,
    "clarifyAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaThreadMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL,

    CONSTRAINT "AgentCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgRawEvent" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IgRawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgMedia" (
    "id" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "timestamp" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgComment" (
    "id" TEXT NOT NULL,
    "igCommentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "fromUsername" TEXT,
    "text" TEXT,
    "parentId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,
    "status" "IgCommentStatus" NOT NULL,
    "replyText" TEXT,
    "replyCommentId" TEXT,
    "repliedByAgent" BOOLEAN NOT NULL,
    "repliedById" TEXT,
    "repliedAt" TIMESTAMP(3),
    "dmText" TEXT,
    "dmSentById" TEXT,
    "dmSentAt" TIMESTAMP(3),

    CONSTRAINT "IgComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgSettings" (
    "id" TEXT NOT NULL,
    "autoReply" BOOLEAN NOT NULL,
    "replyTemplate" TEXT NOT NULL,
    "dmTemplate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItemSerial_itemId_serial_key" ON "PurchaseOrderItemSerial"("itemId", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReturn_code_key" ON "SupplierReturn"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryAttribute_categoryId_key_key" ON "CategoryAttribute"("categoryId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogModel_categoryId_name_year_key" ON "CatalogModel"("categoryId", "name", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_serial_key" ON "Unit"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "UnitAttribute_unitId_attributeId_key" ON "UnitAttribute"("unitId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitEvent_unitId_seq_key" ON "UnitEvent"("unitId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "OpnameSession_code_key" ON "OpnameSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OpnameScan_sessionId_serial_key" ON "OpnameScan"("sessionId", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_code_key" ON "Discount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountSku_discountId_skuId_key" ON "DiscountSku"("discountId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_username_key" ON "Staff"("username");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_code_key" ON "Shipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_code_key" ON "WarrantyClaim"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_waMessageId_key" ON "WaMessage"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WaThreadMemory_from_key" ON "WaThreadMemory"("from");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCache_key_key" ON "AgentCache"("key");

-- CreateIndex
CREATE UNIQUE INDEX "IgMedia_igMediaId_key" ON "IgMedia"("igMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "IgComment_igCommentId_key" ON "IgComment"("igCommentId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItemSerial" ADD CONSTRAINT "PurchaseOrderItemSerial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItemSerial" ADD CONSTRAINT "PurchaseOrderItemSerial_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderFee" ADD CONSTRAINT "PurchaseOrderFee_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPackage" ADD CONSTRAINT "PurchaseOrderPackage_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrivalPhoto" ADD CONSTRAINT "ArrivalPhoto_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrivalPhoto" ADD CONSTRAINT "ArrivalPhoto_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttributeOption" ADD CONSTRAINT "CategoryAttributeOption_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "CategoryAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryVariantAxis" ADD CONSTRAINT "CategoryVariantAxis_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogModel" ADD CONSTRAINT "CatalogModel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAxis" ADD CONSTRAINT "ModelAxis_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAxisValue" ADD CONSTRAINT "ModelAxisValue_axisId_fkey" FOREIGN KEY ("axisId") REFERENCES "ModelAxis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPhoto" ADD CONSTRAINT "ModelPhoto_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_soldOrderItemId_fkey" FOREIGN KEY ("soldOrderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAttribute" ADD CONSTRAINT "UnitAttribute_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAttribute" ADD CONSTRAINT "UnitAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "CategoryAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "WarrantyClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_opnameSessionId_fkey" FOREIGN KEY ("opnameSessionId") REFERENCES "OpnameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitNote" ADD CONSTRAINT "UnitNote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitNote" ADD CONSTRAINT "UnitNote_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitNotePhoto" ADD CONSTRAINT "UnitNotePhoto_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "UnitNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpnameSession" ADD CONSTRAINT "OpnameSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpnameSession" ADD CONSTRAINT "OpnameSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpnameScan" ADD CONSTRAINT "OpnameScan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpnameScan" ADD CONSTRAINT "OpnameScan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_zip_fkey" FOREIGN KEY ("zip") REFERENCES "PostalCode"("zip") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountSku" ADD CONSTRAINT "DiscountSku_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountSku" ADD CONSTRAINT "DiscountSku_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_zip_fkey" FOREIGN KEY ("zip") REFERENCES "PostalCode"("zip") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLog" ADD CONSTRAINT "PriceLog_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLog" ADD CONSTRAINT "PriceLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceLog" ADD CONSTRAINT "PriceLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceReq" ADD CONSTRAINT "PriceReq_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceReq" ADD CONSTRAINT "PriceReq_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceReq" ADD CONSTRAINT "PriceReq_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_coveredThroughId_fkey" FOREIGN KEY ("coveredThroughId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_directiveById_fkey" FOREIGN KEY ("directiveById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgComment" ADD CONSTRAINT "IgComment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "IgMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgComment" ADD CONSTRAINT "IgComment_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgComment" ADD CONSTRAINT "IgComment_dmSentById_fkey" FOREIGN KEY ("dmSentById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
