/**
 * Sending an edit or a delete of money as a REQUEST (2026-11-13).
 *
 * For a person without `canApprove` the dialogs keep their normal flow and
 * end differently: instead of `mutate(fn)`, `sendChangeRequest` runs `fn` on a
 * copy (`proposeChange`), posts the changeset with what it is about, the
 * change in words and why, and leaves the screen as it was. The approver's
 * Approve commits that changeset on the server; the store's next poll brings
 * the result to every till.
 *
 * The words are written here, in the requester's language, from the store
 * before and after — the approver reads the change, not a diff.
 */
import { proposeChange, type ProposedChange } from "../mock/store.js";
import type { MockDb, Order, Po } from "../mock/seed.js";
import type { TFunction } from "../i18n/translate.js";
import {
  createChangeRequest,
  type ChangeRequest,
  type ChangeRequestKind,
  type ChangeRequestTarget,
} from "./changeRequestsApi.js";
import { refreshChangeRequests } from "../hooks/useChangeRequests.js";
import { fmtDateTime, fmtNone, fmtRp } from "./format.js";
import { customerLabel } from "./customers.js";
import { channelOf } from "./channels.js";

/** Thrown when the dialog's edit changes nothing, so there is nothing to ask. */
export class NothingToRequestError extends Error {
  override readonly name = "NothingToRequestError";
  constructor() {
    super("Nothing to request");
  }
}

export interface ChangeRequestInput {
  readonly kind: ChangeRequestKind;
  readonly target: ChangeRequestTarget;
  readonly label: string;
  readonly note: string;
  /** The change in words, from the store before and after. */
  readonly summarise: (change: ProposedChange) => string;
}

/** File `fn` as a request instead of committing it. */
export async function sendChangeRequest(
  input: ChangeRequestInput,
  fn: (draft: MockDb) => void,
): Promise<ChangeRequest> {
  const change = proposeChange(fn);
  if (change === null) throw new NothingToRequestError();
  const request = await createChangeRequest({
    kind: input.kind,
    target: input.target,
    label: input.label,
    summary: input.summarise(change),
    note: input.note.trim(),
    changeset: change.changeset,
  });
  void refreshChangeRequests();
  return request;
}

const line = (what: string, before: string, after: string) =>
  `${what}: ${before} → ${after}`;

/** A sale's change, field by field — what Edit transaction would write. */
export function saleChangeSummary(
  t: TFunction,
  before: MockDb,
  after: MockDb,
  orderId: string,
): string {
  const was = before.orders.find((o) => o.id === orderId);
  const now = after.orders.find((o) => o.id === orderId);
  if (was === undefined) return "";
  if (now === undefined)
    return t("changeReq.sumSaleDeleted", "Delete {{code}} — {{total}}", {
      code: was.code,
      total: fmtRp(was.total),
    });
  const out: string[] = [];
  const who = (db: MockDb, o: Order) => {
    const c = db.customers.find((x) => x.id === o.customerId);
    return c ? customerLabel(c) || fmtNone() : fmtNone();
  };
  if (was.ts !== now.ts)
    out.push(
      line(
        t("changeReq.sumDate", "Date"),
        fmtDateTime(was.ts),
        fmtDateTime(now.ts),
      ),
    );
  if (was.source !== now.source)
    out.push(
      line(
        t("changeReq.sumChannel", "Channel"),
        channelOf(was.source)?.label ?? was.source,
        channelOf(now.source)?.label ?? now.source,
      ),
    );
  if (was.customerId !== now.customerId)
    out.push(
      line(
        t("changeReq.sumCustomer", "Customer"),
        who(before, was),
        who(after, now),
      ),
    );
  const gone = was.serials.filter((s) => !now.serials.includes(s));
  const added = now.serials.filter((s) => !was.serials.includes(s));
  for (const s of gone)
    out.push(
      t("changeReq.sumUnitOff", "Unit taken off: {{serial}}", { serial: s }),
    );
  for (const s of added)
    out.push(
      t("changeReq.sumUnitOn", "Unit added: {{serial}} at {{price}}", {
        serial: s,
        price: fmtRp(now.prices[s] ?? 0),
      }),
    );
  for (const s of was.serials) {
    if (!now.serials.includes(s)) continue;
    if ((was.prices[s] ?? 0) !== (now.prices[s] ?? 0))
      out.push(
        line(
          t("changeReq.sumUnitPrice", "Price of {{serial}}", { serial: s }),
          fmtRp(was.prices[s] ?? 0),
          fmtRp(now.prices[s] ?? 0),
        ),
      );
  }
  const skuName = (id: string) => {
    const k =
      after.skus.find((x) => x.id === id) ??
      before.skus.find((x) => x.id === id);
    return k ? `${k.name} ${k.variantLabel}`.trim() : id;
  };
  const lines = (o: Order) =>
    (o.lines ?? []).map(
      (l) => `${skuName(l.skuId)} × ${l.qty} @ ${fmtRp(l.price)}`,
    );
  const wasLines = lines(was).join(", ");
  const nowLines = lines(now).join(", ");
  if (wasLines !== nowLines)
    out.push(
      line(
        t("changeReq.sumLines", "Accessories"),
        wasLines || fmtNone(),
        nowLines || fmtNone(),
      ),
    );
  if (was.discount !== now.discount)
    out.push(
      line(
        t("changeReq.sumDiscount", "Discount"),
        fmtRp(was.discount),
        fmtRp(now.discount),
      ),
    );
  if ((was.extra ?? 0) !== (now.extra ?? 0))
    out.push(
      line(
        t("changeReq.sumCharges", "Additional charges"),
        fmtRp(was.extra ?? 0),
        fmtRp(now.extra ?? 0),
      ),
    );
  const trade = (o: Order) =>
    (o.tradeIns ?? []).reduce((n, x) => n + x.value, 0);
  if (trade(was) !== trade(now))
    out.push(
      line(
        t("changeReq.sumTradeIn", "Trade-in"),
        fmtRp(trade(was)),
        fmtRp(trade(now)),
      ),
    );
  const paid = (o: Order) =>
    (o.payments ?? []).reduce((n, p) => n + p.amount, 0);
  if (paid(was) !== paid(now))
    out.push(
      line(
        t("changeReq.sumPayments", "Payments"),
        fmtRp(paid(was)),
        fmtRp(paid(now)),
      ),
    );
  if (was.total !== now.total)
    out.push(
      line(
        t("changeReq.sumTotal", "Total"),
        fmtRp(was.total),
        fmtRp(now.total),
      ),
    );
  return out.join("\n");
}

/** A purchase invoice's money, line by line. */
export function invoiceChangeSummary(
  t: TFunction,
  before: MockDb,
  after: MockDb,
  poId: string,
): string {
  const was = before.pos.find((p) => p.id === poId);
  const now = after.pos.find((p) => p.id === poId);
  if (was === undefined) return "";
  if (now === undefined)
    return t("changeReq.sumInvoiceDeleted", "Delete invoice {{code}}", {
      code: was.code,
    });
  const out: string[] = [];
  const skuName = (id: string) => {
    const k = before.skus.find((x) => x.id === id);
    return k ? `${k.name} ${k.variantLabel}`.trim() : id;
  };
  /** Per product: pieces, and what they cost after their discount. */
  const billed = (po: Po) => {
    const m = new Map<
      string,
      { qty: number; prices: Set<number>; discount: number }
    >();
    for (const i of po.items) {
      const had = m.get(i.skuId) ?? {
        qty: 0,
        prices: new Set<number>(),
        discount: 0,
      };
      had.qty += Math.max(1, i.qty);
      had.prices.add(i.unitCost);
      had.discount += i.discount ?? 0;
      m.set(i.skuId, had);
    }
    return m;
  };
  const a = billed(was);
  const b = billed(now);
  const show = (
    x: { qty: number; prices: Set<number>; discount: number } | undefined,
  ) =>
    x === undefined
      ? fmtNone()
      : `${x.qty} × ${[...x.prices].map((p) => fmtRp(p)).join(" / ")}${
          x.discount > 0 ? ` − ${fmtRp(x.discount)}` : ""
        }`;
  for (const sku of new Set([...a.keys(), ...b.keys()])) {
    const x = show(a.get(sku));
    const y = show(b.get(sku));
    if (x !== y) out.push(line(skuName(sku), x, y));
  }
  const feeName = (po: Po, id: string) =>
    po.fees.find((f) => f.id === id)?.label ||
    po.fees.find((f) => f.id === id)?.kind ||
    id;
  for (const f of was.fees) {
    const n = now.fees.find((x) => x.id === f.id);
    if (n === undefined)
      out.push(
        t(
          "changeReq.sumExpenseRemoved",
          "Expense removed: {{name}} ({{amount}})",
          {
            name: feeName(was, f.id),
            amount: fmtRp(f.amount),
          },
        ),
      );
    else if (n.amount !== f.amount)
      out.push(line(feeName(was, f.id), fmtRp(f.amount), fmtRp(n.amount)));
  }
  for (const p of was.payments) {
    const n = now.payments.find((x) => x.id === p.id);
    if (n === undefined)
      out.push(
        t("changeReq.sumPaymentRemoved", "Payment removed: {{amount}}", {
          amount: fmtRp(p.amount),
        }),
      );
    else if (n.amount !== p.amount)
      out.push(
        line(
          t("changeReq.sumPayment", "Payment"),
          fmtRp(p.amount),
          fmtRp(n.amount),
        ),
      );
  }
  if (was.discount !== now.discount)
    out.push(
      line(
        t("changeReq.sumDiscount", "Discount"),
        fmtRp(was.discount),
        fmtRp(now.discount),
      ),
    );
  return out.join("\n");
}
