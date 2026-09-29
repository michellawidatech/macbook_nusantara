/**
 * Inbound & QC and the catalogue, as the SPA sees them.
 * See apps/api/src/routes/inbound.ts and routes/katalog.ts.
 *
 * Money crosses as decimal strings of whole rupiah, never as numbers — 01 §4,
 * and `BigInt` does not survive `JSON.stringify` anyway. Dates cross as ISO
 * strings. Both are converted at the edge of the page that shows them, not
 * here: a type that lied about which it was would be worse than a conversion
 * somebody can see.
 */
import { api } from "./api.js";

/** Whole rupiah, as a decimal string. */
export type Rupiah = string;

export interface PurchaseOrderRow {
  readonly id: string;
  readonly code: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly invoice: string | null;
  readonly noInvoice: boolean;
  readonly status: "DRAF" | "DIPESAN" | "SEBAGIAN" | "DITERIMA" | "BATAL";
  readonly orderedAt: string;
  readonly receivedAt: string | null;
  readonly closedAt: string | null;
  readonly locationId: string;
  readonly total: Rupiah;
  /** Settled only. A payment on credit terms has not been paid. */
  readonly paid: Rupiah;
  /** Machines the invoice says are coming. */
  readonly qty: number;
  /** Machines that now exist as units. The rest are SLOTS, which live in the page. */
  readonly identified: number;
  readonly accepted: number;
  /** Still in QC, and how many of those somebody has described. */
  readonly inQc: number;
  readonly describedInQc: number;
  /** Went the other way out of QC, and are never counted as accepted. */
  readonly returned: number;
  readonly onService: number;
}

export interface PurchaseOrderUnit {
  readonly id: string;
  readonly serial: string;
  readonly status: string;
  readonly grade: string | null;
  readonly description: string | null;
  readonly buy: Rupiah;
  readonly landed: Rupiah;
  readonly locationId: string;
  readonly intakeAt: string;
}

export interface PurchaseOrderLine {
  readonly id: string;
  readonly skuId: string | null;
  readonly skuCode: string | null;
  readonly skuName: string | null;
  readonly categoryId: string | null;
  readonly produk: string;
  readonly spec: string | null;
  readonly qty: number;
  readonly unitCost: Rupiah;
  readonly lineTotal: Rupiah;
  readonly allocatedFee: Rupiah;
  readonly units: readonly PurchaseOrderUnit[];
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  readonly supplierWa: string | null;
  /** ⚠️ Always null — `Supplier.code` is a schema gap. */
  readonly originCode: string | null;
  readonly note: string | null;
  readonly subtotal: Rupiah;
  readonly feesTaxPct: string;
  readonly feesTotal: Rupiah;
  readonly lines: readonly PurchaseOrderLine[];
  readonly fees: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: string;
    readonly amount: Rupiah;
  }[];
  readonly payments: readonly {
    readonly id: string;
    readonly methodId: string;
    readonly methodLabel: string;
    readonly amount: Rupiah;
    readonly appliedTo: string;
    readonly status: string;
    readonly paidAt: string | null;
    readonly ref: string | null;
  }[];
}

export interface ProductRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly variantLabel: string | null;
  readonly price: Rupiah;
  readonly landed: Rupiah;
  readonly grade: string | null;
  readonly modelId: string;
  readonly modelName: string;
  readonly kategoriId: string;
  readonly kategori: string;
}

export interface SupplierRow {
  readonly id: string;
  readonly name: string;
  readonly wa: string | null;
  readonly note: string | null;
  readonly originCode: string | null;
}

export interface InventoryRow {
  readonly id: string;
  readonly serial: string;
  readonly status: string;
  readonly grade: string | null;
  readonly description: string | null;
  readonly skuId: string;
  readonly skuCode: string;
  readonly skuName: string;
  readonly variantLabel: string | null;
  readonly skuPrice: Rupiah;
  readonly kategoriId: string;
  readonly kategori: string;
  readonly lokasiId: string;
  readonly lokasi: string;
  readonly buy: Rupiah;
  readonly landed: Rupiah;
  readonly intakeAt: string;
  readonly attrs: Record<string, string>;
}

export interface InventoryPage {
  readonly rows: readonly InventoryRow[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
}

// ---------------------------------------------------------------------------
// Query keys. Exported so a mutation can invalidate exactly what it changed
// rather than the whole cache — accepting one machine should not refetch the
// catalogue.
// ---------------------------------------------------------------------------
export const poListKey = (q: string, closed?: boolean) =>
  ["inbound", "list", q, closed ?? "all"] as const;
export const poDetailKey = (id: string) => ["inbound", "po", id] as const;
export const productsKey = (q: string) => ["katalog", "produk", q] as const;
export const suppliersKey = () => ["katalog", "supplier"] as const;
export const inventoryKey = (params: string) =>
  ["katalog", "inventori", params] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export const listPurchaseOrders = (
  params: { q?: string; closed?: boolean; page?: number; perPage?: number },
  signal?: AbortSignal,
) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.closed !== undefined) qs.set("closed", String(params.closed));
  if (params.page) qs.set("page", String(params.page));
  if (params.perPage) qs.set("perPage", String(params.perPage));
  return api<{
    rows: PurchaseOrderRow[];
    total: number;
    page: number;
    perPage: number;
  }>(`/api/inbound?${qs.toString()}`, signal ? { signal } : {});
};

export const getPurchaseOrder = (id: string, signal?: AbortSignal) =>
  api<PurchaseOrderDetail>(
    `/api/inbound/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );

export const listProducts = (q: string, signal?: AbortSignal) =>
  api<ProductRow[]>(
    `/api/katalog/produk?q=${encodeURIComponent(q)}`,
    signal ? { signal } : {},
  );

export const listSuppliers = (signal?: AbortSignal) =>
  api<SupplierRow[]>("/api/katalog/supplier", signal ? { signal } : {});

export const listInventory = (params: string, signal?: AbortSignal) =>
  api<InventoryPage>(
    `/api/katalog/inventori${params ? `?${params}` : ""}`,
    signal ? { signal } : {},
  );

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A serial has been read off a case. The unit comes into existence, in QC.
 *
 * No idempotency key: the serial's own UNIQUE index is the guard, and it is a
 * better one — two tills scanning the same machine collide on the database
 * rather than on whether they happened to generate the same key.
 */
export const receiveUnit = (input: {
  serial: string;
  skuId: string;
  buy: Rupiah;
  landed: Rupiah;
  locationId: string;
  poItemId?: string | null;
  purchaseOrderId?: string | null;
}) =>
  api<{ id: string; serial: string }>("/api/inbound/unit", {
    method: "POST",
    body: input,
  });

/**
 * QC is satisfied: these machines become sellable stock.
 *
 * `idempotencyKey` matters more here than anywhere else in this file. *Accept
 * all* is one press against a whole invoice, and a retry without a key would
 * append a second QC_SELESAI — which has no legal `from`, so it would fail the
 * transition and take the rest of the invoice with it.
 */
export const acceptUnits = (
  input: {
    units: readonly {
      serial: string;
      grade?: string | null;
      description?: string | null;
    }[];
    purchaseOrderId?: string | null;
    refCode?: string | null;
  },
  idempotencyKey: string,
) =>
  api<{ accepted: number }>("/api/inbound/accept", {
    method: "POST",
    body: input,
    idempotencyKey,
  });

export const setPurchaseOrderClosed = (id: string, closed: boolean) =>
  api<{ closedAt: string | null }>(
    `/api/inbound/${encodeURIComponent(id)}/close`,
    { method: "POST", body: { closed } },
  );
