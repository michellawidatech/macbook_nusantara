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
 * So the screen is two tables. **Expected** is what has been sent and not yet
 * signed for — the machines somebody at warehouse 4 should be able to find on
 * the receiving shelf this morning, and the list they check the van against.
 * **On the bench** is everything that has arrived, which is where the work and
 * all the money are. A machine crosses from one to the other by somebody
 * confirming it, and that confirmation is what moves `Unit.locationId`: before
 * this, sending a machine put it in warehouse 4 instantly and the bench had a
 * list of machines that were not there.
 *
 * Every charge is editable afterwards, which is the third step — *"not only
 * add but also reduce"*. A repairer who quotes Rp900k and bills Rp650k is the
 * ordinary case; see `editFee` in lib/service.ts for why the row is corrected
 * rather than removed.
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
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckOutlined,
  EditOutlined,
  PlusOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { GradeTag } from "../../components/GradeTag";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import { fmtRp, fmtDate } from "../../lib/format.js";
import {
  SERVICE_FEE_KINDS,
  benchRows,
  editFee,
  serviceLocationOf,
  splitBench,
  visitCost,
  type BenchRow,
  type ServiceFee,
  type ServiceFeeKind,
} from "../../lib/service.js";
import { appendEvent, mutate, nextId, useDb, currentStaffName } from "../../mock/store.js";
import { SPACE, TYPE } from "../../theme/tokens";

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
  const { expected, onBench } = useMemo(() => splitBench(rows), [rows]);

  const unitOf = (serial: string) =>
    db.units.find((u) => u.serial === serial);
  const skuOf = (serial: string) => {
    const u = unitOf(serial);
    return u && db.skus.find((k) => k.id === u.skuId);
  };
  const warehouseName = (id: string | undefined) =>
    db.warehouses.find((w) => w.id === id)?.name ?? "—";
  /** Found by `Location.kind`: `wh-4` is this shop's bench, not every shop's. */
  const bench = serviceLocationOf(db.warehouses);

  const totalCost = rows.reduce((n, r) => n + r.cost, 0);

  /**
   * Sign a machine in at the bench (owner ask 2026-09-09).
   *
   * This is the moment the unit actually MOVES: status and location together
   * in one `mutate`, which is this database's whole rule. Until somebody here
   * has seen the machine, warehouse 4 does not claim to hold it — the alterna-
   * tive is a warehouse view listing machines that are still in a van, which is
   * exactly what this replaced.
   *
   * The status is already SERVIS and stays SERVIS; nothing about arriving
   * makes a machine sellable. The event is appended anyway, because "arrived
   * at the bench on the 9th" is a fact somebody chasing a repair asks for.
   */
  const markArrived = (row: BenchRow) => {
    const at = new Date().toISOString();
    mutate((d) => {
      const i = d.services.findIndex((r) => r.id === row.rec.id);
      if (i >= 0) d.services[i] = { ...d.services[i]!, arrivedAt: at };
      appendEvent(d, row.serial, {
        type: "DICATAT",
        ...(bench ? { toLocationId: bench } : {}),
        note: `Arrived at service — ${warehouseName(bench)}`,
      });
    });
    message.success(
      t("service.arrivedOk", "{{serial}} is at the bench. Work can start.", {
        serial: row.serial,
      }),
    );
  };

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
              title={t("service.away", "Machines away")}
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
                "Added to what each machine cost, so the margin is honest.",
              )}
            </Typography.Text>
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.bench", "Bench")}
              value={warehouseName(bench)}
            />
            {expected.length > 0 && (
              <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
                {t("service.expectedCount", "{{n}} on the way", {
                  n: expected.length,
                })}
              </Typography.Text>
            )}
          </Card>
        </Flex>

        {/*
         * What the bench is waiting for (owner ask 2026-09-09).
         *
         * Only drawn when something is on its way: an empty table headed
         * "Expected" every day of the year teaches people to stop reading the
         * top of the screen, and the machines that matter are underneath it.
         */}
        {expected.length > 0 && (
          <Card
            title={t("service.expected", "Expected at the bench")}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t(
                  "service.expectedHint",
                  "Sent, and not signed for yet. Confirm one when you have it in your hands — that is what puts it in {{bench}}.",
                  { bench: warehouseName(bench) },
                )}
              </Typography.Text>
            }
          >
            <Table<BenchRow>
              size="small"
              rowKey={(r) => r.rec.id}
              dataSource={expected}
              pagination={false}
              columns={[
                {
                  title: t("service.serial", "Serial"),
                  key: "serial",
                  render: (_, r) => {
                    const sku = skuOf(r.serial);
                    return (
                      <Flex vertical gap={0}>
                        <Link to={`/stock/history?serial=${r.serial}`}>
                          {r.serial}
                        </Link>
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
                  render: (_, r) => r.rec.note ?? "—",
                },
                {
                  title: t("service.sentFrom", "Sent from"),
                  key: "from",
                  width: 170,
                  render: (_, r) => warehouseName(r.rec.fromLocationId),
                },
                {
                  /*
                   * How long it has been in transit. Amber past three days,
                   * which for two warehouses in one city is long enough to
                   * telephone the courier about — a different threshold from
                   * the fortnight a repair gets, because a different thing has
                   * gone wrong.
                   */
                  title: t("service.sentWhen", "Sent"),
                  key: "days",
                  width: 130,
                  render: (_, r) => (
                    <Tag color={r.days >= 3 ? "orange" : "default"}>
                      {t("service.nDaysAgo", "{{n}} days ago", { n: r.days })}
                    </Tag>
                  ),
                },
                {
                  title: t("service.quoted", "Quoted so far"),
                  key: "cost",
                  width: 160,
                  align: "right",
                  render: (_, r) => fmtRp(r.cost),
                },
                {
                  title: "",
                  key: "actions",
                  width: 210,
                  render: (_, r) => (
                    <Flex justify="end">
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={() => markArrived(r)}
                      >
                        {t("service.markArrived", "Arrived — start service")}
                      </Button>
                    </Flex>
                  ),
                },
              ]}
            />
          </Card>
        )}

        <Card title={t("service.onTheBench", "On the bench")}>
          <Table<BenchRow>
            size="small"
            rowKey={(r) => r.rec.id}
            dataSource={onBench}
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
                      width: 140,
                      render: (
                        _: unknown,
                        f: (typeof r.rec.fees)[number],
                      ) =>
                        SERVICE_FEE_KINDS.find((k) => k.value === f.kind)
                          ?.label ?? f.kind,
                    },
                    {
                      title: t("service.feeLabel", "What for"),
                      key: "label",
                      render: (
                        _: unknown,
                        f: (typeof r.rec.fees)[number],
                      ) => f.label ?? "—",
                    },
                    {
                      title: t("service.feeWhen", "When"),
                      key: "at",
                      width: 140,
                      render: (
                        _: unknown,
                        f: (typeof r.rec.fees)[number],
                      ) => fmtDate(f.at),
                    },
                    {
                      title: t("service.feeAmount", "Amount"),
                      key: "amount",
                      width: 150,
                      align: "right",
                      render: (
                        _: unknown,
                        f: (typeof r.rec.fees)[number],
                      ) => fmtRp(f.amount),
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
                      width: 56,
                      render: (
                        _: unknown,
                        f: (typeof r.rec.fees)[number],
                      ) => (
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
                    <Flex vertical gap={0}>
                      <Link to={`/stock/history?serial=${r.serial}`}>
                        {r.serial}
                      </Link>
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
                title: t("service.grade", "Grade"),
                key: "grade",
                width: 90,
                render: (_, r) => <GradeTag grade={unitOf(r.serial)?.grade} />,
              },
              {
                title: t("service.problem", "Problem"),
                key: "note",
                render: (_, r) => r.rec.note ?? "—",
              },
              {
                title: t("service.sentFrom", "Sent from"),
                key: "from",
                width: 160,
                render: (_, r) => warehouseName(r.rec.fromLocationId),
              },
              {
                /*
                 * How long it has been gone, which is the question this screen
                 * is opened to answer. Amber past a fortnight — the point at
                 * which a repairer needs telephoning rather than waiting for.
                 */
                title: t("service.days", "Away"),
                key: "days",
                width: 110,
                render: (_, r) => (
                  <Tag color={r.days >= 14 ? "orange" : "default"}>
                    {t("service.nDays", "{{n}} days", { n: r.days })}
                  </Tag>
                ),
              },
              {
                title: t("service.cost", "Repair so far"),
                key: "cost",
                width: 160,
                align: "right",
                render: (_, r) => fmtRp(r.cost),
              },
              {
                /*
                 * Everything the machine has cost — `costOfUnit`: bought, its
                 * share of its invoice's shipping and tax, and every repair,
                 * this one included. The number it now has to sell above, and
                 * the whole reason the fees are recorded: a Rp4jt machine with
                 * Rp800k of repair in it is a Rp4.8jt machine, and a till
                 * quoting Rp4.5jt for it is losing money. The lines under it
                 * say what it is made of.
                 */
                title: t("service.total", "Cost now"),
                key: "total",
                width: 170,
                align: "right",
                render: (_, r) => (
                  <Flex vertical align="flex-end" gap={0}>
                    <Typography.Text strong>{fmtRp(r.total)}</Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {t("service.wasBought", "bought {{amount}}", {
                        amount: fmtRp(r.buy),
                      })}
                    </Typography.Text>
                    {r.shippingTax > 0 && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("service.shippingTax", "shipping & tax {{amount}}", {
                          amount: fmtRp(r.shippingTax),
                        })}
                      </Typography.Text>
                    )}
                    {r.earlierRepair > 0 && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t(
                          "service.earlierRepairs",
                          "earlier repairs {{amount}}",
                          { amount: fmtRp(r.earlierRepair) },
                        )}
                      </Typography.Text>
                    )}
                  </Flex>
                ),
              },
              {
                title: "",
                key: "actions",
                width: 96,
                render: (_, r) => (
                  <Flex gap={4} justify="end">
                    <Tooltip title={t("service.addFee", "Add a charge")}>
                      <Button
                        size="small"
                        type="text"
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
                      />
                    </Tooltip>
                    <Tooltip
                      title={t("service.sendBack", "Put it back in stock")}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<RollbackOutlined />}
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
                      />
                    </Tooltip>
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
              "It was {{amount}}. The old figure stays on the machine's timeline.",
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
              "The courier back, if there was one. It joins the repair cost on this machine.",
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
