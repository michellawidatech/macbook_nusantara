/**
 * Phase 5 — reservations put units on hold; cancel releases them, or proceed to
 * Stock Out.
 *
 * Its own nav section since 2026-08-20, which is why this file sits beside the
 * other section folders rather than under `stock/`. The route moved with it:
 * `/reservations`, with `/stock/reservations` redirecting.
 *
 * ## One row per customer, not per serial (owner decision 2026-08-26)
 *
 * A hold is a conversation: somebody asks for two machines to be put aside and
 * comes in on Saturday for one of them. The old page modelled that as two
 * unrelated rows, sorted apart by whatever else was booked in between, so
 * "what is Rina waiting for?" had no answer on screen and cancelling her hold
 * meant finding every row with her name on it.
 *
 * So a row is now a whole hold. The row lists the machines on it — a product
 * and a serial per line, reading across — and picking among them happens in a
 * dialog behind the row's action button (owner revision 2026-08-27). The row
 * itself does not expand.
 *
 * That replaced an expandable row carrying the same tick boxes. Two things
 * were wrong with it. The row LOOKED expandable, because its product and
 * serial columns already stacked several lines, and clicking it opened a
 * second copy of what the reader was already looking at. And the controls that
 * came with it sat at the foot of a row wider than the viewport, which is a
 * place a horizontal scrollbar hides. A dialog is neither: it is the width of
 * the screen, it is the only thing on it, and it is reached by pressing a
 * button that says what it does.
 *
 * `lib/reservations.ts` explains why none of this needs a new column: a
 * machine's state IS its unit's status, and selling two of three leaves the
 * third at `DIRESERVASI` on its own.
 *
 * ## Why the form is a modal
 *
 * It collects a customer, a time, a channel, a note and any number of
 * machines. That is a job with a beginning and an end, and nothing in the
 * table behind it feeds a single field — the definition of a modal rather than
 * an inline form the whole page has to scroll past.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  PlusOutlined,
  ShoppingCartOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { EnumTag } from "../../components/EnumTag";
import { GradeTag } from "../../components/GradeTag";
import { LongText } from "../../components/LongText";
import { api } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import {
  cancelHold,
  createHold,
  holdsKey,
  holdSourcesKey,
  listHoldSources,
  listHolds,
  releaseHold,
  type Hold,
  type HoldItem,
  type HoldState,
} from "../../lib/reservationsApi.js";
import { describeApiError } from "../../i18n/apiErrors.js";
import { tagOf, RESERVATION_STATUS } from "../../i18n/enumLabels.js";

/** Machines still waiting to be collected on this hold. */
const heldOf = (r: Hold): readonly HoldItem[] =>
  r.items.filter((i) => i.state === "HELD");

/** How far along a hold is, for the one line a table cell can afford. */
const holdProgress = (r: Hold) => ({
  held: r.items.filter((i) => i.state === "HELD").length,
  bought: r.items.filter((i) => i.state === "BOUGHT").length,
  released: r.items.filter((i) => i.state === "RELEASED").length,
  total: r.items.length,
});

/**
 * A key that is stable for one attempt and new for the next.
 *
 * `Idempotency-Key` is what turns a double-clicked Reserve on a slow
 * connection into one hold instead of one hold plus a puzzling "that unit is
 * not available" for the hold you just made.
 */
const newKey = () => crypto.randomUUID();

/**
 * One machine's state, said in the same words as the whole hold's.
 *
 * Mapped onto `RESERVATION_STATUS` rather than given a vocabulary of its own,
 * because the two tags sit inches apart on this screen — the header's in the
 * Status column, the item's in the expanded row — and a hold reading "On hold"
 * above a machine reading "Held" invites the reader to hunt for a distinction
 * that is not there.
 */
const ITEM_STATE: Record<HoldState, string> = {
  HELD: "TERJADWAL",
  BOUGHT: "SELESAI",
  RELEASED: "BATAL",
};

/** The shape the modal collects. `serials` is the multi-select. */
interface HoldForm {
  /**
   * The customer, by number and name.
   *
   * Not a picker over an existing list: there is no customers endpoint yet, and
   * the create service already accepts a phone and a name and upserts on the
   * number — create-only, so a bot or a cashier may add somebody the shop has
   * never met and neither may rewrite a customer staff maintain.
   */
  phone: string;
  name: string;
  serials: string[];
  when: dayjs.Dayjs;
  sourceId: string;
  note?: string;
}

export function ReservationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<HoldForm>();
  const [adding, setAdding] = useState(false);
  /**
   * Which machines are ticked, per hold.
   *
   * Keyed by hold id rather than one flat set, because two holds can be open
   * at once and a tick on one must not arm the Check out button on the other —
   * they go to different customers.
   */
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  /** The hold whose units dialog is open, or null. */
  const [managing, setManaging] = useState<Hold | null>(null);
  /**
   * Whether checking out part of a hold also lets the rest go.
   *
   * Off by default, and deliberately: a customer who collects two of three is
   * usually still coming back for the third, and a switch that quietly cancels
   * it would be the expensive default. Reset whenever the dialog opens, so a
   * decision made about one hold cannot carry into the next one.
   */
  const [releaseRest, setReleaseRest] = useState(false);

  /**
   * The holds themselves — server data, so TanStack Query owns it (01 §5)
   * rather than a bespoke store a second copy could disagree with.
   *
   * The rows arrive pre-joined: every item already carries its product name,
   * grade, unit status and derived state, so this screen does no lookups and
   * no N+1. That matters here more than most: the old version ran a
   * `db.units.find` per serial per column per render.
   */
  const holds = useQuery({
    queryKey: holdsKey,
    queryFn: ({ signal }) => listHolds(signal),
    staleTime: 10_000,
  });

  /** The channel list, from the table the migration created. */
  const sources = useQuery({
    queryKey: holdSourcesKey,
    queryFn: ({ signal }) => listHoldSources(signal),
    staleTime: 5 * 60_000,
  });

  /**
   * Sellable machines to offer in the create form.
   *
   * The inventory endpoint already answers this — serial, product and grade,
   * filtered and paginated server-side — so there is no second endpoint for it.
   *
   * ## The search is the SERVER's, not the Select's
   *
   * `perPage` is capped at 200, and it used to be the only thing between this
   * picker and the whole shelf: antd filtered those 200 options in the browser,
   * so a machine sitting at position 201 could not be found by typing its
   * serial and could not be reserved at all. Nothing said so — an empty
   * dropdown reads as "we do not have that", which is the one answer that was
   * certainly wrong.
   *
   * So `q` goes to the server, `filterOption` is off, and the page count below
   * is what the dropdown says when there is more than it is showing.
   */
  const [unitQuery, setUnitQuery] = useState("");
  const availableUnits = useQuery({
    queryKey: ["katalog", "inventori", "tersedia", unitQuery],
    queryFn: ({ signal }) =>
      api<{
        rows: { serial: string; skuName: string }[];
        total: number;
      }>(
        `/api/katalog/inventori?status=TERSEDIA&perPage=200${
          unitQuery.trim() === ""
            ? ""
            : `&q=${encodeURIComponent(unitQuery.trim())}`
        }`,
        { signal },
      ),
    staleTime: 10_000,
    // The previous page stays on screen while the next one is fetched, so the
    // dropdown does not blink empty between keystrokes.
    placeholderData: (prev) => prev,
  });
  /** How many sellable machines the search matched but this page cannot show. */
  const unitsBeyondPage = Math.max(
    0,
    (availableUnits.data?.total ?? 0) - (availableUnits.data?.rows.length ?? 0),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: holdsKey });

  const rows = useMemo(
    () =>
      [...(holds.data?.rows ?? [])].sort(
        // Newest conversation first, and holds that still want something ahead
        // of ones that are finished with — a finished hold is a receipt, and a
        // receipt does not belong at the top of a work list.
        (a, b) =>
          Number(b.status === "TERJADWAL") - Number(a.status === "TERJADWAL") ||
          (b.scheduledFor ?? b.createdAt).localeCompare(
            a.scheduledFor ?? a.createdAt,
          ),
      ),
    [holds.data],
  );

  /**
   * Put machines aside.
   *
   * Everything authoritative happens on the server now: the RV number comes
   * from `next_doc_code`, the ledger's `seq` from the ledger, the actor from
   * the session, and the availability check from inside the same transaction
   * that writes the hold. This screen sends what the person typed and renders
   * the answer.
   */
  const add = useMutation({
    mutationFn: (v: HoldForm) =>
      createHold(
        {
          serials: v.serials,
          phone: v.phone.trim(),
          name: v.name.trim(),
          scheduledFor: v.when.toISOString(),
          reservationSourceId: v.sourceId,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
        },
        newKey(),
      ),
    onSuccess: async (_res, v) => {
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: ["katalog", "inventori", "tersedia"],
      });
      message.success(
        t("reservations.heldN", "{{count}} unit(s) are now on hold.", {
          count: v.serials.length,
        }),
      );
      form.resetFields();
      setAdding(false);
    },
    // The server's message is already Indonesian and already names the serial
    // that moved, so it is shown as written rather than replaced with a guess.
    onError: (e) => message.error(describeApiError(e, t)),
  });

  /**
   * Release machines from a hold.
   *
   * Passing every held serial is what the row-level Cancel does, and the
   * endpoint for that is `/cancel` — one call, so a hold cannot be left
   * half-released if the connection drops between two of them.
   */
  const releasing = useMutation({
    mutationFn: ({ r, serials }: { r: Hold; serials: readonly string[] }) =>
      serials.length === heldOf(r).length
        ? cancelHold(r.id, newKey())
        : releaseHold(r.id, serials, newKey()),
    onSuccess: async (_res, { r, serials }) => {
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: ["katalog", "inventori", "tersedia"],
      });
      setPicked((p) => ({ ...p, [r.id]: [] }));
      setManaging(null);
      message.success(
        t("reservations.releasedN", "{{count}} unit(s) back in stock.", {
          count: serials.length,
        }),
      );
    },
    onError: (e) => message.error(describeApiError(e, t)),
  });

  /** Fire and wait, so a caller can navigate only after the write landed. */
  const releaseNow = (r: Hold, serials: readonly string[]) =>
    serials.length === 0
      ? Promise.resolve()
      : releasing.mutateAsync({ r, serials }).catch(() => undefined);

  const release = (r: Hold, serials: readonly string[]) => {
    if (serials.length === 0) return;
    modal.confirm({
      title:
        serials.length === heldOf(r).length
          ? t("reservations.cancelThisReservation", "Cancel this reservation?")
          : t("reservations.releaseSelected", "Release the selected units?"),
      content: t(
        "reservations.releaseBody",
        "{{units}} goes back into sellable stock straight away.",
        { units: serials.join(", ") },
      ),
      okText: t("reservations.release", "Release"),
      okButtonProps: { danger: true },
      cancelText: t("reservations.keepTheHold", "Keep the hold"),
      // Awaited, so the dialog stays up until the server has answered and a
      // refusal lands on the dialog rather than behind it. The success toast
      // and the dialog close are the mutation's job now.
      onOk: () => releaseNow(r, serials),
    });
  };

  /**
   * Take the ticked machines — or all of them — to the till.
   *
   * `alsoRelease` is the dialog's "let the rest go" switch. It is applied
   * before the navigation because the store write is the part that must
   * happen — not because the order is load-bearing: `navigate` schedules a
   * router state update rather than unmounting mid-handler, so both orders
   * work today. Writing first keeps it that way if this ever moves behind
   * something that does leave immediately.
   *
   * The release is not confirmed a second time. The switch was the consent,
   * and a confirm dialog on the way to the till is a dialog nobody reads.
   */
  const checkOut = async (
    r: Hold,
    serials: readonly string[],
    alsoRelease: readonly string[] = [],
  ) => {
    if (serials.length === 0) return;
    // AWAITED, unlike the mock version. The release is a network call now, and
    // navigating first would leave a 409 or a dropped connection landing on a
    // page that has already gone — the customer's other machines silently not
    // released, with nothing on screen to say so.
    if (alsoRelease.length > 0) await releaseNow(r, alsoRelease);
    navigate(
      `/stock/out?reservation=${r.id}&serials=${encodeURIComponent(serials.join(","))}`,
    );
  };

  /** Open the units dialog for one hold, with nothing assumed about it. */
  const manage = (r: Hold) => {
    setPicked((p) => ({ ...p, [r.id]: [] }));
    setReleaseRest(false);
    setManaging(r);
  };

  /**
   * The machines inside one hold, ticked for checkout.
   *
   * A table rather than a list, because every column answers a different
   * question and three of them are the ones the row promised — product,
   * serial, and what has happened to it. There is no per-machine note column:
   * the note belongs to the hold, not to one of the machines on it (owner
   * revision 2026-08-27), and it is already on the row behind this dialog.
   */
  const unitsTable = (r: Hold) => {
    const held = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
    const chosen = picked[r.id] ?? [];
    const allChosen = held.length > 0 && chosen.length === held.length;

    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={r.items}
        columns={[
          {
            title: (
              <Checkbox
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                disabled={held.length === 0}
                aria-label={t(
                  "reservations.selectAllAria",
                  "Select every unit still on hold",
                )}
                onChange={(e) =>
                  setPicked((p) => ({
                    ...p,
                    [r.id]: e.target.checked ? held : [],
                  }))
                }
              />
            ),
            key: "pick",
            width: 48,
            render: (_, item) => {
              const state = item.state;
              // `ReservationItem.unitId` is nullable in the schema, so an item
              // can in principle name no machine. Nothing creates one today —
              // a quantity-hold would — and it certainly cannot be checked out.
              const serial = item.serial;
              return (
                <Checkbox
                  checked={serial !== null && chosen.includes(serial)}
                  // Only a machine still on hold can be checked out. One
                  // already bought is history; one released is somebody
                  // else's to sell.
                  disabled={state !== "HELD" || serial === null}
                  aria-label={t("reservations.selectAria", "Select {{serial}}", {
                    serial: serial ?? "—",
                  })}
                  onChange={(e) =>
                    setPicked((p) => {
                      const now = p[r.id] ?? [];
                      if (serial === null) return p;
                      return {
                        ...p,
                        [r.id]: e.target.checked
                          ? [...now, serial]
                          : now.filter((x) => x !== serial),
                      };
                    })
                  }
                />
              );
            },
          },
          {
            title: t("reservations.product", "Product"),
            key: "product",
            render: (_, item) => item.productName,
          },
          {
            title: t("reservations.serial", "Serial"),
            dataIndex: "serial",
            width: 180,
          },
          {
            // The dialog exists because picking among near-identical machines
            // is a decision (owner revision 2026-08-27), and the grade is
            // half of what that decision is made on.
            title: t("reservations.grade", "Grade"),
            key: "grade",
            width: 90,
            render: (_, item) => (
              <GradeTag grade={item.grade ?? undefined} />
            ),
          },
          {
            title: t("reservations.status", "Status"),
            key: "state",
            width: 130,
            render: (_, item) => (
              <EnumTag
                map={RESERVATION_STATUS}
                value={ITEM_STATE[item.state]}
              />
            ),
          },
        ]}
      />
    );
  };

  return (
    <PageContainer
      title={t("reservations.reservation", "Reservation")}
      actions={[
        {
          key: "add",
          label: t("reservations.addReservation", "Add reservation"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAdding(true),
        },
      ]}
    >
      <Flex vertical gap={16}>
        {/* A failed refresh renders BESIDE the data, never instead of it: a
            cashier mid-conversation must not lose the list on one bad
            response. The server's message is already Indonesian. */}
        {holds.isError && (
          <Alert
            type="warning"
            showIcon
            message={describeApiError(holds.error, t)}
          />
        )}
        <Card title={t("reservations.reservations", "Reservations")}>
          {holds.isPending ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
          <ProTable<Hold>
            rowKey="id"
            dataSource={rows}
            searchPlaceholder={t(
              "reservations.searchSerialProductOrCustomer",
              "Search serial, product or customer",
            )}
            columns={[
              {
                title: t("reservations.customer", "Customer"),
                key: "customer",
                width: 180,
                searchable: true,
                facet: true,
                sortValue: (r) => r.customerName,
                render: (_, r) => (
                  <Flex vertical>
                    <strong>{r.customerName}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.code}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("reservations.when", "When"),
                dataIndex: "scheduledFor",
                width: 170,
                // A hold made through chat may carry no appointment at all —
                // the customer never named one — so the cell has to say that
                // rather than render an empty box.
                render: (v) => (v ? fmtDateTime(v as string) : "—"),
              },
              {
                title: t("reservations.product", "Product"),
                key: "product",
                width: 240,
                searchable: true,
                searchValue: (r) =>
                  r.items.map((i) => i.productName).join(" "),
                sortValue: (r) => r.items[0]?.productName ?? "",
                render: (_, r) => (
                  <Flex vertical gap={2}>
                    {r.items.map((i) => (
                      <span key={i.id}>{i.productName}</span>
                    ))}
                  </Flex>
                ),
              },
              {
                // Deliberately a second column rather than a line under the
                // product: they line up row for row, so the reader can run a
                // finger across and match the third product to the third
                // serial. That is what "serial per product" asked for.
                title: t("reservations.serial", "Serial"),
                key: "serials",
                width: 180,
                searchable: true,
                searchValue: (r) => r.items.map((i) => i.serial).join(" "),
                render: (_, r) => (
                  <Flex vertical gap={2}>
                    {r.items.map((i) => (
                      <Typography.Text key={i.id} type="secondary">
                        {i.serial}
                      </Typography.Text>
                    ))}
                  </Flex>
                ),
              },
              {
                title: t("reservations.cameFrom", "Came from"),
                key: "source",
                width: 130,
                facet: true,
                sortValue: (r) => r.channelName ?? "—",
                render: (_, r) =>
                  r.channelName ? (
                    <Tag>{r.channelName}</Tag>
                  ) : (
                    "—"
                  ),
              },
              {
                title: t("reservations.note", "Note"),
                dataIndex: "note",
                // Wide enough for the sentence or two staff actually write —
                // "collecting Saturday, wants the charger checked" — instead
                // of the ellipsis a 140px column made of it.
                width: 340,
                render: (v: string) => <LongText>{v}</LongText>,
              },
              {
                title: t("reservations.status", "Status"),
                dataIndex: "status",
                width: 150,
                facet: true,
                sortValue: (r) => tagOf(RESERVATION_STATUS, r.status, t).label,
                render: (v: string, r) => {
                  const p = holdProgress(r);
                  return (
                    <Flex vertical gap={2}>
                      <EnumTag map={RESERVATION_STATUS} value={v} />
                      {/* The count only earns its place on a hold that is
                          part-collected — on a single-machine hold the tag
                          above has already said everything. */}
                      {p.total > 1 && p.held > 0 && p.held < p.total && (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          {t(
                            "reservations.heldOfTotal",
                            "{{held}} of {{total}} left",
                            { held: p.held, total: p.total },
                          )}
                        </Typography.Text>
                      )}
                    </Flex>
                  );
                },
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                title: "",
                key: "actions",
                width: 100,
                render: (_, r) => {
                  const held = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
                  if (held.length === 0) return null;
                  return (
                    // One button, and it opens the dialog rather than doing
                    // anything on its own (owner revision 2026-08-27). Two
                    // icon buttons used to sit here — sell everything, cancel
                    // everything — and both acted on a whole hold from a
                    // 100px column, with no step in between where an operator
                    // could see which machines they were about to commit.
                    <Flex gap={8}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<ShoppingCartOutlined />}
                        aria-label={t(
                          "reservations.manageAria",
                          "Open the units on {{code}}",
                          { code: r.code },
                        )}
                        onClick={() => manage(r)}
                      >
                        {t("reservations.units", "Units")}
                      </Button>
                    </Flex>
                  );
                },
              },
            ]}
          />
          )}
        </Card>
      </Flex>

      {/**
        * The units on one hold — the only place they can be picked among.
        *
        * Everything an operator can do to a hold lives here, which is the
        * point of the 2026-08-27 revision: the row shows what is on the hold
        * and this decides what happens to it. Three actions, in the order a
        * counter actually uses them — take everything, take some, or let it
        * all go.
        */}
      <Modal
        open={managing !== null}
        onCancel={() => setManaging(null)}
        title={
          managing
            ? t("reservations.unitsOnHold", "Units on {{code}}", {
                code: managing.code,
              })
            : ""
        }
        width={720}
        footer={null}
        destroyOnHidden
      >
        {managing &&
          (() => {
            // Re-read from `rows` rather than trusting the snapshot captured
            // when the dialog opened: releasing part of a hold mutates the
            // store, and a stale copy would keep offering machines that have
            // already gone back into stock.
            const r = rows.find((x) => x.id === managing.id) ?? managing;
            const held = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
            const chosen = (picked[r.id] ?? []).filter((sn) =>
              held.includes(sn),
            );
            const rest = held.filter((sn) => !chosen.includes(sn));

            return (
              <Flex vertical gap={16}>
                {unitsTable(r)}

                {r.note && (
                  <Typography.Text type="secondary">
                    {/* The hold's note, not any one machine's. It is what the
                        customer actually asked for, and it is the thing an
                        operator needs in front of them while deciding what to
                        hand over. */}
                    {r.note}
                  </Typography.Text>
                )}

                {/* Only ever shown when there IS a rest. With everything
                    ticked the switch would govern an empty set, and a control
                    that does nothing still reads as a control that might. */}
                {rest.length > 0 && chosen.length > 0 && (
                  <Flex align="center" gap={12}>
                    <Switch
                      checked={releaseRest}
                      onChange={setReleaseRest}
                      aria-label={t(
                        "reservations.releaseRestAria",
                        "Cancel the hold on the units not being taken",
                      )}
                    />
                    <Typography.Text>
                      {t(
                        "reservations.releaseRest",
                        "Cancel the hold on the other {{count}} and put them back in stock",
                        { count: rest.length },
                      )}
                    </Typography.Text>
                  </Flex>
                )}

                <Flex gap={8} wrap align="center" justify="flex-end">
                  <Typography.Text type="secondary" style={{ marginRight: "auto" }}>
                    {t(
                      "reservations.pickedCount",
                      "{{picked}} of {{held}} still-held unit(s) selected",
                      { picked: chosen.length, held: held.length },
                    )}
                  </Typography.Text>
                  <Button
                    danger
                    icon={<StopOutlined />}
                    disabled={held.length === 0}
                    onClick={() => release(r, held)}
                  >
                    {t("reservations.cancelTheHold", "Cancel the hold")}
                  </Button>
                  {/* Buy all takes every held machine regardless of what is
                      ticked, so it is not a shortcut for "tick them all and
                      press the other button" — it is the common case, and it
                      never has a rest to release. */}
                  <Button
                    icon={<ShoppingCartOutlined />}
                    disabled={held.length === 0}
                    onClick={() => checkOut(r, held)}
                  >
                    {t("reservations.buyAll", "Buy all {{count}}", {
                      count: held.length,
                    })}
                  </Button>
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    disabled={chosen.length === 0}
                    onClick={() =>
                      checkOut(r, chosen, releaseRest ? rest : [])
                    }
                  >
                    {t("reservations.checkOutSelected", "Check out {{count}}", {
                      count: chosen.length,
                    })}
                  </Button>
                </Flex>
              </Flex>
            );
          })()}
      </Modal>

      <Modal
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={() => form.submit()}
        okButtonProps={{ loading: add.isPending }}
        okText={t("reservations.reserve", "Reserve")}
        title={t("reservations.addReservation", "Add reservation")}
        width={640}
        destroyOnHidden
      >
        <Form<HoldForm>
          form={form}
          layout="vertical"
          initialValues={{ when: dayjs().add(1, "day") }}
          onFinish={(v) => add.mutate(v)}
        >
          {/* The number is the customer's identity: `Customer.phone` is unique,
              and the service upserts on it — create-only, so a hold made at the
              counter for somebody the shop already knows attaches to the
              existing row and never rewrites their name. */}
          <Flex gap={16} wrap>
            <Form.Item
              name="phone"
              label={t("customers.phone", "Phone")}
              rules={[{ required: true, message: t("form.pickCustomer", "Pick a customer") }]}
              style={{ flex: "1 1 220px" }}
            >
              <Input placeholder="+62812..." maxLength={20} />
            </Form.Item>
            <Form.Item
              name="name"
              label={t("customers.name", "Name")}
              rules={[{ required: true, message: t("form.pickCustomer", "Pick a customer") }]}
              style={{ flex: "1 1 220px" }}
            >
              <Input maxLength={120} />
            </Form.Item>
          </Flex>
          {/* The multi-select is the whole point of the modal: one hold, as
              many machines as the conversation covered. Only sellable units
              are offered — a machine already on hold for somebody else is not
              the shop's to promise twice. */}
          <Form.Item
            name="serials"
            label={t("reservations.units", "Units")}
            rules={[{ required: true, message: t("form.pickUnit", "Pick at least one unit") }]}
          >
            <Select
              mode="multiple"
              showSearch
              // Searched on the server — see `availableUnits`. antd must not
              // also filter, or it would narrow the page the server just
              // chose and hide rows that genuinely matched.
              filterOption={false}
              onSearch={setUnitQuery}
              placeholder={t("reservations.availableUnit", "Available unit")}
              loading={availableUnits.isFetching}
              options={(availableUnits.data?.rows ?? []).map((u) => ({
                value: u.serial,
                label: `${u.serial} — ${u.skuName}`,
              }))}
              notFoundContent={
                availableUnits.isFetching
                  ? undefined
                  : t("reservations.noUnitMatch", "No machine matches that.")
              }
              popupRender={(menu) => (
                <>
                  {menu}
                  {unitsBeyondPage > 0 && (
                    <Typography.Text
                      type="secondary"
                      style={{ display: "block", padding: "4px 12px" }}
                    >
                      {t(
                        "reservations.moreUnits",
                        "{{count}} more match — keep typing to narrow it.",
                        { count: unitsBeyondPage },
                      )}
                    </Typography.Text>
                  )}
                </>
              )}
            />
          </Form.Item>
          <Flex gap={16} wrap>
            <Form.Item
              name="sourceId"
              label={t("reservations.cameFrom", "Came from")}
              rules={[{ required: true, message: t("form.pickSource", "Where did this come from?") }]}
              style={{ flex: "1 1 220px" }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={t("reservations.cameFrom", "Came from")}
                loading={sources.isPending}
                options={(sources.data?.sources ?? []).map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="when"
              label={t("reservations.holdUntil", "Hold until")}
              rules={[{ required: true, message: t("form.pickTime", "Pick a time") }]}
              style={{ flex: "1 1 220px" }}
            >
              <DatePicker
                showTime
                format="DD MMM YYYY HH:mm"
                style={{ width: "100%" }}
              />
            </Form.Item>
          </Flex>
          <Form.Item name="note" label={t("reservations.note", "Note")}>
            {/* Two rows, not one line: what staff write here is "collecting
                Saturday, wants the charger checked first", and a single-line
                input hides the second half of it behind a caret. */}
            <Input.TextArea
              rows={2}
              maxLength={280}
              showCount
              placeholder={t(
                "reservations.notePlaceholder",
                "When they are collecting, what they asked for, anything the next person needs to know",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
