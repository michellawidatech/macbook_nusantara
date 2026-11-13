/**
 * Edits and deletes of money need an approver (owner/user 2026-11-13: "the
 * delete, edit invoice, delete and edit inbound, and delete / edit
 * finance-related data have access management and others can only send
 * request").
 *
 * What counts is `approvalNeeded` in `@nusantara/store` — one copy, read by
 * the browser too. This file is the door: for an account without
 * `Staff.canApprove`, `/api/store/commit` answers 403 and the person sends a
 * change request instead (routes/changeRequests.ts).
 */
import { approvalNeeded, type ApprovalReason } from "@nusantara/store";
import { ApiError } from "../errors.js";

export interface ApprovalViewer {
  readonly canApprove: boolean;
}

const MESSAGES: Record<ApprovalReason, string> = {
  SALE_REMOVED: "Menghapus transaksi perlu persetujuan. Kirim permintaan.",
  SALE_EDITED: "Mengubah transaksi perlu persetujuan. Kirim permintaan.",
  INVOICE_CANCELLED: "Menghapus invoice perlu persetujuan. Kirim permintaan.",
  INVOICE_PRICES:
    "Mengubah harga atau diskon invoice perlu persetujuan. Kirim permintaan.",
  INVOICE_EXPENSE:
    "Mengubah atau menghapus biaya invoice perlu persetujuan. Kirim permintaan.",
  INVOICE_PAYMENT:
    "Mengubah atau menghapus pembayaran invoice perlu persetujuan. Kirim permintaan.",
  ADJUSTMENT_EDITED:
    "Mengubah atau menghapus pemasukan / pengeluaran perlu persetujuan. Kirim permintaan.",
};

/** Refuse, for a person who cannot approve, what only an approver may commit. */
export function assertApprovalNotNeeded(
  viewer: ApprovalViewer,
  changes: unknown,
): void {
  if (viewer.canApprove) return;
  const refusal = approvalNeeded(changes);
  if (refusal === undefined) return;
  throw new ApiError(403, "AKSES_DITOLAK", MESSAGES[refusal.reason], {
    field: refusal.collection,
  });
}
