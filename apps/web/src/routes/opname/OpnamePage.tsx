/**
 * Stock opname — the counts that have been done, with a button to start another.
 *
 * History first (owner decision 2026-08-24). The old page opened on an empty
 * scan box, which meant the screen was dominated by a form for work that
 * happens once a month, and the record of every past count — the thing anyone
 * visiting this page on an ordinary day actually wants — was behind a tab.
 *
 * Starting a count settles what it covers before a single serial is scanned,
 * because none of it can change halfway through without invalidating the
 * count. The dialog asks for the date, a label, and the four scope axes the
 * owner named on 2026-08-31 — warehouse, rack, product category and condition
 * — each of which means "all" when left alone. `lib/opnameScope.ts` is that
 * grammar; this page is only the form for it.
 *
 * The scope is what stops a partial count reporting the rest of the shop as
 * lost. A Tuesday-afternoon recount of one rack of iPads used to name a
 * warehouse and nothing else, so every unit in it that nobody walked past
 * came out as missing at the confirmation step.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { fmtDate, fmtNone } from "../../lib/format.js";
import { useDb, mutate, nextId, docCode } from "../../mock/store.js";
import type { OpnameScope } from "../../lib/opnameScope.js";
import { restoreScans } from "../../lib/opnameCount.js";
import { ScopeFields, useConditionWord } from "./ScopeFields.js";
import type { OpnameRec } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

/** How many serials a count has read, expected or not. See `restoreScans`. */
const scannedIn = (o: OpnameRec | null) =>
  o === null ? 0 : restoreScans(o.counted, o.unknown).length;

export function OpnamePage() {
  const { t } = useTranslation();
  const db = useDb();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  /**
   * The four axes, each empty-means-all — held as one object since the editor
   * became shared with the session page (2026-09-01). See `ScopeFields`.
   *
   * Warehouse starts on the user's own rather than empty, which is both the
   * behaviour this dialog had before scopes existed and the honest default: a
   * count of every warehouse at once is a thing one person cannot do.
   */
  const [scope, setScope] = useState<OpnameScope>({
    locationIds: [db.myWarehouseId],
    rackIds: [],
    categories: [],
    conditions: [],
  });
  const [label, setLabel] = useState("");
  /**
   * The draft being deleted, and what has been typed to confirm it.
   *
   * Two layers, at the owner's ask (2026-09-01): the dialog itself is the
   * first, and typing the count's own reference is the second. Same shape as
   * GitHub's repository delete, and for the same reason — a confirm button
   * next to a row is a button somebody presses by reflex, and this one throws
   * away an hour of walking a warehouse.
   */
  const [deleting, setDeleting] = useState<OpnameRec | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");

  /** How a condition is spelled. Shared with the scope editor. */
  const conditionWord = useConditionWord();

  const rows = useMemo(
    () =>
      [...db.opnames]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((o) => ({
          ...o,
          // Joined into one string rather than kept as a list, because this is
          // what the column facets and searches on — and "every warehouse" is
          // a value staff will want to filter by as much as any single one.
          warehouse:
            o.locationIds.length === 0
              ? t("opnameList.allWarehouses", "All warehouses")
              : o.locationIds
                  .map(
                    (id) =>
                      db.warehouses.find((w) => w.id === id)?.name ?? fmtNone(),
                  )
                  .join(", "),
          /** The other three axes, as words, for the line under the warehouse. */
          narrowing: [
            ...o.rackIds.map(
              (id) => db.racks.find((r) => r.id === id)?.name ?? fmtNone(),
            ),
            ...o.categories,
            ...o.conditions.map(conditionWord),
          ],
          countedN: o.counted.length,
          missingN: o.missing.length,
          unknownN: o.unknown.length,
        })),
    // `t` is stable across renders in this app's i18n setup, but listing it
    // keeps the memo honest if that ever stops being true.
    [db.opnames, db.warehouses, db.racks, t],
  );

  const start = () => {
    if (!date) {
      message.error("Pick the date this count is for.");
      return;
    }
    const id = nextId("op");
    mutate((d) => {
      d.opnames.unshift({
        id,
        code: docCode("SO"),
        label: label.trim() || undefined,
        locationIds: [...scope.locationIds],
        rackIds: [...scope.rackIds],
        categories: [...scope.categories],
        conditions: [...scope.conditions],
        date: date.format("YYYY-MM-DD"),
        at: new Date().toISOString(),
        counted: [],
        counts: {},
        missing: [],
        unknown: [],
        notes: {},
        surplus: {},
        // A count begins as a draft. Nothing is written to any unit until it is
        // posted, so abandoning one halfway costs nothing.
        status: "DRAFT",
      });
    });
    setOpen(false);
    setLabel("");
    navigate(`/stock/opname/${id}`);
  };

  return (
    <PageContainer
      title={t("opnameList.stockOpname", "Stock Opname")}
      actions={[
        {
          key: "new",
          label: t("opnameList.newStockOpname", "New stock opname"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setOpen(true),
        },
      ]}
    >
      <Card>
        <ProTable
          persistKey="opname"
          rowKey="id"
          dataSource={rows}
          searchPlaceholder={t(
            "opnameList.searchReferenceLabelOrWarehouse",
            "Search reference, label or warehouse",
          )}
          keyboardRows={(r) =>
            t("opnameList.openCount", "Open {{code}}", { code: r.code })
          }
          onRow={(r) => ({
            style: { cursor: "pointer" },
            onClick: () => navigate(`/stock/opname/${r.id}`),
          })}
          columns={[
            {
              /*
               * Name first, reference under it (owner ask 2026-09-01) — the
               * two swapped places.
               *
               * The code is the identifier and the label is only a hint, which
               * is what put the code on top originally. In a LIST that is the
               * wrong way round: "SO-2026/08-000004" tells nobody which count
               * they are looking for, and "Rak A–C, shift pagi" tells them
               * immediately. The code stays on the row because it is what
               * staff quote to each other — one line down, in the position a
               * reference number occupies on every document in this app.
               *
               * Search and sort still key on the code AND the label together,
               * so nothing that used to find a row stops finding it.
               */
              title: t("opnameList.reference", "Reference"),
              key: "reference",
              searchable: true,
              searchValue: (r) => `${r.label ?? ""} ${r.code}`,
              sortValue: (r) => r.code,
              defaultSortOrder: "descend",
              render: (_, r) => (
                <>
                  <Typography.Text strong>
                    {r.label ?? t("opnameList.untitled", "Untitled count")}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", fontSize: 12 }}
                  >
                    {r.code}
                  </Typography.Text>
                </>
              ),
            },
            {
              /*
               * The scope, in one cell: the warehouses on the first line and
               * everything else narrowing them on the second.
               *
               * One column rather than four. Rack, category and condition are
               * empty on most counts — the shop's monthly count of a whole
               * warehouse names none of them — and three columns of "None" is
               * three columns of nothing on the screen this page opens with.
               */
              title: t("opnameList.scope", "Scope"),
              dataIndex: "warehouse",
              facet: true,
              searchable: true,
              render: (v: string, r) => (
                <>
                  <Typography.Text>{v}</Typography.Text>
                  {r.narrowing.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      {r.narrowing.map((n) => (
                        <Tag key={n} style={{ marginInlineEnd: 4 }}>
                          {n}
                        </Tag>
                      ))}
                    </div>
                  )}
                </>
              ),
            },
            {
              title: t("opnameList.countedFor", "Counted for"),
              dataIndex: "date",
              sortValue: (r) => r.date,
              render: (v: string) => fmtDate(v),
            },
            {
              title: t("opnameList.status", "Status"),
              dataIndex: "status",
              facet: true,
              render: (v: string) =>
                v === "DRAFT" ? (
                  <Tag color="gold">Draft</Tag>
                ) : (
                  <Tag color="green">Posted</Tag>
                ),
            },
            {
              title: t("opnameList.counted", "Counted"),
              dataIndex: "countedN",
              align: "right",
              width: 100,
              sortValue: (r) => r.countedN,
            },
            {
              title: t("opnameList.missing", "Missing"),
              dataIndex: "missingN",
              align: "right",
              width: 100,
              sortValue: (r) => r.missingN,
              render: (v: number) =>
                v === 0 ? (
                  0
                ) : (
                  <Typography.Text type="danger">{v}</Typography.Text>
                ),
            },
            {
              title: t("opnameList.unknown", "Unknown"),
              dataIndex: "unknownN",
              align: "right",
              width: 110,
              sortValue: (r) => r.unknownN,
              render: (v: number) =>
                v === 0 ? (
                  0
                ) : (
                  <Typography.Text type="warning">{v}</Typography.Text>
                ),
            },
            {
              /*
               * Throw away a draft (owner ask 2026-09-01).
               *
               * ⚠️ This is the app's second hard delete, and it is deliberately
               * narrow. CLAUDE.md's rule is that nothing is ever hard-deleted;
               * the reason it holds is that every other record in this app is
               * ABOUT something — a unit, a sale, a movement — and deleting it
               * would orphan the thing it describes. A DRAFT count is about
               * nothing: it writes to no unit, appends no event and moves no
               * stock until it is posted (see `post` on the session page), so
               * a mistyped one started against the wrong warehouse is litter
               * rather than history.
               *
               * A POSTED count is the opposite and is refused: it has written
               * `OPNAME_HILANG` against real units, and deleting the record
               * would leave those events pointing at a document that no longer
               * exists. The button is not drawn on a posted row at all — a
               * disabled control invites the click that has to be explained,
               * and there is nothing here worth explaining twice.
               *
               * ⚠️ Schema gap: prisma's `OpnameSession` has no soft-delete
               * column, and `OpnameStatus` has a `BATAL` that this could map
               * onto instead. Which of the two the API does is an owner
               * decision — the mock deletes, because that is what was asked
               * for on screen.
               */
              title: "",
              key: "delete",
              width: 60,
              render: (_, r) =>
                r.status === "DRAFT" ? (
                  <Tooltip
                    title={t(
                      "opnameList.deleteHint",
                      "Delete this draft count",
                    )}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={t(
                        "opnameList.deleteAria",
                        "Delete count {{code}}",
                        { code: r.code },
                      )}
                      onClick={(e) => {
                        // The row itself navigates into the count. Without
                        // this, deleting one opens it on the way out.
                        e.stopPropagation();
                        setDeleteTyped("");
                        setDeleting(r);
                      }}
                    />
                  </Tooltip>
                ) : null,
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title={t("opnameList.startAStockOpname", "Start a stock opname")}
        okText={t("opnameList.beginCounting", "Begin counting")}
        onCancel={() => setOpen(false)}
        onOk={start}
      >
        <Form layout="vertical">
          <Form.Item
            label={t("opnameList.dateThisCountIsFor", "Date this count is for")}
            required
          >
            <DatePicker
              value={date}
              onChange={setDate}
              format="DD MM YYYY"
              style={{ width: "100%" }}
            />
          </Form.Item>
          {/*
           * The scope, four multi-selects (owner ask 2026-08-31), lifted into
           * `ScopeFields` on 2026-09-01 so the mid-count editor is the same
           * form rather than a second copy of it.
           */}
          <ScopeFields
            value={scope}
            onChange={setScope}
            warehouses={db.warehouses}
            racks={db.racks}
            models={db.models}
          />
          <Form.Item
            label={t("opnameList.batch", "Batch")}
            extra="Optional. What tells this count apart from another of the same warehouse — a rack range, a shift."
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("opnameList.eGRakAC", "e.g. Rak A–C, shift pagi")}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/*
       * Layer two: type the reference.
       *
       * The dialog is the first layer and typing is the second, which is the
       * owner's ask and is GitHub's repository-delete pattern. The thing being
       * typed is the CODE rather than the batch label, for two reasons: every
       * count has one and a label is optional, and the code is displayed right
       * above the box so this is a deliberate-action check rather than a
       * memory test. Copy-pasting it is fine — the point is that the hand
       * cannot do it by accident.
       */}
      <Modal
        open={deleting !== null}
        title={t("opnameList.deleteTitle", "Delete this count?")}
        okText={t("opnameList.deleteOk", "Delete it")}
        okButtonProps={{
          danger: true,
          disabled: deleteTyped.trim() !== (deleting?.code ?? ""),
        }}
        onCancel={() => setDeleting(null)}
        onOk={() => {
          const doomed = deleting;
          if (!doomed || deleteTyped.trim() !== doomed.code) return;
          // Re-read the status inside the mutation. The list is live: a count
          // posted in another tab between opening this dialog and pressing the
          // button must not be deleted by a dialog that opened while it was
          // still a draft.
          let refused = false;
          mutate((d) => {
            const row = d.opnames.find((o) => o.id === doomed.id);
            if (!row) return;
            if (row.status !== "DRAFT") {
              refused = true;
              return;
            }
            d.opnames = d.opnames.filter((o) => o.id !== doomed.id);
          });
          setDeleting(null);
          if (refused) {
            message.error(
              t(
                "opnameList.deleteRefused",
                "That count has been posted since this dialog opened. A posted count cannot be deleted.",
              ),
            );
            return;
          }
          message.success(
            t("opnameList.deleted", "{{code}} deleted.", {
              code: doomed.code,
            }),
          );
        }}
      >
        <Flex vertical gap={12}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t(
              "opnameList.deleteBody",
              "This throws away the count and everything scanned into it. It is a draft, so no unit is touched — but nothing here can be recovered.",
            )}
          </Typography.Paragraph>
          {/* Both lists: a draft keeps the serials it expected in `counted`
              and the ones it did not in `unknown`, and a scan of either is
              work this dialog is about to throw away. */}
          {scannedIn(deleting) > 0 && (
            <Typography.Text type="warning">
              {t("opnameList.deleteScanned", "{{count}} serial(s) scanned.", {
                count: scannedIn(deleting),
              })}
            </Typography.Text>
          )}
          <Typography.Text>
            {t("opnameList.deleteTypeIt", "Type")}{" "}
            <Typography.Text code copyable>
              {deleting?.code}
            </Typography.Text>{" "}
            {t("opnameList.deleteToConfirm", "to confirm.")}
          </Typography.Text>
          <Input
            value={deleteTyped}
            onChange={(e) => setDeleteTyped(e.target.value)}
            aria-label={t(
              "opnameList.deleteTypeAria",
              "Type the reference to confirm",
            )}
            placeholder={deleting?.code}
            // Off, all four: this is a value being copied off the line above,
            // and a browser offering to complete it defeats the check.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Flex>
      </Modal>
    </PageContainer>
  );
}
