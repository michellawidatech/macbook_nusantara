/**
 * Pick units to send to service from a list (owner ask 2026-11-10: *"an add
 * to service button which can select all the unit in inventory (or any unit
 * in PO)"*). Every unit that may go — on a shelf, or still in QC on an
 * inbound invoice — with a search, a where-is-it filter and antd's own
 * select-all, so a whole shelf or a whole invoice is two clicks.
 *
 * It only PICKS: the chosen serials are handed back to `ServiceBatchModal`,
 * which asks where, the courier and a description, and writes through the
 * store like every other send (so every till sees it).
 */
import { useEffect, useMemo, useState } from "react";
import { Flex, Input, Modal, Segmented, Select, Table, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { useDb } from "../mock/store.js";
import { sendToServiceBlock } from "../lib/serviceActions.js";
import { warehouseLabel, warehouseLabelOf } from "../lib/warehouses.js";
import { fmtNone } from "../lib/format.js";
import { GradeTag } from "./GradeTag";
import { COLUMN, SPACE } from "../theme/tokens";

type Source = "ALL" | "SHELF" | "QC";

interface PickRow {
  readonly serial: string;
  readonly product: string;
  readonly grade?: string;
  readonly status: "QC" | "TERSEDIA";
  readonly locationId: string;
  readonly invoice?: string;
}

export function ServiceUnitPicker({
  open,
  exclude,
  onPick,
  onClose,
  zIndex,
}: {
  readonly open: boolean;
  /** Serials already on the batch — not offered again. */
  readonly exclude: readonly string[];
  readonly onPick: (serials: string[]) => void;
  readonly onClose: () => void;
  readonly zIndex?: number;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("ALL");
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
  }, [open]);

  const all = useMemo<PickRow[]>(() => {
    const skus = new Map(db.skus.map((s) => [s.id, s]));
    const pos = new Map(db.pos.map((p) => [p.id, p]));
    return db.units
      .filter(
        (u) =>
          sendToServiceBlock(u.status) === undefined &&
          !exclude.includes(u.serial),
      )
      .map((u) => {
        const sku = skus.get(u.skuId);
        const po = u.poId ? pos.get(u.poId) : undefined;
        return {
          serial: u.serial,
          product: sku ? `${sku.name} · ${sku.variantLabel}` : u.skuId,
          ...(u.grade ? { grade: u.grade } : {}),
          status: u.status as "QC" | "TERSEDIA",
          locationId: u.locationId,
          ...(u.status === "QC" && po
            ? { invoice: po.invoice ? `${po.code} · ${po.invoice}` : po.code }
            : {}),
        };
      })
      .sort(
        (a, b) =>
          a.product.localeCompare(b.product, undefined, { numeric: true }) ||
          a.serial.localeCompare(b.serial),
      );
  }, [db.units, db.skus, db.pos, exclude]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(
    (r) =>
      (source === "ALL" ||
        (source === "QC" ? r.status === "QC" : r.status === "TERSEDIA")) &&
      (warehouses.length === 0 || warehouses.includes(r.locationId)) &&
      words.every((w) =>
        `${r.serial} ${r.product} ${r.invoice ?? ""}`.toLowerCase().includes(w),
      ),
  );

  return (
    <Modal
      open={open}
      centered
      zIndex={zIndex}
      width={960}
      title={t("servicePicker.title", "Choose units to send to service")}
      okText={t("servicePicker.ok", "Add {{count}} unit(s)", {
        count: picked.length,
      })}
      okButtonProps={{ disabled: picked.length === 0 }}
      onCancel={onClose}
      onOk={() => {
        onPick(picked);
        onClose();
      }}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.sm}>
        <Flex gap={SPACE.sm} wrap>
          <Input.Search
            allowClear
            style={{ flex: "1 1 260px" }}
            aria-label={t(
              "servicePicker.search",
              "Search serial, product or invoice",
            )}
            placeholder={t(
              "servicePicker.search",
              "Search serial, product or invoice",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Segmented<Source>
            value={source}
            onChange={setSource}
            options={[
              { value: "ALL", label: t("servicePicker.all", "All") },
              {
                value: "SHELF",
                label: t("servicePicker.shelf", "Inventory"),
              },
              { value: "QC", label: t("servicePicker.qc", "In QC (invoice)") },
            ]}
          />
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 220 }}
            aria-label={t("inventory.anyWarehouse", "Any warehouse")}
            placeholder={t("inventory.anyWarehouse", "Any warehouse")}
            value={warehouses}
            onChange={setWarehouses}
            options={db.warehouses
              .filter((w) => w.active)
              .map((w) => ({ value: w.id, label: warehouseLabel(w) }))}
            optionFilterProp="label"
          />
        </Flex>
        <Table<PickRow>
          size="small"
          rowKey="serial"
          dataSource={shown}
          pagination={{
            pageSize: 50,
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
          scroll={{ y: 420 }}
          rowSelection={{
            selectedRowKeys: picked,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setPicked(keys.map(String)),
          }}
          onRow={(r) => ({
            onClick: () =>
              setPicked((p) =>
                p.includes(r.serial)
                  ? p.filter((s) => s !== r.serial)
                  : [...p, r.serial],
              ),
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: t(
              "servicePicker.none",
              "No unit in QC or on a shelf matches.",
            ),
          }}
          columns={[
            {
              title: t("inventory.serial", "Serial"),
              dataIndex: "serial",
              width: COLUMN.serial,
              render: (v: string) => (
                <span style={{ fontFamily: "monospace" }}>{v}</span>
              ),
            },
            {
              title: t("serviceBatch.unit", "Unit"),
              dataIndex: "product",
            },
            {
              title: t("inventory.grade", "Grade"),
              key: "grade",
              width: COLUMN.grade,
              render: (_, r) =>
                r.grade ? <GradeTag grade={r.grade} /> : fmtNone(),
            },
            {
              title: t("servicePicker.where", "Where"),
              key: "where",
              width: 260,
              render: (_, r) => (
                <Flex vertical gap={0}>
                  <span>
                    {warehouseLabelOf(db.warehouses, r.locationId) ?? fmtNone()}
                  </span>
                  {r.status === "QC" && (
                    <span>
                      <Tag color="gold" style={{ marginInlineEnd: 4 }}>
                        QC
                      </Tag>
                      {r.invoice ?? ""}
                    </span>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      </Flex>
    </Modal>
  );
}
