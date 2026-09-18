/**
 * One serial's whole life, as the SPA sees it. See apps/api/src/routes/katalog.ts.
 *
 * The timeline's context arrives STRUCTURED rather than as a sentence: the
 * phrasing is this side's job, because every user-facing string goes through
 * `t()` and has an Indonesian translation. A server that returned
 * "Sold to Budi on SI-…" would be shipping untranslatable English.
 *
 * Money crosses as decimal strings (whole rupiah). Dates cross as ISO strings.
 *
 * ⚠️ **Dormant since 2026-09-07, deliberately, and not dead.** S/N Tracking
 * was the only caller and it reads the browser store again: the page had been
 * migrated ahead of every screen that WRITES a unit, so a machine accepted at
 * Inbound & QC never appeared in the tracker at all. This client, the route it
 * calls and `packages/db`'s `unitTimeline` behind it are all tested and stay
 * exactly as they are — pages sharing an id space move together, and this one
 * goes back over with Inbound & QC.
 */
import { api } from "./api.js";

export type TimelineContext =
  | {
      readonly kind: "SALE";
      readonly orderCode: string;
      readonly platform: string;
      readonly customerName: string | null;
      /** Whole rupiah, as a string. */
      readonly price: string | null;
    }
  | {
      readonly kind: "HOLD";
      readonly reservationCode: string;
      readonly customerName: string | null;
      readonly channelName: string | null;
    }
  | {
      readonly kind: "SUPPLIER_RETURN";
      readonly returnCode: string;
      readonly supplierName: string;
    }
  | {
      readonly kind: "ARRIVAL";
      readonly purchaseOrderCode: string;
      readonly supplierName: string;
    }
  | { readonly kind: "SHELVED"; readonly locationName: string | null };

export interface TimelineEvent {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  /** ISO. */
  readonly at: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly locationName: string | null;
  readonly staffName: string;
  readonly code: string | null;
  readonly note: string | null;
  readonly refCode: string | null;
  readonly context: TimelineContext | null;
}

export interface UnitCard {
  readonly serial: string;
  readonly status: string;
  readonly locationName: string | null;
  readonly grade: string | null;
  /** Whole rupiah, as a string. */
  readonly buy: string;
  readonly landed: string;
  readonly intakeAt: string;
  readonly archivedAt: string | null;
  readonly skuId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly price: string;
  readonly modelName: string | null;
  readonly categoryName: string | null;
  readonly purchaseOrderCode: string | null;
  /**
   * Always null for now, and deliberately so rather than missing: `Unit` has no
   * description column, and the schema's own docblocks disagree about whether
   * `UnitNote` is its home. An owner decision, not a client concern — the field
   * is here so the screen keeps its row and shows "—".
   */
  readonly description: null;
  /** Always null for now: there is no Rack model. Same reasoning. */
  readonly rackName: null;
}

export interface UnitTimeline {
  readonly unit: UnitCard;
  /** Newest first. */
  readonly events: readonly TimelineEvent[];
}

export interface UnitPickerRow {
  readonly serial: string;
  readonly productName: string;
  readonly variantLabel: string | null;
}

export const unitTimelineKey = (serial: string) =>
  ["katalog", "unit", serial] as const;
export const unitPickerKey = (q: string) =>
  ["katalog", "unit", "search", q] as const;

export const getUnitTimeline = (serial: string, signal?: AbortSignal) =>
  api<UnitTimeline>(
    `/api/katalog/unit/${encodeURIComponent(serial)}`,
    signal ? { signal } : {},
  );

/**
 * Serials for the tracker's picker.
 *
 * Searched and capped server-side. The old page built its option list from
 * every unit in the shop and did a lookup per option to label it.
 */
export const searchUnits = (q: string, signal?: AbortSignal) =>
  api<{ units: UnitPickerRow[] }>(
    `/api/katalog/unit?q=${encodeURIComponent(q)}`,
    signal ? { signal } : {},
  );
