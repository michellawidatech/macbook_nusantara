/**
 * Phase 7 — stock opname per warehouse, tracked on serial: counted vs system,
 * with missing and unknown lists. Posting writes OPNAME events.
 *
 * Every discrepancy carries a written explanation before the count can be
 * posted. A missing unit with no note is a number that will mean nothing in a
 * month — "we were 3 short in August" is not a finding, "3 short, two on loan
 * to the service bench and one never arrived from Batam" is.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Select,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { ProTable } from "../../components/ProTable";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import { useDb, mutate, nextId, appendEvent } from "../../mock/store.js";

const IN_STOCK = ["TERSEDIA", "DIRESERVASI", "QC", "SERVIS"];

/** One row of the discrepancy editor. */
interface Discrepancy {
  serial: string;
  kind: "MISSING" | "UNKNOWN";
}

export function StockOpnamePage() {
  const db = useDb();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [locationId, setLocationId] = useState(db.myWarehouseId);
  const [scanned, setScanned] = useState<string[]>([]);
  const [scan, setScan] = useState("");
  /** serial → what the counter wrote about it. Cleared with the count. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const expected = db.units.filter(
    (u) => u.locationId === locationId && IN_STOCK.includes(u.status),
  );
  const expectedSerials = new Set(expected.map((u) => u.serial));
  const counted = scanned.filter((s) => expectedSerials.has(s));
  const unknown = scanned.filter((s) => !expectedSerials.has(s));
  const missing = expected
    .filter((u) => !scanned.includes(u.serial))
    .map((u) => u.serial);

  const discrepancies: Discrepancy[] = [
    ...missing.map((serial) => ({ serial, kind: "MISSING" as const })),
    ...unknown.map((serial) => ({ serial, kind: "UNKNOWN" as const })),
  ];
  const unexplained = discrepancies.filter(
    (d) => !(notes[d.serial] ?? "").trim(),
  );

  const addScan = () => {
    const s = scan.trim();
    if (!s) return;
    if (scanned.includes(s)) message.warning(`${s} already counted.`);
    else setScanned([...scanned, s]);
    setScan("");
  };

  const post = () => {
    if (unexplained.length > 0) {
      return void modal.warning({
        title: `${unexplained.length} unit(s) still need a description`,
        content:
          "Every missing and unknown unit needs a line saying what happened to it before the count can be posted.",
      });
    }
    modal.confirm({
      title: "Post this opname?",
      content: `${counted.length} counted · ${missing.length} missing · ${unknown.length} unknown. Missing units are marked lost.`,
      onOk: () => {
        mutate((d) => {
          d.opnames.unshift({
            id: nextId("op"),
            locationId,
            at: new Date().toISOString(),
            counted,
            missing,
            unknown,
            notes: { ...notes },
            status: "POSTED",
          });
          for (const s of missing) {
            appendEvent(d, s, {
              type: "OPNAME_HILANG",
              toStatus: "HILANG",
              note: `Not found at opname — ${notes[s]}`,
            });
          }
          for (const s of counted) {
            appendEvent(d, s, { type: "DICATAT", note: "Counted at opname" });
          }
          // An unknown serial may not be a unit this system knows at all;
          // appendEvent is a no-op in that case, which is the honest outcome.
          for (const s of unknown) {
            appendEvent(d, s, {
              type: "DICATAT",
              note: `Found at opname — ${notes[s]}`,
            });
          }
        });
        setScanned([]);
        setNotes({});
        message.success("Opname posted.");
      },
    });
  };

  const skuOf = (serial: string) => {
    const u = db.units.find((x) => x.serial === serial);
    const k = u && db.skus.find((s) => s.id === u.skuId);
    return k ? `${k.name} ${k.variantLabel}` : "—";
  };

  const count = (
    <Flex vertical gap={16}>
      <Card>
        <Flex gap={compact ? 16 : 24} align="center" wrap>
          <Select
            // Full width on a phone so the warehouse being counted is not a
            // 220px control floating in a wrapped row of four statistics.
            style={{ width: compact ? "100%" : 220 }}
            value={locationId}
            options={db.warehouses
              .filter((w) => w.active)
              .map((w) => ({ value: w.id, label: w.name }))}
            onChange={(v) => {
              setLocationId(v);
              setScanned([]);
              setNotes({});
            }}
          />
          <Statistic title="In system" value={expected.length} />
          <Statistic title="Counted" value={counted.length} />
          <Statistic
            title="Missing"
            value={missing.length}
            styles={
              missing.length ? { content: { color: "#cf1322" } } : undefined
            }
          />
          <Statistic
            title="Unknown"
            value={unknown.length}
            styles={
              unknown.length ? { content: { color: "#d48806" } } : undefined
            }
          />
          {/* On a phone this same action is the bottom-right float button —
              a thumb reaches it without scrolling back up past the scan box,
              which is where the counter's attention actually is. Rendering
              both would be the button twice. */}
          {!compact && (
            <Button
              type="primary"
              disabled={scanned.length === 0}
              onClick={post}
            >
              Post opname
            </Button>
          )}
        </Flex>
      </Card>
      <Card title="Scan serials">
        <Input.Search
          autoFocus
          placeholder="Scan or type a serial, then Enter — keep scanning, no dialogs in between"
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onSearch={addScan}
          enterButton="Count"
          style={{ maxWidth: 560 }}
        />
        <DataTable
          style={{ marginTop: 16 }}
          rowKey={(s: { serial: string }) => s.serial}
          size="small"
          dataSource={[...scanned].reverse().map((serial) => ({ serial }))}
          // A long count is hundreds of scans. The newest is on top, so the
          // first page is the one the counter is watching.
          pageSize={15}
          columns={[
            { title: "Serial", dataIndex: "serial" },
            { title: "Product", key: "p", render: (_, r) => skuOf(r.serial) },
            {
              title: "Check",
              key: "c",
              render: (_, r) =>
                expectedSerials.has(r.serial) ? (
                  <Tag color="green">matched</Tag>
                ) : (
                  <Tag color="orange">unknown here</Tag>
                ),
            },
          ]}
        />
      </Card>

      {/* The discrepancy editor. It only appears once counting has started —
          before the first scan, every unit in the warehouse is "missing", and
          asking for 200 explanations up front is not a question anyone can
          answer. */}
      {scanned.length > 0 && (
        <Card
          title={
            <Flex gap={8} align="center" wrap>
              <span>Explain the differences</span>
              {unexplained.length > 0 ? (
                <Tag color="orange">
                  {unexplained.length} still need a description
                </Tag>
              ) : (
                <Tag color="green">all explained</Tag>
              )}
            </Flex>
          }
        >
          {discrepancies.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Everything counted matches the system."
            />
          ) : (
            <Table
              rowKey="serial"
              size="small"
              pagination={false}
              dataSource={discrepancies}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "Serial", dataIndex: "serial", width: 180 },
                {
                  title: "Product",
                  key: "p",
                  width: 220,
                  render: (_, d) => skuOf(d.serial),
                },
                {
                  title: "What happened",
                  key: "kind",
                  width: 150,
                  render: (_, d) =>
                    d.kind === "MISSING" ? (
                      <Tag color="red">Missing</Tag>
                    ) : (
                      <Tag color="orange">Unknown here</Tag>
                    ),
                },
                {
                  title: (
                    <>
                      Description{" "}
                      <Typography.Text type="danger">*</Typography.Text>
                    </>
                  ),
                  key: "note",
                  render: (_, d) => (
                    <Input
                      value={notes[d.serial] ?? ""}
                      status={
                        (notes[d.serial] ?? "").trim() ? undefined : "warning"
                      }
                      placeholder={
                        d.kind === "MISSING"
                          ? "Where did it go? e.g. lent to the service bench"
                          : "Why is it here? e.g. arrived from Warehouse 2, not yet transferred"
                      }
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [d.serial]: e.target.value }))
                      }
                    />
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}
    </Flex>
  );

  const history = (
    <Card>
      <ProTable
        rowKey="id"
        dataSource={db.opnames}
        searchPlaceholder="Search a serial mentioned in a count"
        columns={[
          {
            title: "When",
            dataIndex: "at",
            defaultSortOrder: "descend",
            render: fmtDateTime,
          },
          {
            title: "Warehouse",
            key: "wh",
            facet: true,
            sortValue: (o) =>
              db.warehouses.find((w) => w.id === o.locationId)?.name,
            render: (_, o) =>
              db.warehouses.find((w) => w.id === o.locationId)?.name,
          },
          {
            title: "Counted",
            key: "counted",
            sortValue: (o) => o.counted.length,
            render: (_, o) => o.counted.length,
          },
          {
            title: "Missing",
            key: "missing",
            sortValue: (o) => o.missing.length,
            searchValue: (o) => o.missing.join(" "),
            render: (_, o) =>
              o.missing.length ? (
                <Flex vertical gap={2}>
                  {o.missing.map((s) => (
                    <span key={s}>
                      <Tag color="red">{s}</Tag>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {o.notes?.[s] ?? "—"}
                      </Typography.Text>
                    </span>
                  ))}
                </Flex>
              ) : (
                <Tag color="green">0</Tag>
              ),
          },
          {
            title: "Unknown",
            key: "unknown",
            sortValue: (o) => o.unknown.length,
            searchValue: (o) => o.unknown.join(" "),
            render: (_, o) =>
              o.unknown.length ? (
                <Flex vertical gap={2}>
                  {o.unknown.map((s) => (
                    <span key={s}>
                      <Tag color="orange">{s}</Tag>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {o.notes?.[s] ?? "—"}
                      </Typography.Text>
                    </span>
                  ))}
                </Flex>
              ) : (
                "0"
              ),
          },
          {
            title: "Status",
            dataIndex: "status",
            facet: true,
            render: (v) => <Tag>{v}</Tag>,
          },
        ]}
      />
    </Card>
  );

  return (
    <PageContainer
      title="Stock Opname"
      // Compact only: the desktop layout keeps this button in the counting
      // card, beside the numbers it acts on. PageContainer renders `actions`
      // in the header on a wide viewport, so passing it unconditionally would
      // show it twice there.
      actions={
        compact
          ? [
              {
                key: "post",
                label: "Post opname",
                icon: <CheckOutlined />,
                type: "primary",
                disabled: scanned.length === 0,
                onClick: post,
              },
            ]
          : undefined
      }
    >
      <Tabs
        items={[
          { key: "count", label: "Count", children: count },
          { key: "history", label: "History", children: history },
        ]}
      />
    </PageContainer>
  );
}
