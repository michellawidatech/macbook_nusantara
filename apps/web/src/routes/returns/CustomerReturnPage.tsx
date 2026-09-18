/**
 * Phase 4 — returns from customers: plain return (back to stock on arrival)
 * or exchange with another unit plus an optional fee.
 *
 * The reason list is not a constant in this file. It reads from `db.reasons`
 * (activity `RETURN_CUSTOMER`), which Settings owns, so adding a reason is a
 * settings change rather than a deploy. Picking "Other" reveals a required
 * free-text box — an "Other" with nothing beside it is a row that answers
 * nothing when someone reads it back in six months.
 */
import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { AuditOutlined, CheckOutlined, InboxOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { GradeTag } from "../../components/GradeTag";
import { GradingModal } from "../../components/GradingModal";
import { fmtRp, fmtDate } from "../../lib/format.js";
import { joinDescription, splitDescription } from "../../lib/inboundQc.js";
import { gradeForCondition, secondHandOnReturn } from "../../lib/condition.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  ensureQcDescription,
} from "../../mock/store.js";
import { FORM_CENTRE } from "../../theme/tokens";
import type { ReturnRec } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

export function CustomerReturnPanel({
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
  const [kind, setKind] = useState<"RETURN" | "EXCHANGE">("RETURN");
  const [reason, setReason] = useState<string>();
  /**
   * Which return rows have their receive-back panel open, keyed by return id.
   *
   * An expansion rather than a modal, and that is the owner's own word:
   * *"add a button to expand a QC / Grading section"*. The row is the context
   * — which machine, which customer, why it came back — and a dialog would put
   * that behind itself just as the person needs to read it.
   */
  const [receiving, setReceiving] = useState<string[]>([]);
  /** The condition phrases being picked, per return. */
  const [describing, setDescribing] = useState<Record<string, string[]>>({});
  /** A regrade chosen in the checklist, per return. */
  const [regrade, setRegrade] = useState<Record<string, string | undefined>>(
    {},
  );
  /** The return whose grading dialog is open. */
  const [gradingId, setGradingId] = useState<string | null>(null);

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_CUSTOMER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const soldUnits = db.units.filter((u) => u.status === "TERJUAL");
  const unitOf = (serial: string) => db.units.find((u) => u.serial === serial);
  /** What the machine IS — product and variant, without the order code. */
  const productLabel = (serial: string) => {
    const sku = db.skus.find((s) => s.id === unitOf(serial)?.skuId);
    return sku ? `${sku.name} ${sku.variantLabel}` : serial;
  };
  /** The product category behind a serial — what picks its grading checklist. */
  const categoryOf = (serial: string) => {
    const sku = db.skus.find((s) => s.id === unitOf(serial)?.skuId);
    return db.models.find((m) => m.id === sku?.modelId)?.category ?? "";
  };
  const label = (serial: string) => {
    const k = db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)!.skuId,
    )!;
    const o = db.orders.find((x) => x.serials.includes(serial));
    return `${serial} — ${k.name} ${k.variantLabel}${o ? ` (${o.code})` : ""}`;
  };

  const submit = (v: {
    serial: string;
    reason: string;
    reasonDetail?: string;
    date: dayjs.Dayjs;
    exchangeSerial?: string;
    fee?: number;
  }) => {
    mutate((d) => {
      d.returns.unshift({
        id: nextId("r"),
        code: docCode("SG"),
        kind: "CUSTOMER",
        serial: v.serial,
        reason: v.reason,
        reasonDetail: needsDetail ? v.reasonDetail?.trim() : undefined,
        date: v.date.format("YYYY-MM-DD"),
        status: "PENDING",
        exchangeSerial: kind === "EXCHANGE" ? v.exchangeSerial : undefined,
        fee: kind === "EXCHANGE" ? (v.fee ?? 0) : undefined,
      });
      if (kind === "EXCHANGE" && v.exchangeSerial) {
        appendEvent(d, v.exchangeSerial, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          note: `Exchange for ${v.serial}${v.fee ? ` + fee ${fmtRp(v.fee)}` : ""}`,
        });
      }
    });
    message.success("Return recorded — mark it arrived when the unit is back.");
    form.resetFields();
    setReason(undefined);
  };

  /**
   * Receive the machine back, and QC it on the way in (owner ask 2026-08-28).
   *
   * ## Why arrival grew a QC step
   *
   * *"If a new unit is bought then returned, it will be second, thus need
   * grading and description when receiving the unit back."*
   *
   * Until now this button restocked in one click, which was fine as long as
   * every returned machine was second-hand before it left. It is not: this
   * shop sells sealed stock, and a sealed machine that comes back has been
   * somebody's — the box is open, and *New* has stopped being true about it.
   * Putting it straight back on the shelf still labelled New would have the
   * shop advertising as sealed a machine it knows is not.
   *
   * So arrival writes three things in ONE transaction: the description, the
   * grade, and the `RETUR_PELANGGAN` event that moves the machine to
   * `TERSEDIA`. One mutation rather than three, because a moment in which the
   * machine is back in sellable stock and still graded New is exactly the
   * moment somebody sells it.
   *
   * ## What is required
   *
   * The same rule as intake, applied at the other end: a second-hand machine
   * needs a description, and everything coming back through this desk is
   * second-hand. The grade is optional here as it is there — a machine can be
   * restocked ungraded — but the panel offers it, and offers it with the same
   * checklist QC uses (`GradingModal`).
   */
  const receiveBack = (id: string) => {
    const r = db.returns.find((x) => x.id === id);
    if (!r) return;
    // Read exactly as `receivePanel` reads them, so the button cannot commit
    // something other than what the panel was showing.
    const unit = unitOf(r.serial);
    const parts = describing[id] ?? splitDescription(unit?.description ?? "");
    const grade =
      id in regrade ? regrade[id] : gradeForCondition("SECOND", unit?.grade);

    if (parts.length === 0) {
      message.error(
        t(
          "returnCustomer.describeBeforeRestock",
          "Say what condition it has come back in before putting it on the shelf.",
        ),
      );
      return;
    }

    mutate((d) => {
      const row = d.returns.find((x) => x.id === id)!;
      row.status = "ARRIVED";
      const u = d.units.find((x) => x.serial === row.serial);
      if (u) {
        // Vocabulary first, machine second — `ensureQcDescription`'s rule, so
        // there is no moment at which a machine is described by a phrase the
        // suggestion list has not heard of.
        u.description = joinDescription(
          parts.map((phrase) => ensureQcDescription(d, phrase)).filter(Boolean),
        );
        u.grade = grade;
      }
      // Back into stock — the system stocks it in again. The regrade rides on
      // this event rather than getting one of its own: one machine physically
      // arrived once, and a timeline that says so twice is a timeline that
      // has to be reconciled.
      appendEvent(d, row.serial, {
        type: "RETUR_PELANGGAN",
        toStatus: "TERSEDIA",
        note: [
          [r.reason, r.reasonDetail].filter(Boolean).join(": "),
          `restocked on arrival (${r.code})`,
          grade ? `regraded ${grade}` : "not regraded",
        ].join(" — "),
        refCode: row.code,
      });
    });
    setDescribing((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setRegrade((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    message.success(
      t("returnCustomer.backInStock", "Unit is back in sellable stock."),
    );
  };

  /** Open or close a row's QC panel, seeding it from what the unit holds. */
  const toggleReceiving = (id: string) => {
    setReceiving((now) =>
      now.includes(id) ? now.filter((x) => x !== id) : [...now, id],
    );
  };

  /**
   * The QC panel under a pending return.
   *
   * Three things, in the order the person at the counter does them: read what
   * changed about the machine, say what condition it is in, and grade it. The
   * restock button is the last of them and refuses until the description is
   * there — the same gate intake applies, for the same reason: a second-hand
   * machine that reaches the shelf with nothing written about it is one nobody
   * can list or answer a question about later.
   */
  const receivePanel = (r: ReturnRec) => {
    const unit = unitOf(r.serial);
    const wasNew = secondHandOnReturn(unit?.grade);
    const parts = describing[r.id] ?? splitDescription(unit?.description ?? "");
    const grade =
      r.id in regrade
        ? regrade[r.id]
        : gradeForCondition("SECOND", unit?.grade);

    return (
      <Flex vertical gap={12} style={{ maxWidth: 720 }}>
        {wasNew && (
          /*
           * The whole reason this panel exists. A machine that went out sealed
           * is not sealed any more, and the shop must stop saying it is before
           * the machine goes back on the shelf.
           */
          <Alert
            type="warning"
            showIcon
            title={t(
              "returnCustomer.wasNewTitle",
              "This went out as a new machine",
            )}
            description={t(
              "returnCustomer.wasNewBody",
              "It has been sold and opened, so it goes back on the shelf as second-hand. Describe the condition it has come back in, and grade it if you can.",
            )}
          />
        )}

        <Flex vertical gap={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("returnCustomer.conditionBack", "Condition it came back in")}{" "}
            <Typography.Text type="danger" aria-hidden>
              *
            </Typography.Text>
          </Typography.Text>
          {/*
           * The same tag list QC uses, reading the same vocabulary — a phrase
           * typed here joins `qcDescriptions` exactly as one typed at intake
           * does, so the shop keeps one list of the things it says about
           * machines rather than one per desk.
           */}
          <Select<string[]>
            mode="tags"
            value={parts}
            style={{ width: "100%" }}
            status={parts.length === 0 ? "warning" : undefined}
            placeholder={t(
              "returnCustomer.conditionPlaceholder",
              "Marks, what is in the box, what the customer reported…",
            )}
            aria-label={t(
              "returnCustomer.conditionBack",
              "Condition it came back in",
            )}
            aria-required
            tokenSeparators={[","]}
            options={db.qcDescriptions
              .filter((d) => d.active)
              .map((d) => ({ value: d.label }))}
            filterOption={(input, opt) =>
              String(opt?.value ?? "")
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            onChange={(next: string[]) =>
              setDescribing((m) => ({ ...m, [r.id]: next }))
            }
          />
        </Flex>

        <Flex align="center" gap={12} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("returnCustomer.newGrade", "New grade")}
          </Typography.Text>
          <GradeTag grade={grade} />
          <Button
            size="small"
            icon={<AuditOutlined />}
            onClick={() => setGradingId(r.id)}
          >
            {t("returnCustomer.gradeIt", "Grade it")}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              "returnCustomer.gradeOptional",
              "Optional — it can go back on the shelf ungraded.",
            )}
          </Typography.Text>
        </Flex>

        <Flex gap={8}>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            disabled={parts.length === 0}
            onClick={() => receiveBack(r.id)}
          >
            {t("returnCustomer.restock", "Put back in stock")}
          </Button>
          <Button onClick={() => toggleReceiving(r.id)}>
            {t("common.cancel", "Cancel")}
          </Button>
        </Flex>
      </Flex>
    );
  };

  /** The return whose grading dialog is open, resolved to its row. */
  const gradingReturn = db.returns.find((x) => x.id === gradingId);

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
          title={t("returnCustomer.recordAReturn", "Record a return")}
          destroyOnHidden
          // The form owns its own submit button, at the foot of the fields
          // where it already was. A second one in the modal's chrome would be
          // two Save buttons for one form.
          footer={null}
        >
          <>
            <Form
              form={form}
              layout="vertical"
              style={{ ...FORM_CENTRE, maxWidth: 640 }}
              initialValues={{ date: dayjs() }}
              onFinish={submit}
            >
              <Form.Item label={t("returnCustomer.type", "Type")}>
                <Radio.Group
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  optionType="button"
                  options={[
                    {
                      value: "RETURN",
                      label: t(
                        "returnCustomer.returnToStock",
                        "Return to stock",
                      ),
                    },
                    {
                      value: "EXCHANGE",
                      label: t(
                        "returnCustomer.exchangeWithAnotherUnit",
                        "Exchange with another unit",
                      ),
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="serial"
                label={t(
                  "returnCustomer.soldUnitFromTransactionHistory",
                  "Sold unit (from transaction history)",
                )}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t(
                    "returnCustomer.searchTheSerialThatIs",
                    "Search the serial that is coming back",
                  )}
                  options={soldUnits.map((u) => ({
                    value: u.serial,
                    label: label(u.serial),
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="reason"
                label={t("returnCustomer.reason", "Reason")}
                tooltip={t(
                  "returnCustomer.managedInSettingsReasonsPer",
                  "Managed in Settings → Reasons per activity",
                )}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t(
                    "returnCustomer.pickOrSearchAReason",
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
                  label={t(
                    "returnCustomer.specifyTheReason",
                    "Specify the reason",
                  )}
                  rules={[
                    {
                      required: true,
                      message: t(
                        "form.sayWhatHappened",
                        "Say what actually happened",
                      ),
                    },
                  ]}
                >
                  <Input.TextArea
                    rows={2}
                    placeholder={t(
                      "returnCustomer.whatWasWrongWithIt",
                      "What was wrong with it?",
                    )}
                  />
                </Form.Item>
              )}
              <Form.Item
                name="date"
                label={t("returnCustomer.date", "Date")}
                rules={[{ required: true }]}
              >
                <DatePicker format="DD MMM YYYY" />
              </Form.Item>
              {kind === "EXCHANGE" && (
                <>
                  <Form.Item
                    name="exchangeSerial"
                    label={t(
                      "returnCustomer.replacementUnit",
                      "Replacement unit",
                    )}
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={t(
                        "returnCustomer.unitHandedToTheCustomer",
                        "Unit handed to the customer instead",
                      )}
                      options={db.units
                        .filter((u) => u.status === "TERSEDIA")
                        .map((u) => ({
                          value: u.serial,
                          label: label(u.serial),
                        }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="fee"
                    label={t(
                      "returnCustomer.additionalFeeOptional",
                      "Additional fee (optional)",
                    )}
                  >
                    <MoneyInput />
                  </Form.Item>
                </>
              )}
              <Button type="primary" htmlType="submit">
                {t("returnCustomer.recordReturn", "Record return")}
              </Button>
            </Form>
          </>
        </Modal>

        <Card title={t("returnCustomer.returnHistory", "Return history")}>
          <ProTable
            rowKey="id"
            dataSource={db.returns.filter((r) => r.kind === "CUSTOMER")}
            searchPlaceholder={t(
              "returnCustomer.searchCodeSerialOrReason",
              "Search code, serial or reason",
            )}
            /*
             * The QC panel, opened by the row's own button rather than by an
             * expand chevron of antd's. There is one thing to do to a pending
             * return, and a chevron would be a second, quieter way to do it
             * sitting in a different column; hiding the expand column leaves
             * the button as the only handle.
             */
            expandable={{
              expandedRowKeys: receiving,
              showExpandColumn: false,
              expandedRowRender: receivePanel,
              rowExpandable: (r) => r.status === "PENDING",
            }}
            columns={[
              {
                title: t("returnCustomer.code", "Code"),
                dataIndex: "code",
                searchable: true,
              },
              {
                title: t("returnCustomer.serial", "Serial"),
                dataIndex: "serial",
                searchable: true,
              },
              {
                title: t("returnCustomer.product", "Product"),
                key: "product",
                facet: true,
                sortValue: (r) => {
                  const u = db.units.find((x) => x.serial === r.serial);
                  const k = u && db.skus.find((s) => s.id === u.skuId);
                  return k ? `${k.name} ${k.variantLabel}` : "—";
                },
                render: (_, r) => {
                  const u = db.units.find((x) => x.serial === r.serial);
                  const k = u && db.skus.find((s) => s.id === u.skuId);
                  return k ? `${k.name} ${k.variantLabel}` : "—";
                },
              },
              {
                title: t("returnCustomer.reason", "Reason"),
                key: "reason",
                facet: true,
                searchable: true,
                sortValue: (r) => r.reason,
                searchValue: (r) => `${r.reason} ${r.reasonDetail ?? ""}`,
                render: (_, r) => (
                  <>
                    <Tag>{r.reason}</Tag>
                    {r.reasonDetail && <div>{r.reasonDetail}</div>}
                  </>
                ),
              },
              {
                title: t("returnCustomer.date", "Date"),
                dataIndex: "date",
                defaultSortOrder: "descend",
                render: fmtDate,
              },
              {
                title: t("returnCustomer.exchange", "Exchange"),
                key: "exchange",
                sortValue: (r) => r.exchangeSerial ?? "",
                render: (_, r) =>
                  r.exchangeSerial
                    ? `${r.exchangeSerial}${r.fee ? ` + ${fmtRp(r.fee)}` : ""}`
                    : "—",
              },
              {
                title: t("returnCustomer.status", "Status"),
                dataIndex: "status",
                facet: true,
                sortValue: (r) =>
                  r.status === "PENDING"
                    ? "Waiting for the unit"
                    : "Arrived — restocked",
                render: (v) => (
                  <Tag color={v === "PENDING" ? "orange" : "green"}>
                    {v === "PENDING"
                      ? "Waiting for the unit"
                      : "Arrived — restocked"}
                  </Tag>
                ),
              },
              {
                // What the machine is graded as, so the desk can see at a
                // glance which returns are about to change condition — a New
                // in this column is a machine that goes back on the shelf as
                // second-hand (owner ask 2026-08-28).
                title: t("returnCustomer.grade", "Grade"),
                key: "grade",
                width: 90,
                render: (_, r) => <GradeTag grade={unitOf(r.serial)?.grade} />,
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                title: "",
                key: "actions",
                width: 140,
                render: (_, r) =>
                  r.status === "PENDING" && (
                    <Tooltip
                      title={t(
                        "returnCustomer.receiveHint",
                        "Open QC — describe and grade it, then put it back in stock",
                      )}
                    >
                      <Button
                        size="small"
                        type={receiving.includes(r.id) ? "default" : "primary"}
                        icon={<InboxOutlined />}
                        aria-label={t(
                          "returnCustomer.receiveAria",
                          "Receive {{serial}} back",
                          { serial: r.serial },
                        )}
                        aria-expanded={receiving.includes(r.id)}
                        onClick={() => toggleReceiving(r.id)}
                      >
                        {t("returnCustomer.receive", "Receive")}
                      </Button>
                    </Tooltip>
                  ),
              },
            ]}
          />
        </Card>
      </Flex>

      {/*
       * The same checklist QC uses (`components/GradingModal`). No grade-C
       * actions here: intake can send a C back to the supplier or onto the
       * bench, and this desk can do neither — the machine is already the
       * shop's, and it has just come back from a customer.
       */}
      {gradingReturn && (
        <GradingModal
          open
          onClose={() => setGradingId(null)}
          category={categoryOf(gradingReturn.serial)}
          subject={`${productLabel(gradingReturn.serial)} · ${gradingReturn.serial}`}
          currentGrade={unitOf(gradingReturn.serial)?.grade}
          onApply={(grade) =>
            setRegrade((m) => ({ ...m, [gradingReturn.id]: grade }))
          }
        />
      )}
    </>
  );
}
