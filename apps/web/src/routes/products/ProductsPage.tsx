/**
 * Master catalogue — models and their variant axes. Models come from AppleDB
 * (a real fetch, see lib/appledb.ts) or are typed in by hand; variants are
 * generated from the axes (RAM, SSD, Touchpad…) or added one at a time.
 */
import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp } from "../../lib/format.js";
import { fetchMacModels, type ImportCandidate } from "../../lib/appledb.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { CatalogModel } from "../../mock/seed.js";

function combos(axes: { name: string; values: string[] }[]): string[] {
  return axes.reduce<string[]>(
    (acc, a) =>
      acc.flatMap((p) => a.values.map((v) => (p ? `${p} / ${v}` : v))),
    [""],
  );
}

const SPEC_SOURCE_TAG: Record<
  ImportCandidate["specSource"],
  { color: string; text: string }
> = {
  appledb: { color: "green", text: "AppleDB specs" },
  curated: { color: "blue", text: "Specs filled in" },
  generic: { color: "orange", text: "Specs guessed" },
};

export function ProductsPage() {
  const db = useDb();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [editing, setEditing] = useState<CatalogModel | null>(null);
  const [newAxis, setNewAxis] = useState("");
  const [newValue, setNewValue] = useState<Record<string, string>>({});

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm<{
    name: string;
    category: string;
    releaseYear: number;
    ram: string[];
    ssd: string[];
    price: number;
  }>();

  const [variantOpen, setVariantOpen] = useState(false);
  const [variantForm] = Form.useForm<{ variantLabel: string; price: number }>();

  const model = editing && db.models.find((m) => m.id === editing.id);

  const generate = (mode: "APPEND" | "REPLACE") => {
    const m = model!;
    const wanted = combos(m.axes);
    const existing = db.skus.filter((s) => s.modelId === m.id);
    const inStock = new Set(db.units.map((u) => u.skuId));
    modal.confirm({
      title:
        mode === "APPEND" ? `Add missing variants?` : `Replace all variants?`,
      content:
        mode === "APPEND"
          ? `${wanted.filter((w) => !existing.some((s) => s.variantLabel === w)).length} new SKU(s) will be created. Nothing is created silently.`
          : `Variants with stock are kept; the rest are replaced by ${wanted.length} combination(s).`,
      onOk: () => {
        mutate((d) => {
          const base = Math.min(...existing.map((s) => s.price), 10_000_000);
          if (mode === "REPLACE") {
            d.skus = d.skus.filter(
              (s) => s.modelId !== m.id || inStock.has(s.id),
            );
          }
          for (const w of wanted) {
            if (d.skus.some((s) => s.modelId === m.id && s.variantLabel === w))
              continue;
            d.skus.push({
              id: nextId("sku"),
              modelId: m.id,
              code: nextId("SKU").toUpperCase(),
              name: m.name,
              variantLabel: w,
              price: base,
            });
          }
        });
        message.success(
          mode === "APPEND" ? "Missing variants added." : "Variants replaced.",
        );
      },
    });
  };

  /** Open the import drawer and pull the live catalogue. */
  const openImport = async () => {
    setImportOpen(true);
    if (candidates.length > 0) return;
    setImporting(true);
    setImportError(null);
    try {
      setCandidates(await fetchMacModels());
    } catch (err) {
      // The real reason, not "something went wrong": offline, blocked by a
      // corporate proxy and a 500 from the CDN need three different responses.
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  /**
   * Import the picked AppleDB models, skipping any already imported (matched on
   * AppleDB's identifier, which is stable across renames). Variants are
   * generated at price 0 — AppleDB has no prices, and a made-up one would be
   * indistinguishable from a real one once it is in the table.
   */
  const runImport = (picked: ImportCandidate[]) => {
    let added = 0;
    let skus = 0;
    let skipped = 0;
    mutate((d) => {
      for (const c of picked) {
        if (d.models.some((m) => m.identifier === c.identifier)) {
          skipped += 1;
          continue;
        }
        const id = nextId("m");
        d.models.push({
          id,
          name: c.name,
          category: c.category,
          releaseYear: c.releaseYear,
          identifier: c.identifier,
          source: "APPLEDB",
          axes: [
            { name: "RAM", values: c.ram },
            { name: "SSD", values: c.ssd },
          ],
        });
        added += 1;
        for (const label of combos([
          { name: "RAM", values: c.ram },
          { name: "SSD", values: c.ssd },
        ])) {
          d.skus.push({
            id: nextId("sku"),
            modelId: id,
            code: nextId("SKU").toUpperCase(),
            name: c.name,
            variantLabel: label,
            price: 0,
          });
          skus += 1;
        }
      }
    });
    setImportOpen(false);
    if (added === 0) {
      message.info(
        "Nothing new — every model picked is already in the catalogue.",
      );
      return;
    }
    message.success(
      `Imported ${added} model(s) and ${skus} variant(s) from AppleDB${
        skipped ? `, skipping ${skipped} already in the catalogue` : ""
      }. Prices start at Rp 0 — set them before selling.`,
    );
  };

  const submitAdd = () =>
    addForm.validateFields().then((v) => {
      const id = nextId("m");
      let count = 0;
      mutate((d) => {
        d.models.push({
          id,
          name: v.name,
          category: v.category,
          releaseYear: v.releaseYear,
          source: "MANUAL",
          axes: [
            { name: "RAM", values: v.ram },
            { name: "SSD", values: v.ssd },
          ],
        });
        for (const label of combos([
          { name: "RAM", values: v.ram },
          { name: "SSD", values: v.ssd },
        ])) {
          d.skus.push({
            id: nextId("sku"),
            modelId: id,
            code: nextId("SKU").toUpperCase(),
            name: v.name,
            variantLabel: label,
            price: v.price ?? 0,
          });
          count += 1;
        }
      });
      setAddOpen(false);
      addForm.resetFields();
      message.success(`${v.name} added with ${count} variant(s).`);
    });

  const submitVariant = () =>
    variantForm.validateFields().then((v) => {
      const m = model!;
      if (
        db.skus.some(
          (s) => s.modelId === m.id && s.variantLabel === v.variantLabel.trim(),
        )
      ) {
        return void message.warning(
          "That variant already exists on this model.",
        );
      }
      mutate((d) => {
        d.skus.push({
          id: nextId("sku"),
          modelId: m.id,
          code: nextId("SKU").toUpperCase(),
          name: m.name,
          variantLabel: v.variantLabel.trim(),
          price: v.price ?? 0,
        });
      });
      setVariantOpen(false);
      variantForm.resetFields();
      message.success("Variant added.");
    });

  return (
    <PageContainer
      title="Products"
      actions={[
        {
          key: "add",
          label: "Add product",
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAddOpen(true),
        },
        {
          key: "import",
          label: "Import from AppleDB",
          icon: <CloudDownloadOutlined />,
          onClick: openImport,
        },
      ]}
    >
      <Card>
        {/* Keeps its grid on a phone rather than becoming cards: the row's
            variants live in an expanded row, and a card has nothing to expand
            into. See DataTable's docblock. */}
        <ProTable
          rowKey="id"
          dataSource={db.models}
          searchPlaceholder="Search model, category or Apple identifier"
          expandable={{
            expandedRowRender: (m) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={db.skus.filter((s) => s.modelId === m.id)}
                columns={[
                  { title: "SKU", dataIndex: "code" },
                  { title: "Variant", dataIndex: "variantLabel" },
                  {
                    title: "List price",
                    align: "right",
                    render: (_, s) =>
                      s.price > 0 ? (
                        fmtRp(s.price)
                      ) : (
                        <Tooltip title="Imported from AppleDB, which carries no prices">
                          <Tag color="orange">not priced</Tag>
                        </Tooltip>
                      ),
                  },
                  {
                    title: "In stock",
                    render: (_, s) =>
                      db.units.filter(
                        (u) =>
                          u.skuId === s.id &&
                          ["TERSEDIA", "DIRESERVASI"].includes(u.status),
                      ).length,
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: "Model", dataIndex: "name", searchable: true },
            {
              title: "Category",
              dataIndex: "category",
              facet: true,
              searchable: true,
              render: (v) => <Tag>{v}</Tag>,
            },
            {
              title: "Release year",
              dataIndex: "releaseYear",
              defaultSortOrder: "descend",
            },
            {
              title: "Apple ID",
              dataIndex: "identifier",
              searchable: true,
              render: (v) => v ?? "—",
            },
            {
              title: "Source",
              key: "source",
              facet: true,
              sortValue: (m) => (m.source === "APPLEDB" ? "AppleDB" : "Manual"),
              render: (_, m) =>
                m.source === "APPLEDB" ? (
                  <Tag color="blue">AppleDB</Tag>
                ) : (
                  <Tag>Manual</Tag>
                ),
            },
            {
              title: "Variant axes",
              key: "axes",
              sortValue: (m) => m.axes.length,
              render: (_, m) =>
                m.axes.map((a) => `${a.name} (${a.values.length})`).join(" · "),
            },
            {
              title: "Variants",
              key: "variants",
              sortValue: (m) =>
                db.skus.filter((s) => s.modelId === m.id).length,
              render: (_, m) =>
                db.skus.filter((s) => s.modelId === m.id).length,
            },
            {
              title: "",
              key: "actions",
              width: 60,
              render: (_, m) => (
                <Tooltip title="Variants and axes">
                  <Button
                    aria-label={`Variants for ${m.name}`}
                    icon={<SettingOutlined />}
                    size="small"
                    onClick={() => setEditing(m)}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Import from AppleDB"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={compact ? "100%" : 980}
      >
        {importError ? (
          <Alert
            type="error"
            showIcon
            title="Could not reach AppleDB"
            description={
              <>
                <div>{importError}</div>
                <Typography.Text type="secondary">
                  api.appledb.dev is fetched straight from the browser, so a
                  blocked network or an offline machine is the usual cause.
                </Typography.Text>
              </>
            }
            action={
              <Button
                size="small"
                onClick={() => {
                  setCandidates([]);
                  void openImport();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              Live from api.appledb.dev. Pick the models you sell — each one
              arrives with its RAM and SSD options as variant axes. AppleDB
              carries no prices, so imported variants start at Rp 0.
            </Typography.Paragraph>
            <ProTable
              rowKey="key"
              loading={importing}
              dataSource={candidates}
              searchPlaceholder="Search model name, chip or Apple identifier"
              selectable
              cards={false}
              pageSize={20}
              bulkActions={(rows, clearSelection) => (
                <Button
                  type="primary"
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  onClick={() => {
                    runImport(rows);
                    clearSelection();
                  }}
                >
                  Import {rows.length}
                </Button>
              )}
              columns={[
                { title: "Model", dataIndex: "name", searchable: true },
                { title: "Category", dataIndex: "category", facet: true },
                {
                  title: "Year",
                  dataIndex: "releaseYear",
                  defaultSortOrder: "descend",
                },
                {
                  title: "Chip",
                  dataIndex: "chip",
                  facet: true,
                  render: (v) => v ?? "—",
                },
                {
                  title: "Apple ID",
                  dataIndex: "identifier",
                  searchable: true,
                },
                {
                  title: "RAM",
                  key: "ram",
                  sortValue: (c) => c.ram.join(", "),
                  render: (_, c) => c.ram.join(", "),
                },
                {
                  title: "SSD",
                  key: "ssd",
                  sortValue: (c) => c.ssd.join(", "),
                  render: (_, c) => c.ssd.join(", "),
                },
                {
                  title: "Specs",
                  key: "specSource",
                  facet: true,
                  sortValue: (c) => SPEC_SOURCE_TAG[c.specSource].text,
                  render: (_, c) => {
                    const tag = SPEC_SOURCE_TAG[c.specSource];
                    return (
                      <Tooltip
                        title={
                          c.specSource === "appledb"
                            ? "RAM and SSD options came from AppleDB"
                            : c.specSource === "curated"
                              ? "AppleDB has no specs for this model; these are Apple's published build-to-order options"
                              : "AppleDB has no specs for this model and it is not in our table — check the axes after importing"
                        }
                      >
                        <Tag color={tag.color}>{tag.text}</Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: "",
                  key: "in",
                  width: 90,
                  render: (_, c) =>
                    db.models.some((m) => m.identifier === c.identifier) ? (
                      <Tag color="green">imported</Tag>
                    ) : null,
                },
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title="Add product"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        okText="Create product and variants"
      >
        <Form
          form={addForm}
          layout="vertical"
          initialValues={{
            releaseYear: new Date().getFullYear(),
            ram: ["8GB", "16GB"],
            ssd: ["256GB", "512GB"],
          }}
        >
          <Form.Item
            name="name"
            label="Model name"
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. MacBook Air M4" />
          </Form.Item>
          <Form.Item
            name="category"
            label="Category"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              placeholder="MacBook Air"
              options={[
                ...new Set([
                  ...db.models.map((m) => m.category),
                  "MacBook",
                  "MacBook Air",
                  "MacBook Pro",
                  "iMac",
                  "Mac mini",
                ]),
              ].map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          <Form.Item
            name="releaseYear"
            label="Release year"
            rules={[{ required: true }]}
          >
            <InputNumber min={2006} max={2100} style={{ width: 160 }} />
          </Form.Item>
          {/* Free-typed tags rather than a fixed list: an axis value is whatever
              the model actually shipped with, and that changes every year. */}
          <Form.Item
            name="ram"
            label="RAM options"
            rules={[{ required: true, message: "At least one" }]}
          >
            <Select
              mode="tags"
              placeholder="8GB, 16GB…"
              open={false}
              suffixIcon={null}
            />
          </Form.Item>
          <Form.Item
            name="ssd"
            label="SSD options"
            rules={[{ required: true, message: "At least one" }]}
          >
            <Select
              mode="tags"
              placeholder="256GB, 512GB…"
              open={false}
              suffixIcon={null}
            />
          </Form.Item>
          <Form.Item
            name="price"
            label="Starting list price"
            tooltip="Applied to every generated variant; adjust each one afterwards"
          >
            <MoneyInput />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={model ? `${model.name} — variants` : ""}
        open={editing !== null}
        size={compact ? "large" : "default"}
        onClose={() => setEditing(null)}
        extra={
          model && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                variantForm.resetFields();
                setVariantOpen(true);
              }}
            >
              Add variant
            </Button>
          )
        }
      >
        {model && (
          <Flex vertical gap={16}>
            {model.axes.map((a) => (
              <Card key={a.name} size="small" title={a.name}>
                <Flex gap={6} wrap align="center">
                  {a.values.map((v) => (
                    <Tag
                      key={v}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        mutate((d) => {
                          const ax = d.models
                            .find((m) => m.id === model.id)!
                            .axes.find((x) => x.name === a.name)!;
                          ax.values = ax.values.filter((x) => x !== v);
                        });
                      }}
                    >
                      {v}
                    </Tag>
                  ))}
                  <Input
                    size="small"
                    style={{ width: 120 }}
                    placeholder="Add a value"
                    value={newValue[a.name] ?? ""}
                    onChange={(e) =>
                      setNewValue({ ...newValue, [a.name]: e.target.value })
                    }
                    onPressEnter={() => {
                      const v = (newValue[a.name] ?? "").trim();
                      if (!v) return;
                      mutate((d) => {
                        const ax = d.models
                          .find((m) => m.id === model.id)!
                          .axes.find((x) => x.name === a.name)!;
                        if (!ax.values.includes(v)) ax.values.push(v);
                      });
                      setNewValue({ ...newValue, [a.name]: "" });
                    }}
                  />
                </Flex>
              </Card>
            ))}
            <Flex gap={8}>
              <Input
                placeholder="New axis, e.g. Touchpad"
                value={newAxis}
                onChange={(e) => setNewAxis(e.target.value)}
                style={{ width: 220 }}
              />
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  const n = newAxis.trim();
                  if (!n) return;
                  mutate((d) => {
                    const m = d.models.find((x) => x.id === model.id)!;
                    if (!m.axes.some((a) => a.name === n))
                      m.axes.push({ name: n, values: [] });
                  });
                  setNewAxis("");
                }}
              >
                Add axis
              </Button>
            </Flex>
            <Typography.Text type="secondary">
              {combos(model.axes).length} combination(s) from the current axes.
            </Typography.Text>
            <Flex gap={8}>
              <Button type="primary" onClick={() => generate("APPEND")}>
                Append missing variants
              </Button>
              <Button danger onClick={() => generate("REPLACE")}>
                Replace all
              </Button>
            </Flex>

            <Card size="small" title="Variants on this model">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={db.skus.filter((s) => s.modelId === model.id)}
                columns={[
                  { title: "Variant", dataIndex: "variantLabel" },
                  {
                    title: "Price",
                    align: "right",
                    render: (_, s) =>
                      s.price > 0 ? (
                        fmtRp(s.price)
                      ) : (
                        <Tag color="orange">not priced</Tag>
                      ),
                  },
                  {
                    title: "",
                    width: 46,
                    render: (_, s) => {
                      const held = db.units.some((u) => u.skuId === s.id);
                      return (
                        <Tooltip
                          title={
                            held
                              ? "Units exist on this variant — it cannot be removed"
                              : "Remove variant"
                          }
                        >
                          <Button
                            type="text"
                            danger
                            size="small"
                            disabled={held}
                            aria-label={`Remove ${s.variantLabel}`}
                            icon={<DeleteOutlined />}
                            onClick={() =>
                              modal.confirm({
                                title: `Remove ${s.variantLabel}?`,
                                content:
                                  "No stock has ever been on it, so nothing is lost.",
                                okButtonProps: { danger: true },
                                onOk: () => {
                                  mutate((d) => {
                                    d.skus = d.skus.filter(
                                      (x) => x.id !== s.id,
                                    );
                                  });
                                  message.success("Variant removed.");
                                },
                              })
                            }
                          />
                        </Tooltip>
                      );
                    },
                  },
                ]}
              />
            </Card>
          </Flex>
        )}
      </Drawer>

      <Modal
        title={`Add variant to ${model?.name ?? ""}`}
        open={variantOpen}
        onCancel={() => setVariantOpen(false)}
        onOk={submitVariant}
        okText="Add variant"
      >
        <Form form={variantForm} layout="vertical">
          <Form.Item
            name="variantLabel"
            label="Variant"
            tooltip="How it is written everywhere else, e.g. 16GB / 512GB"
            rules={[{ required: true }]}
          >
            <Input placeholder="16GB / 512GB" />
          </Form.Item>
          <Form.Item name="price" label="List price">
            <MoneyInput />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
