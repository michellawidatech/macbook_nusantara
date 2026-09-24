/**
 * Machines waiting in QC that came off no purchase order.
 *
 * ## Why this exists
 *
 * QC used to be reachable only through the order a machine arrived on:
 * `/inbound/:id` builds its grid from `units.filter(u => u.poId === order.id)`,
 * so a unit whose `poId` is null appears on no QC screen at all. That was fine
 * while intake was the only way a unit could be born.
 *
 * It stopped being true on 2026-08-31, when Stock Opname gained the owner's
 * surplus button: a machine found on a shelf that the shop has never booked in
 * becomes a unit in QC with no order behind it. Without somewhere to grade it,
 * that unit would be stuck — counted in inventory, listed under its product,
 * and permanently unsellable, because the only arrow out of QC is drawn by a
 * screen it cannot appear on.
 *
 * So this is the other door into QC. It is deliberately the same conversation
 * the two existing desks have — condition, description, grade, then a decision
 * — with the same grade picker and the same `qcDescriptions` vocabulary, so a
 * unit graded here cannot be graded by different rules from one graded on an
 * order.
 *
 * ## Why it is on `/inbound` and not on its own menu item
 *
 * The section is called "Inbound & QC" and this is QC. A menu entry that is
 * empty on almost every day of the year is a menu entry staff learn to ignore
 * — and the card renders nothing at all when there is nothing waiting, so on
 * an ordinary day the page is exactly as it was.
 *
 * ## What it does NOT do
 *
 * No supplier return: there is no supplier to return it to, which is the whole
 * meaning of a machine with no order. A machine that turns out to be broken is
 * written off with `KOREKSI` — the same arrow the stock adjustment editor uses
 * — rather than sent back to nobody.
 */
import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Flex,
  Segmented,
  Select,
  Tooltip,
  Typography,
} from "antd";
import { EditableTable } from "./EditableTable";
import { CheckOutlined, StopOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { GradeTag } from "./GradeTag";
import { GRADES } from "../lib/grading.js";
import { fmtNone } from "../lib/format.js";
import { joinDescription, splitDescription } from "../lib/inboundQc.js";
import {
  CONDITIONS,
  canGrade,
  conditionOf,
  gradeForCondition,
  needsDescription,
  type UnitCondition,
} from "../lib/condition.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureQcDescription,
} from "../mock/store.js";

export function OrphanQcCard() {
  const { t } = useTranslation();
  const db = useDb();
  const { message, modal } = App.useApp();
  /** serial → the phrases typed into its description box, before committing. */
  const [describing, setDescribing] = useState<Record<string, string[]>>({});

  const waiting = db.units.filter((u) => u.status === "QC" && u.poId === null);
  // The whole card, including its heading, disappears when the shop has none.
  if (waiting.length === 0) return null;

  const skuOf = (skuId: string) => db.skus.find((k) => k.id === skuId);
  const partsOf = (serial: string, stored: string) =>
    describing[serial] ?? splitDescription(stored);

  /** Sealed or second-hand, written straight onto the unit as its grade. */
  const setCondition = (serial: string, condition: UnitCondition) =>
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      const grade = gradeForCondition(condition, u.grade);
      if (grade === u.grade) return;
      u.grade = grade;
      appendEvent(d, serial, {
        type: "DICATAT",
        note:
          condition === "NEW"
            ? "Marked new — sealed stock"
            : "Marked second-hand",
      });
    });

  /**
   * The letter, picked by hand.
   *
   * ⚠️ It came off the grading checklist until 2026-09-20, which also put its
   * working on the timeline beside the letter; the checklist UI is hidden
   * (owner ask), so what is written is the letter somebody chose.
   */
  const applyGrade = (serial: string, grade: string | undefined) =>
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u || u.grade === grade) return;
      u.grade = grade;
      appendEvent(d, serial, {
        type: "DICATAT",
        note: grade === undefined ? "Marked second-hand" : `Graded ${grade}`,
      });
    });

  /**
   * Onto the shelf.
   *
   * The description and the `QC_SELESAI` go in ONE mutation, for the reason
   * the return desk gives about its own arrival: a moment in which the machine
   * is sellable and still says nothing about itself is a moment somebody sells
   * it.
   */
  const accept = (serial: string) => {
    const unit = db.units.find((u) => u.serial === serial);
    if (!unit) return;
    const parts = partsOf(serial, unit.description);
    if (needsDescription(conditionOf(unit.grade)) && parts.length === 0) {
      message.error(
        t(
          "orphanQc.describeFirst",
          "Say what condition this unit is in before it goes on the shelf.",
        ),
      );
      return;
    }
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      // Vocabulary first, machine second — `ensureQcDescription`'s rule.
      u.description = joinDescription(
        parts.map((phrase) => ensureQcDescription(d, phrase)).filter(Boolean),
      );
      appendEvent(d, serial, {
        type: "QC_SELESAI",
        toStatus: "TERSEDIA",
        note: "Accepted into stock after opname",
      });
    });
    setDescribing((m) => {
      const next = { ...m };
      delete next[serial];
      return next;
    });
    message.success(
      t("orphanQc.accepted", "{{serial}} is on the shelf.", { serial }),
    );
  };

  /**
   * Not worth stocking.
   *
   * `KOREKSI` out, not a supplier return: there is no supplier behind a
   * machine that came off no order, and `unitState.ts` draws exactly this
   * arrow out of QC.
   */
  const writeOff = (serial: string) =>
    modal.confirm({
      title: t("orphanQc.writeOffTitle", "Write off {{serial}}?", { serial }),
      content: t(
        "orphanQc.writeOffBody",
        "It leaves stock and stays on the ledger. There is no supplier to send it back to — this unit came off no order.",
      ),
      okText: t("orphanQc.writeOffOk", "Write it off"),
      okButtonProps: { danger: true },
      onOk: () =>
        mutate((d) =>
          appendEvent(d, serial, {
            type: "KOREKSI",
            toStatus: "KOREKSI_KELUAR",
            note: "Written off at QC — found at opname, not worth stocking",
          }),
        ),
    });

  return (
    <Card
      title={t("orphanQc.title", "In QC without an order ({{count}})", {
        count: waiting.length,
      })}
      style={{ marginBottom: 16 }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t(
          "orphanQc.explain",
          "Units found at a stock take, not bought on an invoice. They count as stock but cannot be sold until they are graded here.",
        )}
      />
      <EditableTable
        rowKey="serial"
        size="small"
        /*
         * `scroll={{ x: 900 }}` stood here against 1310px of columns, so
         * rc-table took the 410px difference out of them and the Description
         * tag box came out too narrow to read a phrase in. `EditableTable`
         * sums the columns itself, and below `md` stacks each machine into a
         * card of labelled full-width fields instead of scrolling sideways.
         */
        dataSource={waiting}
        // The serial names the machine; the column repeating it under a label
        // would be the heading said twice.
        rowTitle={(u) => u.serial}
        columns={[
          {
            title: t("orphanQc.serial", "Serial"),
            width: 170,
            responsive: ["md" as const],
            render: (_, u) => (
              <Typography.Text style={{ fontFamily: "monospace" }}>
                {u.serial}
              </Typography.Text>
            ),
          },
          {
            title: t("orphanQc.product", "Product"),
            width: 220,
            render: (_, u) => {
              const k = skuOf(u.skuId);
              return k ? `${k.name} ${k.variantLabel}` : fmtNone();
            },
          },
          {
            title: t("orphanQc.warehouse", "Warehouse"),
            width: 150,
            render: (_, u) =>
              db.warehouses.find((w) => w.id === u.locationId)?.name ??
              fmtNone(),
          },
          {
            title: t("orphanQc.condition", "Condition"),
            width: 150,
            render: (_, u) => (
              <Segmented<UnitCondition>
                size="small"
                value={conditionOf(u.grade)}
                onChange={(c) => setCondition(u.serial, c)}
                aria-label={t("orphanQc.condition", "Condition")}
                options={CONDITIONS.map((c) => ({
                  value: c,
                  label:
                    c === "NEW"
                      ? t("orphanQc.conditionNew", "New")
                      : t("orphanQc.conditionSecond", "Second"),
                }))}
              />
            ),
          },
          {
            title: t("orphanQc.describe", "Description"),
            width: 300,
            render: (_, u) => {
              const second = needsDescription(conditionOf(u.grade));
              return (
                // The same tag list QC and the return desk use, reading the
                // same vocabulary — one list of the things this shop says
                // about machines, not one per desk.
                <Select<string[]>
                  mode="tags"
                  size="small"
                  style={{ width: "100%" }}
                  value={partsOf(u.serial, u.description)}
                  status={
                    second && partsOf(u.serial, u.description).length === 0
                      ? "warning"
                      : undefined
                  }
                  placeholder={
                    second
                      ? t(
                          "orphanQc.describePlaceholder",
                          "Marks, what is in the box…",
                        )
                      : t(
                          "orphanQc.describeOptional",
                          "Optional for sealed stock",
                        )
                  }
                  aria-label={t("orphanQc.describe", "Description")}
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
                    setDescribing((m) => ({ ...m, [u.serial]: next }))
                  }
                />
              );
            },
          },
          {
            title: t("orphanQc.grade", "Grade"),
            width: 140,
            render: (_, u) =>
              // Sealed stock has no letter to pick: there is nothing to
              // inspect in an unopened box.
              canGrade(conditionOf(u.grade)) ? (
                <Select<string>
                  size="small"
                  style={{ width: "100%" }}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  value={u.grade}
                  placeholder={t("orphanQc.gradePlaceholder", "Grade")}
                  aria-label={t("orphanQc.gradeAria", "Grade {{serial}}", {
                    serial: u.serial,
                  })}
                  options={GRADES.map((g) => ({ value: g, label: g }))}
                  onChange={(v?: string) => applyGrade(u.serial, v)}
                />
              ) : (
                <GradeTag grade={u.grade} />
              ),
          },
          {
            title: "",
            key: "actions",
            width: 180,
            render: (_, u) => (
              <Flex gap={8} justify="end">
                <Tooltip
                  title={t(
                    "orphanQc.acceptHint",
                    "Put it on the shelf at this product's asking price",
                  )}
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => accept(u.serial)}
                  >
                    {t("orphanQc.accept", "Accept")}
                  </Button>
                </Tooltip>
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  aria-label={t(
                    "orphanQc.writeOffAria",
                    "Write off {{serial}}",
                    {
                      serial: u.serial,
                    },
                  )}
                  onClick={() => writeOff(u.serial)}
                />
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );
}
