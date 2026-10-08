/**
 * Return an in-stock unit to its supplier. The history includes units rejected
 * at QC, which arrive here without anyone filling in this form — the Stock In
 * page opens them. Those rows carry `fromQc`, and the table says so, because
 * "why is there a supplier return I never created" is otherwise a real question.
 *
 * A counted product — an accessory — goes back by QUANTITY (owner ask
 * 2026-09-19). It has no unit to hang a `UnitReturn` on, so it leaves as a
 * `RETUR_SUPPLIER` stock move carrying the SP code, the reason, and the
 * invoice the pieces came in on; that invoice is what names the supplier
 * (owner decision: a move, not a document — so no expected credit either).
 * Both kinds share the one history table below.
 */
import { useState } from "react";
import { App, Button, Flex, Form, Input, Modal, Segmented, Select } from "antd";
import { MoneyInput } from "../../components/MoneyInput";
import { CountInput } from "../../components/CountInput";
import { fmtDate, fmtNone } from "../../lib/format.js";
import { averageCost, onHand, stockLevels } from "../../lib/stock.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  currentStaffName,
} from "../../mock/store.js";
import { FORM_CENTRE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";
import { warehouseLabelOf } from "../../lib/warehouses.js";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

/** What goes back: one unit by serial, or pieces of a counted product. */
type What = "UNIT" | "COUNTED";

/** A line of the history — a unit's `UnitReturn`, or a counted product's move. */

export function SupplierReturnPanel({
  addOpen,
  onCloseAdd,
}: {
  addOpen: boolean;
  onCloseAdd: () => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [reason, setReason] = useState<string>();
  const [what, setWhat] = useState<What>("UNIT");
  const skuId: string | undefined = Form.useWatch("skuId", form);
  const locationId: string | undefined = Form.useWatch("locationId", form);
  const poId: string | undefined = Form.useWatch("poId", form);

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_SUPPLIER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const returnable = db.units.filter((u) =>
    ["TERSEDIA", "QC", "SERVIS"].includes(u.status),
  );
  const skuName = (id: string | undefined) => {
    const k = db.skus.find((s) => s.id === id);
    return k ? `${k.name} ${k.variantLabel}` : fmtNone();
  };
  const warehouseName = (id: string) =>
    warehouseLabelOf(db.warehouses, id) ?? id;

  /** Counted products the shop holds, and where. */
  const levels = stockLevels(db.stockMoves);
  const countedHeld = [...levels.keys()]
    .map((id) => ({ id, qty: onHand(db.stockMoves, id) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => skuName(a.id).localeCompare(skuName(b.id)));
  const heldAt = [...(levels.get(skuId ?? "") ?? new Map<string, number>())]
    .filter(([, n]) => n > 0)
    .sort(([, x], [, y]) => y - x);
  const maxQty = heldAt.find(([loc]) => loc === locationId)?.[1] ?? 0;
  /** The invoices this product came in on — newest first. */
  const invoicesOf = (id: string | undefined) =>
    db.pos
      .filter(
        (p) =>
          p.items.some((i) => i.skuId === id) &&
          db.stockMoves.some((m) => m.poId === p.id && m.type === "MASUK"),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  const invoices = invoicesOf(skuId);

  const label = (serial: string) => {
    const k = db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)!.skuId,
    )!;
    return `${serial} — ${k.name} ${k.variantLabel}`;
  };

  const submit = (v: {
    serial: string;
    supplierId: string;
    reason: string;
    reasonDetail?: string;
    credit?: number;
  }) => {
    mutate((d) => {
      d.returns.unshift({
        id: nextId("r"),
        code: docCode("SP"),
        kind: "SUPPLIER",
        serial: v.serial,
        reason: v.reason,
        reasonDetail: needsDetail ? v.reasonDetail?.trim() : undefined,
        date: new Date().toISOString().slice(0, 10),
        status: "DONE",
        supplierId: v.supplierId,
        expectedCredit: v.credit,
      });
      appendEvent(d, v.serial, {
        type: "RETUR_SUPPLIER",
        toStatus: "RETUR_SUPPLIER",
        note: [v.reason, needsDetail ? v.reasonDetail : null]
          .filter(Boolean)
          .join(": "),
      });
    });
    message.success("Unit returned to the supplier.");
    form.resetFields();
    setReason(undefined);
  };

  const submitCounted = (v: {
    skuId: string;
    locationId: string;
    qty: number;
    poId?: string;
    reason: string;
    reasonDetail?: string;
  }) => {
    const reasonId = reasons.find((r) => r.label === v.reason)?.id;
    let short = false;
    mutate((d) => {
      // Checked again inside the write: another till may have sold some.
      if (onHand(d.stockMoves, v.skuId, v.locationId) < v.qty) {
        short = true;
        return;
      }
      d.stockMoves.push({
        id: nextId("sm"),
        skuId: v.skuId,
        locationId: v.locationId,
        qty: -v.qty,
        cost: averageCost(d, v.skuId),
        type: "RETUR_SUPPLIER",
        at: new Date().toISOString(),
        refCode: docCode("SP"),
        poId: v.poId,
        reasonId,
        note: needsDetail ? v.reasonDetail?.trim() : undefined,
        staff: currentStaffName(),
      });
    });
    if (short) {
      message.error(
        t(
          "returnSupplier.countedShort",
          "Not enough left in that warehouse — someone may have just sold some.",
        ),
      );
      return;
    }
    message.success(
      t(
        "returnSupplier.countedReturned",
        "{{count}} × {{product}} returned to the supplier.",
        { count: v.qty, product: skuName(v.skuId) },
      ),
    );
    form.resetFields();
    setReason(undefined);
  };

  const reasonFields = (
    <>
      <Form.Item
        name="reason"
        label={t("returnSupplier.reason", "Reason")}
        tooltip={t(
          "returnSupplier.managedInSettingsReasonsPer",
          "Managed in Settings → Reasons per activity",
        )}
        rules={[{ required: true }]}
      >
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={t(
            "returnSupplier.pickOrSearchAReason",
            "Pick or search a reason",
          )}
          options={reasons.map((r) => ({
            value: r.label,
            label: r.label,
          }))}
          onChange={setReason}
        />
      </Form.Item>
      {needsDetail && (
        <Form.Item
          name="reasonDetail"
          label={t("returnSupplier.specifyTheReason", "Specify the reason")}
          rules={[
            {
              required: true,
              message: t(
                "returnSupplier.sayWhatIsActuallyWrong",
                "Say what is actually wrong with it",
              ),
            },
          ]}
        >
          <Input.TextArea
            rows={2}
            placeholder={t(
              "returnSupplier.eGDeadPixelCluster",
              "e.g. dead pixel cluster, hinge play",
            )}
          />
        </Form.Item>
      )}
    </>
  );

  return (
    <>
      <Flex vertical gap={16}>
        {/*
         * The form is a modal, not a side drawer (owner decision 2026-08-26).
         *
         * Recording a return is a form with its own beginning and end — pick a
         * unit, say why, save — and nothing on the history table behind it
         * informs a single field. A drawer is for work you do WHILE reading
         * what is underneath; this is work you do INSTEAD. Centring it also
         * puts the fields under the reader's eye rather than out at the right
         * margin of a wide screen, which is the same reasoning that centred
         * every other form in this app.
         */}
        <Modal
          open={addOpen}
          onCancel={onCloseAdd}
          width={720}
          title={t("returnSupplier.recordAReturn", "Record a return")}
          destroyOnHidden
          // The form owns its own submit button, at the foot of the fields
          // where it already was. A second one in the modal's chrome would be
          // two Save buttons for one form.
          footer={null}
        >
          <>
            <Segmented<What>
              block
              value={what}
              onChange={(v) => {
                setWhat(v);
                form.resetFields();
                setReason(undefined);
              }}
              options={[
                {
                  value: "UNIT",
                  label: t("returnSupplier.whatUnit", "A unit (by serial)"),
                },
                {
                  value: "COUNTED",
                  label: t(
                    "returnSupplier.whatCounted",
                    "Counted product (by quantity)",
                  ),
                },
              ]}
              style={{ ...FORM_CENTRE, maxWidth: 640, marginBottom: 16 }}
            />
            {what === "UNIT" ? (
              <Form
                form={form}
                layout="vertical"
                style={{ ...FORM_CENTRE, maxWidth: 640 }}
                onFinish={submit}
              >
                <Form.Item
                  name="serial"
                  label={t(
                    "returnSupplier.unitInInventory",
                    "Unit in inventory",
                  )}
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={t(
                      "returnSupplier.searchSerial",
                      "Search serial",
                    )}
                    options={returnable.map((u) => ({
                      value: u.serial,
                      label: label(u.serial),
                    }))}
                    onChange={(serial: string) => {
                      const u = db.units.find((x) => x.serial === serial);
                      const sup = db.pos.find(
                        (p) => p.id === u?.poId,
                      )?.supplierId;
                      form.setFieldsValue({ supplierId: sup, credit: u?.buy });
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="supplierId"
                  label={t("returnSupplier.supplier", "Supplier")}
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={db.suppliers.map((s) => ({
                      value: s.id,
                      label: s.name,
                    }))}
                  />
                </Form.Item>
                {reasonFields}
                <Form.Item
                  name="credit"
                  label={t("returnSupplier.expectedCredit", "Expected credit")}
                >
                  <MoneyInput />
                </Form.Item>
                <Button type="primary" htmlType="submit">
                  {t(
                    "returnSupplier.recordSupplierReturn",
                    "Record supplier return",
                  )}
                </Button>
              </Form>
            ) : (
              <Form
                form={form}
                layout="vertical"
                style={{ ...FORM_CENTRE, maxWidth: 640 }}
                onFinish={submitCounted}
              >
                <Form.Item
                  name="skuId"
                  label={t("returnSupplier.product", "Product")}
                  rules={[{ required: true }]}
                  extra={
                    countedHeld.length === 0
                      ? t(
                          "returnSupplier.noCountedStock",
                          "No counted product is in stock.",
                        )
                      : undefined
                  }
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={t(
                      "returnSupplier.searchProduct",
                      "Search product",
                    )}
                    options={countedHeld.map((x) => ({
                      value: x.id,
                      label: t(
                        "returnSupplier.productInStock",
                        "{{product}} — {{count}} in stock",
                        { product: skuName(x.id), count: x.qty },
                      ),
                    }))}
                    onChange={(id: string) => {
                      const fullest = [...(levels.get(id) ?? new Map())]
                        .filter(([, n]) => n > 0)
                        .sort(([, x], [, y]) => y - x)[0]?.[0];
                      form.setFieldsValue({
                        locationId: fullest,
                        qty: 1,
                        poId: invoicesOf(id)[0]?.id,
                      });
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="locationId"
                  label={t("returnSupplier.warehouse", "Warehouse")}
                  rules={[{ required: true }]}
                >
                  <Select
                    disabled={!skuId}
                    options={heldAt.map(([loc, n]) => ({
                      value: loc,
                      label: t(
                        "returnSupplier.warehouseHolds",
                        "{{warehouse}} — {{count}} in stock",
                        { warehouse: warehouseName(loc), count: n },
                      ),
                    }))}
                    onChange={() => form.setFieldsValue({ qty: 1 })}
                  />
                </Form.Item>
                <Form.Item
                  name="qty"
                  label={t("returnSupplier.qty", "Qty")}
                  rules={[
                    { required: true },
                    {
                      validator: (_, v: number | null) =>
                        v == null || (v >= 1 && v <= maxQty)
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(
                                t(
                                  "returnSupplier.qtyOverStock",
                                  "Only {{count}} in that warehouse.",
                                  { count: maxQty },
                                ),
                              ),
                            ),
                    },
                  ]}
                >
                  <CountInput
                    min={1}
                    max={maxQty || undefined}
                    disabled={!locationId}
                    aria-label={t("returnSupplier.qty", "Qty")}
                  />
                </Form.Item>
                <Form.Item
                  name="poId"
                  label={t("returnSupplier.cameInOn", "Invoice it came in on")}
                  tooltip={t(
                    "returnSupplier.cameInOnHint",
                    "The invoice is what records which supplier it goes back to.",
                  )}
                  rules={[{ required: invoices.length > 0 }]}
                  extra={
                    poId
                      ? db.suppliers.find(
                          (s) =>
                            s.id ===
                            db.pos.find((p) => p.id === poId)?.supplierId,
                        )?.name
                      : undefined
                  }
                >
                  <Select
                    disabled={!skuId}
                    allowClear={invoices.length === 0}
                    options={invoices.map((p) => ({
                      value: p.id,
                      label: `${p.code} · ${
                        db.suppliers.find((s) => s.id === p.supplierId)?.name ??
                        fmtNone()
                      } · ${fmtDate(p.date)}`,
                    }))}
                  />
                </Form.Item>
                {reasonFields}
                <Button type="primary" htmlType="submit">
                  {t(
                    "returnSupplier.recordSupplierReturn",
                    "Record supplier return",
                  )}
                </Button>
              </Form>
            )}
          </>
        </Modal>
      </Flex>
    </>
  );
}
