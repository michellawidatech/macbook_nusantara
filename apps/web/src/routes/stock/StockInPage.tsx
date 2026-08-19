/**
 * Phase 2 — QC. Units arrive here from a PO and wait to be accepted into
 * sellable inventory or rejected out of it. A unit is only accepted once serial
 * + description + a non-zero price are recorded; rejecting sends it back to the
 * supplier or on to service, and it never enters stock.
 *
 * Two views over the same pending queue, because there are two ways to work:
 *
 * - **By store** — an accordion, one panel per warehouse, collapsed on arrival.
 *   This is the shape of the physical job: you are standing in one warehouse
 *   with one supplier's boxes, and every other warehouse is noise. Collapsed by
 *   default so opening a panel is a decision rather than the page's opinion.
 * - **Table** — every pending unit at once, searchable and sortable. This is
 *   the shape of the *supervisory* job: what is still waiting, oldest first,
 *   across the whole business.
 *
 * The editing state is shared between them (`draft`, keyed by serial), so
 * switching views mid-edit keeps what you typed.
 */
import { useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  Collapse,
  Dropdown,
  Empty,
  Flex,
  Input,
  Segmented,
  Select,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  CheckOutlined,
  CloseOutlined,
  TableOutlined,
  ToolOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  ensureReason,
} from "../../mock/store.js";
import type { MockDb, Unit } from "../../mock/seed.js";

interface DraftRow {
  serial?: string;
  description?: string;
  price?: number;
  rackId?: string;
}

/**
 * Gross margin on the selling price: what share of the sale is not cost.
 *
 * Deliberately margin and not markup. The two differ by their denominator and
 * the same pair of numbers produces "18%" or "22%" depending which you mean, so
 * the definition is spelled out in the cell's tooltip too — a bare percentage
 * beside two money figures is a number nobody can check.
 */
function marginPct(price: number | undefined, buy: number): number | null {
  if (!price || price <= 0) return null;
  return ((price - buy) / price) * 100;
}

export function StockInPage() {
  const db = useDb();
  const { message, modal } = App.useApp();
  const [view, setView] = useState<"STORE" | "TABLE">("STORE");
  // Draft edits keyed by the unit's current (possibly placeholder) serial.
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});

  const qcUnits = useMemo(
    () => db.units.filter((u) => u.status === "QC"),
    [db.units],
  );

  const skuOf = (skuId: string) => db.skus.find((s) => s.id === skuId);
  const poOf = (poId: string | null) => db.pos.find((p) => p.id === poId);
  const supplierOf = (poId: string | null) =>
    db.suppliers.find((s) => s.id === poOf(poId)?.supplierId)?.name ??
    "No supplier";
  const warehouseOf = (id: string) =>
    db.warehouses.find((w) => w.id === id)?.name ?? id;

  const rowOf = (serial: string): DraftRow => draft[serial] ?? {};
  const setRow = (serial: string, patch: DraftRow) =>
    setDraft((d) => ({ ...d, [serial]: { ...d[serial], ...patch } }));

  const problems = (key: string, r: DraftRow): string | null => {
    const serial = (r.serial ?? (key.startsWith("TBD-") ? "" : key)).trim();
    if (!serial) return "serial number is required";
    if (db.units.some((u) => u.serial === serial && u.serial !== key)) {
      return `serial ${serial} already exists in the system`;
    }
    if (!r.description?.trim()) return "description is required";
    if (!r.price || r.price <= 0) return "price cannot be 0";
    return null;
  };

  const dropDraft = (key: string) =>
    setDraft((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });

  /** Accept one unit into inventory. Returns false (and warns) if it can't. */
  const accept = (key: string, quiet = false): boolean => {
    const r = rowOf(key);
    const err = problems(key, r);
    if (err) {
      if (!quiet) message.warning(`${key}: ${err}`);
      return false;
    }
    mutate((d) => {
      const unit = d.units.find((u) => u.serial === key)!;
      const finalSerial = (r.serial ?? key).trim();
      if (finalSerial !== key) {
        unit.serial = finalSerial;
        d.events
          .filter((e) => e.serial === key)
          .forEach((e) => (e.serial = finalSerial));
      }
      unit.description = r.description!.trim();
      unit.price = r.price!;
      unit.rackId = r.rackId;
      appendEvent(d, finalSerial, {
        type: "QC_SELESAI",
        toStatus: "TERSEDIA",
        note: `${unit.description} — priced ${fmtRp(unit.price)}${
          r.rackId ? ` — ${d.racks.find((x) => x.id === r.rackId)?.name}` : ""
        }`,
      });
      d.stockIns.unshift({
        id: nextId("si"),
        serial: finalSerial,
        skuId: unit.skuId,
        poId: unit.poId,
        locationId: unit.locationId,
        rackId: r.rackId,
        decision: "ACCEPTED",
        buy: unit.buy,
        price: unit.price ?? undefined,
        description: unit.description,
        at: new Date().toISOString(),
        staff: "Michella",
      });
    });
    dropDraft(key);
    if (!quiet) message.success(`${key} accepted into inventory.`);
    return true;
  };

  /**
   * Reject one unit out of the queue. A rejection is a decision with a
   * destination, so the confirm names it: back to the supplier (which opens a
   * supplier return) or on to service.
   */
  const reject = (key: string, kind: "SUPPLIER" | "SERVICE") => {
    const label =
      kind === "SUPPLIER" ? "Return to supplier" : "Send to service";
    const unit = db.units.find((u) => u.serial === key);
    modal.confirm({
      title: `${label}?`,
      okText: label,
      okButtonProps: { danger: true },
      content: `${key} will not enter inventory. Its history stays tracked, and it shows up in Stock In history as rejected.`,
      onOk: () => {
        mutate((d: MockDb) => {
          const u = d.units.find((x) => x.serial === key)!;
          const reasonLabel =
            kind === "SUPPLIER" ? "Rejected at QC" : "On Service";
          // The managed reason list is written FIRST, so nothing ever points at
          // a reason Settings has not heard of.
          ensureReason(
            d,
            kind === "SUPPLIER" ? "RETURN_SUPPLIER" : "ADJUSTMENT",
            reasonLabel,
          );
          if (kind === "SUPPLIER") {
            d.returns.unshift({
              id: nextId("r"),
              code: docCode("SP"),
              kind: "SUPPLIER",
              serial: key,
              reason: reasonLabel,
              date: new Date().toISOString().slice(0, 10),
              status: "DONE",
              fromQc: true,
              supplierId: d.pos.find((p) => p.id === u.poId)?.supplierId,
              expectedCredit: u.buy,
            });
            appendEvent(d, key, {
              type: "RETUR_SUPPLIER",
              toStatus: "RETUR_SUPPLIER",
              note: reasonLabel,
            });
          } else {
            appendEvent(d, key, {
              type: "DICATAT",
              toStatus: "SERVIS",
              note: "Sent to service from QC",
            });
          }
          d.stockIns.unshift({
            id: nextId("si"),
            serial: key,
            skuId: u.skuId,
            poId: u.poId,
            locationId: u.locationId,
            decision: "REJECTED",
            rejectKind: kind,
            reason: reasonLabel,
            buy: u.buy,
            at: new Date().toISOString(),
            staff: "Michella",
          });
        });
        dropDraft(key);
        message.success(
          kind === "SUPPLIER"
            ? `${key} rejected — a supplier return was opened.`
            : `${key} sent to service.`,
        );
      },
    });
    return unit;
  };

  const acceptMany = (units: readonly Unit[]) => {
    // Validate the whole batch first: accepting three of five and stopping
    // leaves the operator guessing which two failed and why.
    const bad = units
      .map((u) => ({
        serial: u.serial,
        err: problems(u.serial, rowOf(u.serial)),
      }))
      .filter((x) => x.err);
    if (bad.length) {
      return void modal.warning({
        title: `${bad.length} unit(s) are not ready`,
        content: (
          <Flex vertical gap={4}>
            {bad.slice(0, 8).map((b) => (
              <span key={b.serial}>
                <strong>{b.serial}</strong> — {b.err}
              </span>
            ))}
            {bad.length > 8 && <span>…and {bad.length - 8} more.</span>}
          </Flex>
        ),
      });
    }
    let ok = 0;
    for (const u of units) if (accept(u.serial, true)) ok += 1;
    message.success(`${ok} unit(s) accepted into inventory.`);
  };

  /** The columns shared by the accordion tables and the flat table view. */
  const editorColumns = (showWarehouse: boolean) => [
    {
      title: "Product",
      key: "product",
      width: 240,
      searchable: true,
      sortValue: (u: Unit) =>
        `${skuOf(u.skuId)?.name} ${skuOf(u.skuId)?.variantLabel}`,
      render: (_: unknown, u: Unit) => {
        const sku = skuOf(u.skuId);
        return (
          <>
            {sku?.name}
            <Typography.Text type="secondary" style={{ display: "block" }}>
              {sku?.variantLabel}
            </Typography.Text>
          </>
        );
      },
    },
    ...(showWarehouse
      ? [
          {
            title: "Store",
            key: "store",
            width: 130,
            facet: true,
            sortValue: (u: Unit) => warehouseOf(u.locationId),
            render: (_: unknown, u: Unit) => warehouseOf(u.locationId),
          },
          {
            title: "Supplier",
            key: "supplier",
            width: 150,
            facet: true,
            searchable: true,
            sortValue: (u: Unit) => supplierOf(u.poId),
            render: (_: unknown, u: Unit) => supplierOf(u.poId),
          },
        ]
      : []),
    {
      title: (
        <>
          Serial number <Typography.Text type="danger">*</Typography.Text>
        </>
      ),
      key: "serial",
      width: 210,
      searchable: true,
      sortValue: (u: Unit) => u.serial,
      render: (_: unknown, u: Unit) => (
        <Input
          value={
            rowOf(u.serial).serial ??
            (u.serial.startsWith("TBD-") ? "" : u.serial)
          }
          placeholder="Scan or type the serial"
          onChange={(e) => setRow(u.serial, { serial: e.target.value })}
        />
      ),
    },
    {
      title: (
        <>
          Description <Typography.Text type="danger">*</Typography.Text>
        </>
      ),
      key: "description",
      render: (_: unknown, u: Unit) => (
        <Input
          value={rowOf(u.serial).description ?? ""}
          placeholder="Condition, battery health, completeness…"
          onChange={(e) => setRow(u.serial, { description: e.target.value })}
        />
      ),
    },
    {
      // Owner's layout: the price you are SETTING is the field, and what the
      // unit cost sits under it as context — not up beside the product name,
      // three columns away from the number it should be compared with. The
      // margin rides on the same line as the cost, right-aligned, so the three
      // figures read as one thought: sold for, bought for, keeps this much.
      title: (
        <>
          Selling price <Typography.Text type="danger">*</Typography.Text>
        </>
      ),
      key: "price",
      width: 260,
      sortValue: (u: Unit) => rowOf(u.serial).price ?? 0,
      render: (_: unknown, u: Unit) => {
        const price = rowOf(u.serial).price;
        const pct = marginPct(price, u.buy);
        return (
          <Flex vertical gap={2}>
            <MoneyInput
              value={price}
              onChange={(v) => setRow(u.serial, { price: v ?? undefined })}
              placeholder="0"
            />
            <Flex justify="space-between" align="baseline" gap={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Bought {fmtRp(u.buy)}
              </Typography.Text>
              <Tooltip title="Gross margin = (selling − bought) ÷ selling">
                <Typography.Text
                  style={{ fontSize: 12 }}
                  type={
                    pct === null ? "secondary" : pct < 0 ? "danger" : "success"
                  }
                >
                  {pct === null
                    ? "—"
                    : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
                </Typography.Text>
              </Tooltip>
            </Flex>
          </Flex>
        );
      },
    },
    {
      title: "Location",
      key: "rack",
      width: 150,
      sortValue: (u: Unit) =>
        db.racks.find((r) => r.id === rowOf(u.serial).rackId)?.name,
      render: (_: unknown, u: Unit) => (
        <Select
          allowClear
          style={{ width: "100%" }}
          placeholder="Rack"
          value={rowOf(u.serial).rackId}
          // Only this warehouse's racks: "Rack 1" in Warehouse 2 is a different
          // shelf from "Rack 1" in Warehouse 1, and offering both would let a
          // unit be filed onto a shelf in a building it is not in.
          options={db.racks
            .filter((r) => r.active && r.warehouseId === u.locationId)
            .map((r) => ({ value: r.id, label: r.name }))}
          onChange={(v) => setRow(u.serial, { rackId: v })}
        />
      ),
    },
    {
      // Blank title by this codebase's convention: DataTable drops an untitled
      // column to the foot of the card on a phone, where buttons belong.
      title: "",
      key: "actions",
      width: 110,
      render: (_: unknown, u: Unit) => (
        <Flex gap={8}>
          <Tooltip title="Accept into inventory">
            <Button
              type="primary"
              aria-label={`Accept ${u.serial}`}
              icon={<CheckOutlined />}
              onClick={() => accept(u.serial)}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: "sup",
                  icon: <UndoOutlined />,
                  label: "Reject — return to supplier",
                  onClick: () => reject(u.serial, "SUPPLIER"),
                },
                {
                  key: "svc",
                  icon: <ToolOutlined />,
                  label: "Reject — send to service",
                  onClick: () => reject(u.serial, "SERVICE"),
                },
              ],
            }}
          >
            <Tooltip title="Reject">
              <Button
                danger
                aria-label={`Reject ${u.serial}`}
                icon={<CloseOutlined />}
              />
            </Tooltip>
          </Dropdown>
        </Flex>
      ),
    },
  ];

  /** The accordion: one panel per warehouse, each holding its POs. */
  const byStore = (() => {
    const stores = new Map<string, Unit[]>();
    for (const u of qcUnits)
      stores.set(u.locationId, [...(stores.get(u.locationId) ?? []), u]);
    return [...stores.entries()];
  })();

  const storeView = (
    <Collapse
      accordion
      // Collapsed on arrival by owner decision: opening a store is a choice the
      // operator makes, not a default the page makes for them.
      defaultActiveKey={[]}
      items={byStore.map(([locationId, units]) => {
        const byPo = new Map<string, Unit[]>();
        for (const u of units)
          byPo.set(u.poId ?? "-", [...(byPo.get(u.poId ?? "-") ?? []), u]);
        return {
          key: locationId,
          label: (
            <Flex gap={8} align="center" wrap>
              <strong>{warehouseOf(locationId)}</strong>
              <Tag color="orange">{units.length} waiting</Tag>
              <Typography.Text type="secondary">
                {byPo.size} purchase order(s)
              </Typography.Text>
            </Flex>
          ),
          children: (
            <Flex vertical gap={16}>
              {[...byPo.entries()].map(([poId, poUnits]) => (
                <Card
                  key={poId}
                  size="small"
                  title={
                    <Flex gap={8} align="center" wrap>
                      <span>{poOf(poId)?.code ?? "No PO"}</span>
                      <Tag>{supplierOf(poId)}</Tag>
                      <Typography.Text type="secondary">
                        {poUnits.length} unit(s)
                      </Typography.Text>
                    </Flex>
                  }
                  extra={
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={() => acceptMany(poUnits)}
                    >
                      Accept all
                    </Button>
                  }
                >
                  <Table
                    rowKey="serial"
                    dataSource={poUnits}
                    pagination={false}
                    size="middle"
                    scroll={{ x: "max-content" }}
                    columns={editorColumns(false)}
                  />
                </Card>
              ))}
            </Flex>
          ),
        };
      })}
    />
  );

  const tableView = (
    <Card>
      <ProTable
        rowKey="serial"
        dataSource={qcUnits}
        searchPlaceholder="Search serial, product or supplier"
        selectable
        // Editing cells and cards do not mix: every column here is an input, and
        // DataTable's card mode stacks them into a form with no alignment. This
        // is the one list in the app that keeps its grid on a phone.
        cards={false}
        bulkActions={(rows, clear) => (
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => {
              acceptMany(rows);
              clear();
            }}
          >
            Accept {rows.length}
          </Button>
        )}
        columns={editorColumns(true)}
      />
    </Card>
  );

  const pending = (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={16}>
        <Typography.Text type="secondary">
          {qcUnits.length} unit(s) waiting for a decision.
        </Typography.Text>
        <Segmented
          value={view}
          onChange={(v) => setView(v as "STORE" | "TABLE")}
          options={[
            { value: "STORE", label: "By store", icon: <AppstoreOutlined /> },
            { value: "TABLE", label: "Table", icon: <TableOutlined /> },
          ]}
        />
      </Flex>
      {qcUnits.length === 0 ? (
        <Card>
          <Empty description="Nothing waiting for QC. New PO lines land here." />
        </Card>
      ) : view === "STORE" ? (
        storeView
      ) : (
        tableView
      )}
    </Flex>
  );

  // The most recent decision, so it can wear the "just added" dot. Computed
  // from the data rather than from a flag, so it is right after a reload too.
  const newestId = db.stockIns.reduce<{ id: string; at: string } | null>(
    (best, r) => (!best || r.at > best.at ? { id: r.id, at: r.at } : best),
    null,
  )?.id;

  const history = (
    <Card>
      <ProTable
        rowKey="id"
        dataSource={[...db.stockIns].sort((a, b) => b.at.localeCompare(a.at))}
        searchPlaceholder="Search by serial number or variant name"
        columns={[
          {
            title: "Serial",
            key: "serial",
            searchable: true,
            sortValue: (r) => r.serial,
            render: (_, r) => (
              <Flex align="center" gap={8}>
                {/* A dot on the newest row, not a "NEW" tag on everything from
                    the last hour: the question it answers is "which one did I
                    just do", and that has exactly one answer. */}
                <Badge
                  dot={r.id === newestId}
                  color="blue"
                  title={r.id === newestId ? "Most recently added" : undefined}
                >
                  <span style={{ display: "inline-block", width: 2 }} />
                </Badge>
                <span>{r.serial}</span>
              </Flex>
            ),
          },
          {
            title: "Variant",
            key: "variant",
            searchable: true,
            facet: true,
            sortValue: (r) => {
              const k = skuOf(r.skuId);
              return k ? `${k.name} ${k.variantLabel}` : "—";
            },
            render: (_, r) => {
              const k = skuOf(r.skuId);
              return k ? (
                <>
                  {k.name}
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block" }}
                  >
                    {k.variantLabel}
                  </Typography.Text>
                </>
              ) : (
                "—"
              );
            },
          },
          {
            title: "Store",
            key: "store",
            facet: true,
            sortValue: (r) => warehouseOf(r.locationId),
            render: (_, r) => warehouseOf(r.locationId),
          },
          {
            title: "Location",
            key: "rack",
            sortValue: (r) => db.racks.find((x) => x.id === r.rackId)?.name,
            render: (_, r) =>
              db.racks.find((x) => x.id === r.rackId)?.name ?? "—",
          },
          {
            title: "Supplier",
            key: "supplier",
            facet: true,
            searchable: true,
            sortValue: (r) => supplierOf(r.poId),
            render: (_, r) => supplierOf(r.poId),
          },
          {
            title: "Status",
            key: "status",
            facet: true,
            sortValue: (r) =>
              r.decision === "ACCEPTED"
                ? "Accepted"
                : r.rejectKind === "SERVICE"
                  ? "Rejected — service"
                  : "Rejected — supplier",
            render: (_, r) =>
              r.decision === "ACCEPTED" ? (
                <Tag color="green">Accepted</Tag>
              ) : (
                <Tag color="red">
                  Rejected —{" "}
                  {r.rejectKind === "SERVICE" ? "service" : "supplier"}
                </Tag>
              ),
          },
          {
            title: "Decided",
            key: "at",
            sortValue: (r) => r.at,
            defaultSortOrder: "descend",
            render: (_, r) => fmtDateTime(r.at),
          },
          {
            title: "Bought",
            key: "buy",
            align: "right",
            sortValue: (r) => r.buy,
            render: (_, r) => fmtRp(r.buy),
          },
          {
            title: "Priced",
            key: "price",
            align: "right",
            sortValue: (r) => r.price ?? 0,
            render: (_, r) => (r.price ? fmtRp(r.price) : "—"),
          },
          {
            title: "By",
            dataIndex: "staff",
            facet: true,
          },
        ]}
      />
    </Card>
  );

  return (
    <PageContainer title="Stock In (QC)">
      <Tabs
        items={[
          { key: "new", label: "New Stock In", children: pending },
          { key: "history", label: "Stock In History", children: history },
        ]}
      />
    </PageContainer>
  );
}
