/**
 * The service bench — every machine away at a repairer, and what it is costing.
 *
 * > *"In warehouse 4, we should be able to add the service fee per unit and
 * > another additional fee if the unit is then transferred to another
 * > warehouse. The service will be included to count the COGS."*
 * > — owner, 2026-09-08
 *
 * ## Why this is its own screen
 *
 * A machine at a repairer is stock the shop still owns and cannot sell, and it
 * behaves like nothing else in the building: it accrues cost while it sits
 * there, it has no shelf, and the question asked of it every morning is "how
 * long has that been gone?". Inventory answers "how many do we have"; the
 * expandable serial list under a product row can show a machine is at service
 * and cannot show a queue of them ordered by how overdue they are.
 *
 * ## Cost, and where it lands
 *
 * Each fee is one charge from one party — labour, a part, the courier — and
 * the total joins `Unit.buy` and the machine's share of its invoice's shipping
 * and tax (2026-09-15) in `costOfUnit`, which is what every margin in the app
 * is now computed against. `Unit.buy` itself is untouched: it is what
 * the machine cost to ACQUIRE, it is on a supplier's invoice, and rewriting it
 * would make the two disagree forever.
 *
 * Sending the machine back asks for the destination and lets one more fee be
 * added on the way out — the transfer itself, which is the owner's *"another
 * additional fee if the unit is then transferred"*.
 *
 * ## The bench in three steps (owner revision 2026-09-09)
 *
 * > *"So in 'Servis', the flow would be: See each unit that is supposed to be
 * > 'Serviced' or have the 'Service' status so that they know which unit is
 * > supposed to be there, mark it as arrived & start service, and adjust the
 * > fee."*
 *
 * That was two tables — **Expected**, sent and not signed for, and **On the
 * bench**, arrived — until the owner asked for **one** (2026-09-25):
 * *Serial | Problem | Sent from | Quoted | actions*. The three steps did not
 * change, only the number of lists: signing a unit in is the tick on a row
 * that has not had it, and it is still the thing that moves
 * `Unit.locationId`. Before that confirmation existed, sending a unit put it
 * in warehouse 4 instantly and the bench had a list of units that were not
 * there.
 *
 * Every charge is editable afterwards, which is the third step — *"not only
 * add but also reduce"*. A repairer who quotes Rp900k and bills Rp650k is the
 * ordinary case; see `editFee` in lib/service.ts for why the row is corrected
 * rather than removed. The charges are behind the row, which is the one door
 * to correcting one and why the merge did not take the expansion with it.
 *
 * ⚠️ Three columns went with the split and nothing replaced them: **Grade**,
 * **Away** (the days-gone tag, amber past a fortnight) and **Cost now**
 * (`costOfUnit` — bought, its share of the invoice's shipping and tax, and
 * every repair). The money is still recorded and still reaches every margin;
 * this screen just stopped printing the total. `BenchRow` still carries
 * `grade`-adjacent fields, `days`, `total`, `buy`, `shippingTax` and
 * `earlierRepair`, so putting any of them back is a column.
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Statistic,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { EditOutlined, InboxOutlined, PlusOutlined } from "@ant-design/icons";
import { SerialLink } from "../../components/SerialLink";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import {
  SERVICE_FEE_KINDS,
  benchRows,
  editFee,
  serviceLocationOf,
  visitCost,
  type BenchRow,
  type ServiceFee,
  type ServiceFeeKind,
} from "../../lib/service.js";
import {
  appendEvent,
  mutate,
  nextId,
  useDb,
  currentStaffName,
} from "../../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

export function ServicePage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [addingTo, setAddingTo] = useState<BenchRow | null>(null);
  /**
   * The charge being corrected, and the visit it belongs to.
   *
   * The same dialog as adding one — the questions are identical, and two
   * dialogs that ask the same three things is two places for them to drift.
   * Which of the two it is decides the title, the button and what `saveFee`
   * writes.
   */
  const [editingFee, setEditingFee] = useState<{
    row: BenchRow;
    fee: ServiceFee;
  } | null>(null);
  const [returning, setReturning] = useState<BenchRow | null>(null);
  const [feeForm] = Form.useForm<{
    kind: ServiceFeeKind;
    label?: string;
    amount: number;
  }>();
  const [backForm] = Form.useForm<{
    locationId: string;
    transferFee?: number;
    note?: string;
  }>();

  const rows = useMemo(
    () => benchRows(db),
    [db.services, db.units, db.pos, db.events],
  );

  const unitOf = (serial: string) => db.units.find((u) => u.serial === serial);
  const skuOf = (serial: string) => {
    const u = unitOf(serial);
    return u && db.skus.find((k) => k.id === u.skuId);
  };
  const warehouseName = (id: string | undefined) =>
    db.warehouses.find((w) => w.id === id)?.name ?? fmtNone();
  /** Found by `Location.kind`: `wh-4` is this shop's bench, not every shop's. */
  const bench = serviceLocationOf(db.warehouses);

  const totalCost = rows.reduce((n, r) => n + r.cost, 0);

  /*
   * ~~`markArrived`~~ went on 2026-09-25 (owner: *"no need to mark as
   * 'received' first"*). A unit now MOVES to the bench in the same
   * transaction that promises it to a repairer, so there is nothing left to
   * confirm — see the note on the table below, and `sendToService` in
   * InboundDetailPage / the adjustment in InventoryPage, which write it.
   */

  /**
   * Record a charge, or correct one already recorded.
   *
   * One handler for both because they are one form. What differs is only
   * whether an id already exists: `editFee` rewrites that row, and a new
   * charge is appended. Either way the machine's own timeline gets a line —
   * somebody chasing a serial should not have to know this screen exists to
   * find out what it cost.
   */
  const saveFee = () =>
    feeForm.validateFields().then((v) => {
      const target = editingFee ?? { row: addingTo!, fee: undefined };
      const row = target.row;
      const before = target.fee;
      mutate((d) => {
        const i = d.services.findIndex((r) => r.id === row.rec.id);
        if (i < 0) return;
        // Replaced rather than mutated in place: `ServiceRec` is a readonly
        // shape, the same discipline `Order.payments` follows, and the store
        // is replace-on-write anyway.
        const rec = d.services[i]!;
        d.services[i] = before
          ? editFee(rec, before.id, {
              kind: v.kind,
              label: v.label ?? "",
              amount: v.amount,
            })
          : {
              ...rec,
              fees: [
                ...rec.fees,
                {
                  id: nextId("svcf"),
                  kind: v.kind,
                  ...(v.label ? { label: v.label } : {}),
                  amount: v.amount,
                  at: new Date().toISOString(),
                  staff: currentStaffName(),
                },
              ],
            };
        appendEvent(d, row.serial, {
          type: "DICATAT",
          note: before
            ? // Both figures, because the point of allowing the correction is
              // that somebody has to be able to see what it replaced.
              `Service charge corrected ${fmtRp(before.amount)} → ${fmtRp(
                v.amount,
              )} — ${v.label || v.kind}`
            : `Service charge ${fmtRp(v.amount)} — ${v.label || v.kind}`,
        });
      });
      setAddingTo(null);
      setEditingFee(null);
      feeForm.resetFields();
      message.success(
        before
          ? t("service.feeEdited", "{{serial}}'s charge is now {{amount}}.", {
              amount: fmtRp(v.amount),
              serial: row.serial,
            })
          : t("service.feeAdded", "{{amount}} recorded against {{serial}}.", {
              amount: fmtRp(v.amount),
              serial: row.serial,
            }),
      );
    });

  /**
   * Send a machine back into stock.
   *
   * One `mutate`: the visit closes, the last fee is recorded, the unit's
   * status and location move and the event is appended — all together, for the
   * same reason every other movement in this app is one transaction. A machine
   * that is TERSEDIA at the service bench, or SERVIS on a shelf, is a machine
   * two screens disagree about.
   */
  const sendBack = () =>
    backForm.validateFields().then((v) => {
      const row = returning!;
      const at = new Date().toISOString();
      let closed = row.rec;
      mutate((d) => {
        const i = d.services.findIndex((r) => r.id === row.rec.id);
        if (i >= 0) {
          const rec = d.services[i]!;
          closed = {
            ...rec,
            fees:
              v.transferFee && v.transferFee > 0
                ? [
                    ...rec.fees,
                    {
                      id: nextId("svcf"),
                      kind: "SHIPPING",
                      label: t("service.transferLabel", "Transfer out"),
                      amount: v.transferFee,
                      at,
                      staff: currentStaffName(),
                    },
                  ]
                : rec.fees,
            closedAt: at,
            toLocationId: v.locationId,
          };
          d.services[i] = closed;
        }
        appendEvent(d, row.serial, {
          type: "DICATAT",
          toStatus: "TERSEDIA",
          toLocationId: v.locationId,
          note: [
            `Back from service — ${warehouseName(v.locationId)}`,
            v.note,
            `repair cost ${fmtRp(visitCost(closed))}`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        const u = d.units.find((x) => x.serial === row.serial);
        // The rack belongs to whichever warehouse it left; a machine coming
        // back has to be put on a shelf again.
        if (u) u.rackId = undefined;
      });
      setReturning(null);
      backForm.resetFields();
      message.success(
        t("service.backInStock", "{{serial}} is back in stock.", {
          serial: row.serial,
        }),
      );
    });

  return (
    <PageContainer title={t("service.title", "Service bench")}>
      <Flex vertical gap={SPACE.md}>
        <Flex gap={SPACE.md} wrap>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.away", "Units away")}
              value={rows.length}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.spent", "Spent on repairs")}
              value={fmtRp(totalCost)}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "service.spentHint",
                "Added to what each unit cost, so the margin is honest.",
              )}
            </Typography.Text>
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.bench", "Bench")}
              value={warehouseName(bench)}
            />
          </Card>
        </Flex>

        {/*
         * ONE table (owner ask 2026-09-25), where there were two — Expected
         * and On the bench. The split was this screen's own argument, that
         * "did the van arrive" and "what is this repair costing" are
         * different jobs; the owner's answer is that they are one list of
         * units that are not here.
         *
         * And there is no arrival step at all any more — *"no need to mark as
         * 'received' first"*, same ask. This REVERSES 2026-09-09, and the
         * thing that decision protected had to be moved rather than dropped:
         * a unit promised to a repairer is now MOVED to the bench in the same
         * transaction, so the bench's warehouse holds what the bench holds. It
         * was the confirmation that wrote the location, and without one the
         * alternative is `wh-4` holding nothing again — the 2026-09-08 bug.
         */}
        <Card title={t("service.atService", "At service")}>
          <Table<BenchRow>
            size="small"
            rowKey={(r) => r.rec.id}
            dataSource={rows}
            pagination={false}
            locale={{
              emptyText: t(
                "service.nothingAway",
                "Nothing is away at a repairer.",
              ),
            }}
            expandable={{
              rowExpandable: (r) => r.rec.fees.length > 0,
              expandedRowRender: (r) => (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={[...r.rec.fees]}
                  pagination={false}
                  columns={[
                    {
                      title: t("service.feeKind", "Charge"),
                      key: "kind",
                      width: COLUMN.status,
                      render: (_: unknown, f: (typeof r.rec.fees)[number]) =>
                        SERVICE_FEE_KINDS.find((k) => k.value === f.kind)
                          ?.label ?? f.kind,
                    },
                    {
                      title: t("service.feeLabel", "What for"),
                      key: "label",
                      render: (_: unknown, f: (typeof r.rec.fees)[number]) =>
                        f.label ?? fmtNone(),
                    },
                    {
                      title: t("service.feeWhen", "When"),
                      key: "at",
                      width: COLUMN.date,
                      render: (_: unknown, f: (typeof r.rec.fees)[number]) =>
                        fmtDate(f.at),
                    },
                    {
                      title: t("service.feeAmount", "Amount"),
                      key: "amount",
                      width: COLUMN.money,
                      align: "right",
                      render: (_: unknown, f: (typeof r.rec.fees)[number]) =>
                        fmtRp(f.amount),
                    },
                    {
                      /*
                       * Correcting a charge (owner ask 2026-09-09): *"not only
                       * add but also reduce"*. There is no remove beside it on
                       * purpose — nothing in this database is hard-deleted,
                       * and a charge edited to zero says "quoted and not
                       * paid", which is the more useful sentence.
                       */
                      title: "",
                      key: "edit",
                      width: COLUMN.action,
                      render: (_: unknown, f: (typeof r.rec.fees)[number]) => (
                        <Tooltip
                          title={t("service.editFee", "Change this charge")}
                        >
                          <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            aria-label={t(
                              "service.editFeeAria",
                              "Change the {{amount}} charge on {{serial}}",
                              { amount: fmtRp(f.amount), serial: r.serial },
                            )}
                            onClick={() => {
                              setEditingFee({ row: r, fee: f });
                              feeForm.setFieldsValue({
                                kind: f.kind,
                                label: f.label ?? "",
                                amount: f.amount,
                              });
                            }}
                          />
                        </Tooltip>
                      ),
                    },
                  ]}
                />
              ),
            }}
            columns={[
              {
                title: t("service.serial", "Serial"),
                key: "serial",
                render: (_, r) => {
                  const sku = skuOf(r.serial);
                  return (
                    <Flex vertical gap={0} align="flex-start">
                      <SerialLink serial={r.serial} />
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {sku
                          ? `${sku.name} ${sku.variantLabel}`
                          : t("service.unknownProduct", "Unknown product")}
                      </Typography.Text>
                    </Flex>
                  );
                },
              },
              {
                title: t("service.problem", "Problem"),
                key: "note",
                render: (_, r) => r.rec.note ?? fmtNone(),
              },
              {
                title: t("service.sentFrom", "Sent from"),
                key: "from",
                width: 170,
                render: (_, r) => warehouseName(r.rec.fromLocationId),
              },
              {
                /*
                 * What the repair has cost so far — the fees on THIS visit.
                 * The lines behind the row say what it is made of, and are
                 * where one of them is corrected.
                 */
                title: t("service.quoted", "Quoted"),
                key: "cost",
                width: COLUMN.money,
                align: "right",
                render: (_, r) => fmtRp(r.cost),
              },
              {
                /*
                 * Two buttons, both labelled (owner ask 2026-09-25). They were
                 * icons, and an icon is fine for a row action nobody has to
                 * find; these two ARE the screen — everything a bench does to
                 * a unit at a repairer is one of them.
                 */
                title: "",
                key: "actions",
                width: COLUMN.actionsWide,
                render: (_, r) => (
                  <Flex gap={SPACE.xs} justify="end">
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlusOutlined />}
                      aria-label={t(
                        "service.addFeeAria",
                        "Add a charge to {{serial}}",
                        { serial: r.serial },
                      )}
                      onClick={() => {
                        setAddingTo(r);
                        feeForm.setFieldsValue({ kind: "LABOUR" });
                      }}
                    >
                      {t("service.charge", "Charge")}
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<InboxOutlined />}
                      aria-label={t(
                        "service.sendBackAria",
                        "Put {{serial}} back in stock",
                        { serial: r.serial },
                      )}
                      onClick={() => {
                        setReturning(r);
                        backForm.setFieldsValue({
                          locationId: r.rec.fromLocationId,
                        });
                      }}
                    >
                      {t("service.backInStockShort", "Back in stock")}
                    </Button>
                  </Flex>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <Modal
        open={addingTo !== null || editingFee !== null}
        title={
          editingFee
            ? t("service.editChargeOn", "Change a charge on {{serial}}", {
                serial: editingFee.row.serial,
              })
            : t("service.addChargeTo", "Charge on {{serial}}", {
                serial: addingTo?.serial ?? "",
              })
        }
        okText={
          editingFee
            ? t("service.saveCharge", "Save the change")
            : t("service.record", "Record it")
        }
        onCancel={() => {
          setAddingTo(null);
          setEditingFee(null);
          feeForm.resetFields();
        }}
        onOk={saveFee}
      >
        {editingFee && (
          <Typography.Paragraph type="secondary">
            {t(
              "service.editChargeHint",
              "It was {{amount}}. The old figure stays on the unit's timeline.",
              { amount: fmtRp(editingFee.fee.amount) },
            )}
          </Typography.Paragraph>
        )}
        <Form form={feeForm} layout="vertical">
          <Form.Item
            name="kind"
            label={t("service.feeKind", "Charge")}
            rules={[{ required: true }]}
          >
            <Select
              options={SERVICE_FEE_KINDS.map((k) => ({
                value: k.value,
                label: k.label,
                title: k.guide,
              }))}
            />
          </Form.Item>
          <Form.Item name="label" label={t("service.feeLabel", "What for")}>
            <Input
              placeholder={t(
                "service.feeLabelPlaceholder",
                "Ganti keyboard, ongkir ke Bandung…",
              )}
            />
          </Form.Item>
          <Form.Item
            name="amount"
            label={t("service.feeAmount", "Amount")}
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              precision={0}
              prefix={RP_SYMBOL}
              formatter={moneyFormatter}
              parser={moneyParser}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={returning !== null}
        title={t("service.backTitle", "Put {{serial}} back in stock", {
          serial: returning?.serial ?? "",
        })}
        okText={t("service.backOk", "Back in stock")}
        onCancel={() => setReturning(null)}
        onOk={sendBack}
      >
        <Form form={backForm} layout="vertical">
          <Form.Item
            name="locationId"
            label={t("service.backTo", "Which warehouse")}
            rules={[{ required: true }]}
          >
            <Select
              // The bench itself is not a destination: a machine that is
              // finished with is somewhere it can be sold from.
              options={db.warehouses
                .filter((w) => w.active && w.id !== bench)
                .map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
          <Form.Item
            name="transferFee"
            label={t("service.transferFee", "Cost of moving it back")}
            tooltip={t(
              "service.transferFeeHint",
              "The courier back, if there was one. It joins the repair cost on this unit.",
            )}
          >
            <InputNumber
              min={0}
              precision={0}
              prefix={RP_SYMBOL}
              formatter={moneyFormatter}
              parser={moneyParser}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item name="note" label={t("service.backNote", "What was done")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
