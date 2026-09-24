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
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { EditableTable } from "../../components/EditableTable";
import { MoneyInput } from "../../components/MoneyInput";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtNone, fmtRp } from "../../lib/format.js";
import { fetchMacModels, type ImportCandidate } from "../../lib/appledb.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { CatalogModel, Sku } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";
import { parseProductName, shopProductName } from "../../lib/productCode.js";

function combos(axes: { name: string; values: string[] }[]): string[] {
  return axes.reduce<string[]>(
    (acc, a) =>
      acc.flatMap((p) => a.values.map((v) => (p ? `${p} / ${v}` : v))),
    [""],
  );
}

/**
 * One variant's SKU CODE, in the shop's own naming convention (owner ask
 * 2026-09-21: *"in the SKU and product input, actually they use the naming
 * convention in stock persediaan"*).
 *
 * `AIR 13" 2020 I5 8/256` — B2Soft's `PERSEDIAAN BARANG` spelling, which the
 * shop has read its stock off for years and which the bookkeeper's sheets
 * start from. It replaces `nextId("SKU")`, which produced `SKU_17`: a code
 * nobody could look up, match against a supplier's quotation or find in the
 * old system.
 *
 * The MODEL NAME is read for its parts rather than trusted to be in the
 * convention (`parseProductName`), because a product added by hand or brought
 * in from AppleDB is named however whoever added it named it. A name the
 * convention cannot read — an accessory, a spare part — keeps its own words
 * and simply gains the variant, which is the honest answer: `KOLI` has no
 * chip, no size and nothing to configure.
 *
 * Deliberately NOT unique on its own. Two products genuinely named the same
 * thing are the same thing, and `Sku.code` is unique in the schema, so the
 * caller appends a discriminator when the shop really does hold two.
 */
function skuCodeFor(
  modelName: string,
  year: number | string | undefined,
  variantLabel: string,
): string {
  const parsed = parseProductName(modelName);
  // "8GB / 256GB" as the axes joined it. RAM first, storage second, which is
  // the order `combos` builds and the order the convention prints.
  const [ram, ssd] = variantLabel.split("/").map((v) => v.trim());
  const name = shopProductName({
    line: parsed.line,
    ...(parsed.sizeInch === undefined ? {} : { sizeInch: parsed.sizeInch }),
    year: parsed.year ?? (year === undefined ? null : String(year)),
    ...(parsed.chip === undefined ? {} : { chip: parsed.chip }),
    ...(ram ? { ram } : {}),
    ...(ssd ? { ssd } : {}),
    ...(parsed.extra === undefined ? {} : { extra: parsed.extra }),
  });
  return name === "" ? modelName.trim().toUpperCase() : name;
}

/** A code nothing else in the catalogue is using. See `skuCodeFor`. */
function freeSkuCode(taken: ReadonlySet<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const tried = `${wanted} (${n})`;
    if (!taken.has(tried)) return tried;
  }
  return `${wanted} ${Date.now()}`;
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
  const { t } = useTranslation();
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
  /**
   * Show the hidden models instead of the visible ones.
   *
   * A switch between two views rather than a "include hidden" that mixes them,
   * because the two are read for different reasons: the normal list is "what
   * could we add?", and this one is "did we skip something we should not
   * have?". Mixing them puts the second question's rows in the way of the
   * first, which is the thing hiding was asked for.
   */
  const [showHidden, setShowHidden] = useState(false);

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
  // Watched so the code preview under the name field follows what is typed.
  const addName = Form.useWatch("name", addForm);
  const addYear = Form.useWatch("releaseYear", addForm);

  const model = editing && db.models.find((m) => m.id === editing.id);

  /**
   * AppleDB models the shop has hidden (owner revision 2026-08-28).
   *
   * It was a "not selling" MARK, which dimmed the row and left it in the
   * table. Hiding takes it out. AppleDB's feed is thousands of models and this
   * shop sells a few dozen, so a list where every rejected model is still
   * there — merely greyer — is still a list nobody can read; the point of
   * saying "not this one" is that you stop being shown it.
   *
   * Nothing is lost. `showHidden` puts them all back on screen, where each one
   * can be unhidden from the same button that hid it. Keyed on AppleDB's
   * stable `key`, so it survives a re-fetch AND a rename — which is what makes
   * next year's feed readable: the deliberate skips are already out of the
   * way, and what is left is what is genuinely new.
   */
  const hidden = new Set(db.appleDbHidden);
  const toggleHidden = (c: ImportCandidate) => {
    const wasHidden = hidden.has(c.key);
    mutate((d) => {
      d.appleDbHidden = wasHidden
        ? d.appleDbHidden.filter((k) => k !== c.key)
        : [...d.appleDbHidden, c.key];
    });
    message.success(
      wasHidden
        ? t("products.unhiddenToast", "{{name}} is back on the list.", {
            name: c.name,
          })
        : t("products.hiddenToast", "{{name}} hidden.", { name: c.name }),
    );
  };

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
        const taken = new Set(d.skus.map((x) => x.code));
        for (const label of combos([
          { name: "RAM", values: v.ram },
          { name: "SSD", values: v.ssd },
        ])) {
          const code = freeSkuCode(
            taken,
            skuCodeFor(v.name, v.releaseYear, label),
          );
          taken.add(code);
          d.skus.push({
            id: nextId("sku"),
            modelId: id,
            code,
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
          code: freeSkuCode(
            new Set(d.skus.map((x) => x.code)),
            skuCodeFor(m.name, m.releaseYear, v.variantLabel.trim()),
          ),
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
      title={t("products.masterProduct", "Master Product")}
      actions={[
        {
          key: "add",
          label: t("products.addProduct", "Add product"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAddOpen(true),
        },
        {
          key: "import",
          label: t("products.importFromAppledb", "Import from AppleDB"),
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
          persistKey="products"
          rowKey="id"
          dataSource={db.models}
          searchPlaceholder={t(
            "products.searchModelCategoryOrApple",
            "Search model, category or Apple identifier",
          )}
          expandable={{
            expandedRowRender: (m) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={db.skus.filter((s) => s.modelId === m.id)}
                columns={[
                  { title: "SKU", dataIndex: "code" },
                  {
                    title: t("products.variant", "Variant"),
                    dataIndex: "variantLabel",
                  },
                  {
                    title: t("products.listPrice", "List price"),
                    align: "right",
                    render: (_, s) =>
                      s.price > 0 ? (
                        fmtRp(s.price)
                      ) : (
                        <Tooltip
                          title={t(
                            "products.importedFromAppledbWhichCarries",
                            "Imported from AppleDB, which carries no prices",
                          )}
                        >
                          <Tag color="orange">not priced</Tag>
                        </Tooltip>
                      ),
                  },
                  {
                    title: t("products.inStock", "In stock"),
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
            {
              title: t("products.model", "Model"),
              dataIndex: "name",
              searchable: true,
            },
            {
              title: t("products.category", "Category"),
              dataIndex: "category",
              facet: true,
              searchable: true,
              render: (v) => <Tag>{v}</Tag>,
            },
            {
              title: t("products.releaseYear", "Release year"),
              dataIndex: "releaseYear",
              defaultSortOrder: "descend",
            },
            {
              title: t("products.appleId", "Apple ID"),
              dataIndex: "identifier",
              searchable: true,
              render: (v) => v ?? fmtNone(),
            },
            {
              title: t("products.source", "Source"),
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
              title: t("products.variants", "Variants"),
              key: "axes",
              sortValue: (m) => m.axes.length,
              render: (_, m) =>
                m.axes.map((a) => `${a.name} (${a.values.length})`).join(" · "),
            },
            {
              title: t("products.variants", "Variants"),
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
                <Tooltip title={t("products.variants", "Variants")}>
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
        title={t("products.importFromAppledb", "Import from AppleDB")}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        // As wide as the ten columns actually need, capped to the viewport
        // (owner ask 2026-08-27) — 980 forced the table into its own sideways
        // scroll on every laptop. The ceiling is the columns' own sum plus the
        // modal's gutters; the viewport term is what keeps it responsive.
        width={compact ? "100%" : "min(1480px, calc(100vw - 32px))"}
      >
        {importError ? (
          <Alert
            type="error"
            showIcon
            title={t(
              "products.couldNotReachAppledb",
              "Could not reach AppleDB",
            )}
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
                {t("products.tryAgain", "Try again")}
              </Button>
            }
          />
        ) : (
          <>
            <ProTable
              rowKey="key"
              loading={importing}
              // Hidden rows LEAVE the list — that is the whole of the owner's
              // 2026-08-28 revision. The switch beside the search box is the
              // way back to them.
              dataSource={candidates.filter(
                (c) => hidden.has(c.key) === showHidden,
              )}
              // A new data source is a new set of pages; without this the
              // table can be left showing page 4 of a two-page list.
              resetKey={String(showHidden)}
              searchPlaceholder={t(
                "products.searchModelNameChipOr",
                "Search model name, chip or Apple identifier",
              )}
              toolbar={
                <Flex align="center" gap={8}>
                  <Switch
                    checked={showHidden}
                    onChange={setShowHidden}
                    aria-label={t("products.showHidden", "Show hidden")}
                  />
                  <Typography.Text type="secondary">
                    {t("products.showHiddenN", "Show hidden ({{count}})", {
                      count: hidden.size,
                    })}
                  </Typography.Text>
                </Flex>
              }
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
                {
                  title: t("products.model", "Model"),
                  dataIndex: "name",
                  searchable: true,
                },
                {
                  title: t("products.category", "Category"),
                  dataIndex: "category",
                  facet: true,
                },
                {
                  title: t("products.year", "Year"),
                  dataIndex: "releaseYear",
                  defaultSortOrder: "descend",
                },
                {
                  title: t("products.chip", "Chip"),
                  dataIndex: "chip",
                  facet: true,
                  render: (v) => v ?? fmtNone(),
                },
                {
                  title: t("products.appleId", "Apple ID"),
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
                  title: t("products.specs", "Specs"),
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
                              : "AppleDB has no specs for this model and it is not in our table — check the variants after importing"
                        }
                      >
                        <Tag color={tag.color}>{tag.text}</Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  // Only "Imported" is left here. A "Hidden" tag would say
                  // what the list already says — every row in the hidden view
                  // is hidden, and none in the normal one is.
                  title: t("products.status", "Status"),
                  key: "state",
                  width: 130,
                  facet: true,
                  sortValue: (c) =>
                    db.models.some((m) => m.identifier === c.identifier)
                      ? t("products.imported", "Imported")
                      : undefined,
                  render: (_, c) =>
                    db.models.some((m) => m.identifier === c.identifier) ? (
                      <Tag color="green" style={{ marginInlineEnd: 0 }}>
                        {t("products.imported", "Imported")}
                      </Tag>
                    ) : (
                      <Typography.Text type="secondary">
                        {fmtNone()}
                      </Typography.Text>
                    ),
                },
                {
                  // Anchored to the right edge (owner ask 2026-08-27), so the
                  // control is reachable without scrolling whatever the table
                  // is scrolled to.
                  title: "",
                  key: "actions",
                  width: 120,
                  fixed: "right",
                  render: (_, c) => {
                    const off = hidden.has(c.key);
                    return (
                      <Tooltip
                        title={
                          off
                            ? t(
                                "products.unhideHint",
                                "Put it back on the import list",
                              )
                            : t(
                                "products.hideHint",
                                "Take a model this shop does not sell off the list, so the next AppleDB update reads at a glance. Nothing is deleted — the switch above brings the hidden ones back.",
                              )
                        }
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={
                            off ? <EyeOutlined /> : <EyeInvisibleOutlined />
                          }
                          aria-label={
                            off
                              ? t("products.unhideAria", "Unhide {{name}}", {
                                  name: c.name,
                                })
                              : t("products.hideAria", "Hide {{name}}", {
                                  name: c.name,
                                })
                          }
                          onClick={() => toggleHidden(c)}
                        >
                          {off
                            ? t("products.unhide", "Unhide")
                            : t("products.hide", "Hide")}
                        </Button>
                      </Tooltip>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title={t("products.addProduct", "Add product")}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        okText={t(
          "products.createProductAndVariants",
          "Create product and variants",
        )}
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
            label={t("products.modelName", "Model name")}
            rules={[{ required: true }]}
            /*
             * The shop's own convention, from B2Soft's PERSEDIAAN BARANG
             * (owner ask 2026-09-21). The placeholder is a real row from it,
             * and the line under the field shows what this product's SKU
             * codes will read as — so somebody who types a name outside the
             * convention sees it before they create eight variants under it.
             */
            extra={
              addName?.trim()
                ? t("products.codePreview", "SKU codes will read: {{code}}", {
                    code: skuCodeFor(addName, addYear, "8GB / 256GB"),
                  })
                : t(
                    "products.namingHint",
                    "The shop's convention: line, size, year or chip, processor. An Apple-silicon machine is named by its chip instead of its year.",
                  )
            }
          >
            <Input
              placeholder={t(
                "products.eGAir13",
                'e.g. AIR 13" 2020 I5, or AIR 13" M2',
              )}
            />
          </Form.Item>
          <Form.Item
            name="category"
            label={t("products.category", "Category")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              placeholder={t("products.macbookAir", "MacBook Air")}
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
            label={t("products.releaseYear", "Release year")}
            rules={[{ required: true }]}
          >
            <InputNumber min={2006} max={2100} style={{ width: 160 }} />
          </Form.Item>
          {/* Free-typed tags rather than a fixed list: an axis value is whatever
              the model actually shipped with, and that changes every year. */}
          <Form.Item
            name="ram"
            label={t("products.ramOptions", "RAM options")}
            rules={[
              { required: true, message: t("form.atLeastOne", "At least one") },
            ]}
          >
            <Select
              mode="tags"
              placeholder={t("products.8gb16gb", "8GB, 16GB…")}
              open={false}
              suffixIcon={null}
            />
          </Form.Item>
          <Form.Item
            name="ssd"
            label={t("products.ssdOptions", "SSD options")}
            rules={[
              { required: true, message: t("form.atLeastOne", "At least one") },
            ]}
          >
            <Select
              mode="tags"
              placeholder={t("products.256gb512gb", "256GB, 512GB…")}
              open={false}
              suffixIcon={null}
            />
          </Form.Item>
          <Form.Item
            name="price"
            label={t("products.startingListPrice", "Starting list price")}
            tooltip={t(
              "products.appliedToEveryGeneratedVariant",
              "Applied to every generated variant; adjust each one afterwards",
            )}
          >
            <MoneyInput />
          </Form.Item>
        </Form>
      </Modal>

      {/*
       * Configuring a product is a modal, not a side drawer (owner decision
       * 2026-08-26).
       *
       * A drawer says "keep the list in view while you work"; nothing in this
       * panel is read against the row behind it, and the panel itself is a
       * table of variants with its own scroll — two scrolling surfaces side by
       * side, one of them squeezed into a 378px column. Centred and given the
       * page's width, the variant table has room to be a table.
       */}
      <Modal
        title={model ? `${model.name} — variants` : ""}
        open={editing !== null}
        width={compact ? "calc(100vw - 24px)" : 980}
        onCancel={() => setEditing(null)}
        // Nothing here is saved on an OK: every control writes straight to the
        // store, so the only honest chrome is a way out.
        footer={null}
      >
        {model && (
          <Flex justify="flex-end" style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                variantForm.resetFields();
                setVariantOpen(true);
              }}
            >
              {t("products.addVariant", "Add variant")}
            </Button>
          </Flex>
        )}
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
                    placeholder={t("products.addAValue", "Add a value")}
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
                placeholder={t(
                  "products.newVariantEGTouch",
                  "New variant, e.g. Touch Bar",
                )}
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
                {t("products.addAxis", "Add axis")}
              </Button>
            </Flex>
            <Typography.Text type="secondary">
              {combos(model.axes).length} combination(s) from the current axes.
            </Typography.Text>
            <Flex gap={8}>
              <Button type="primary" onClick={() => generate("APPEND")}>
                {t("products.appendMissingVariants", "Append missing variants")}
              </Button>
              <Button danger onClick={() => generate("REPLACE")}>
                {t("products.replaceAll", "Replace all")}
              </Button>
            </Flex>

            <Card
              size="small"
              title={t(
                "products.variantsOnThisModel",
                "Variants on this model",
              )}
            >
              <EditableTable<Sku>
                rowKey="id"
                size="small"
                dataSource={db.skus.filter((s) => s.modelId === model.id)}
                // A price box is a cell you fill in, so this is an editor and
                // not a list: the columns hold their widths rather than being
                // divided up, and below `md` a variant becomes a card with its
                // price field at full width instead of a 60px stub.
                rowTitle={(s) => s.variantLabel}
                columns={[
                  {
                    title: t("products.variant", "Variant"),
                    dataIndex: "variantLabel",
                    width: 240,
                    responsive: ["md" as const],
                  },
                  {
                    /**
                     * Editable here, and only here, since 2026-08-27.
                     *
                     * The asking price used to be set per serial at QC and
                     * corrected per serial from Inventory. It is the variant's
                     * now, so this is where a reprice happens — and leaving
                     * this column read-only after that move would have meant
                     * an existing variant's price could never be changed at
                     * all, only set once when the variant was created.
                     *
                     * Inline rather than a dialog: it is one number, and the
                     * table beside it is the context that makes the number
                     * mean something. Committing on change matches the QC
                     * bench's money box, which is the idiom staff already know.
                     */
                    title: t("products.price", "Price"),
                    key: "price",
                    align: "right",
                    width: 190,
                    render: (_, s) => (
                      <MoneyInput
                        value={s.price > 0 ? s.price : undefined}
                        aria-label={t("products.price", "Price")}
                        placeholder={t("products.notPriced", "not priced")}
                        onChange={(v) =>
                          mutate((d) => {
                            d.skus.find((k) => k.id === s.id)!.price = v ?? 0;
                          })
                        }
                      />
                    ),
                  },
                  {
                    title: "",
                    key: "remove",
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
                                content: t(
                                  "products.noStockHasEverBeen",
                                  "No stock has ever been on it, so nothing is lost.",
                                ),
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
      </Modal>

      <Modal
        title={`Add variant to ${model?.name ?? ""}`}
        open={variantOpen}
        onCancel={() => setVariantOpen(false)}
        onOk={submitVariant}
        okText={t("products.addVariant", "Add variant")}
      >
        <Form form={variantForm} layout="vertical">
          <Form.Item
            name="variantLabel"
            label={t("products.variant", "Variant")}
            tooltip={t(
              "products.howItIsWrittenEverywhere",
              "How it is written everywhere else, e.g. 16GB / 512GB",
            )}
            rules={[{ required: true }]}
          >
            <Input placeholder={t("products.16gb512gb", "16GB / 512GB")} />
          </Form.Item>
          <Form.Item name="price" label={t("products.listPrice", "List price")}>
            <MoneyInput />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
