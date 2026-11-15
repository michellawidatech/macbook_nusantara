/**
 * Every filter of a list in one bottom sheet (owner-approved mockup a2/c2,
 * 2026-11-16). It replaced a stack of full-width multi-selects above the list
 * — four dropdowns to open one after another, on a screen that then had no
 * room left for the list.
 *
 * - Each facet column is a group of tap-to-select chips, with a count beside
 *   each value: how many rows it would leave, given the other filters and the
 *   search. A zero is dimmed, never hidden — a value that vanished would read
 *   as "that does not exist" rather than "not with what you picked".
 * - A date column is presets (`lib/datePresets.ts`) and Custom.
 * - The sheet edits a DRAFT. Reset clears it; **Show n results** applies it
 *   and says, before you leave, what you will get. Closing throws it away.
 *
 * It holds no filter state of its own beyond the draft: `ProTable` hands it
 * the applied filters and writes back what Show returns — the same maps its
 * desktop column headers write.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  DatePicker,
  Drawer,
  Flex,
  Input,
  Typography,
  theme,
} from "antd";
import { CalendarOutlined, CheckOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import {
  presetOf,
  presetRange,
  type DatePreset,
  type DayRange,
} from "../lib/datePresets";
import { SPACE, TYPE, WEIGHT } from "../theme/tokens";

export interface SheetFacet {
  readonly key: string;
  readonly label: string;
  readonly options: readonly string[];
}

export interface SheetDate {
  readonly key: string;
  readonly label: string;
}

type Filters = Record<string, string[]>;
type Ranges = Record<string, DayRange>;

/** A group past this many values gets a search box and a "Show all". */
const CHIP_LIMIT = 12;

export function FilterSheet({
  open,
  onClose,
  facets,
  dates,
  filters,
  ranges,
  count,
  optionCounts,
  onApply,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly facets: readonly SheetFacet[];
  readonly dates: readonly SheetDate[];
  readonly filters: Filters;
  readonly ranges: Ranges;
  /** Rows left by these filters (and the list's search). */
  readonly count: (filters: Filters, ranges: Ranges) => number;
  /** Per value of one facet: rows left given every OTHER filter. */
  readonly optionCounts: (
    key: string,
    filters: Filters,
    ranges: Ranges,
  ) => ReadonlyMap<string, number>;
  readonly onApply: (filters: Filters, ranges: Ranges) => void;
}) {
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorTextQuaternary },
  } = theme.useToken();
  const [draft, setDraft] = useState<{ filters: Filters; ranges: Ranges }>({
    filters,
    ranges,
  });
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [needle, setNeedle] = useState<Record<string, string>>({});
  const [all, setAll] = useState<Record<string, boolean>>({});

  // A fresh draft each time the sheet opens, from what is applied now.
  useEffect(() => {
    if (!open) return;
    setDraft({ filters, ranges });
    setCustom(
      Object.fromEntries(
        dates.map((d) => [d.key, presetOf(ranges[d.key]) === "custom"]),
      ),
    );
    setNeedle({});
    setAll({});
  }, [open]);

  const shown = useMemo(
    () => (open ? count(draft.filters, draft.ranges) : 0),
    [open, draft, count],
  );

  const toggle = (key: string, value: string) =>
    setDraft((d) => {
      const on = d.filters[key] ?? [];
      return {
        ...d,
        filters: {
          ...d.filters,
          [key]: on.includes(value)
            ? on.filter((v) => v !== value)
            : [...on, value],
        },
      };
    });
  const setRange = (key: string, r: DayRange | undefined) =>
    setDraft((d) => {
      const next = { ...d.ranges };
      if (r === undefined) delete next[key];
      else next[key] = r;
      return { ...d, ranges: next };
    });

  const heading = (label: string, picked: number) => (
    <Flex justify="space-between" align="baseline">
      <Typography.Text strong style={{ fontSize: TYPE.lg }}>
        {label}
      </Typography.Text>
      {picked > 0 && (
        <Typography.Text style={{ color: colorTextSecondary }}>
          {t("filterSheet.picked", "{{count}} picked", { count: picked })}
        </Typography.Text>
      )}
    </Flex>
  );

  const chip = (
    key: string,
    on: boolean,
    label: ReactNode,
    onClick: () => void,
    n?: number,
    icon?: ReactNode,
  ) => (
    <Button
      key={key}
      shape="round"
      aria-pressed={on}
      className={`nusantara-chip${on ? " is-on" : ""}`}
      icon={on ? <CheckOutlined aria-hidden /> : icon}
      onClick={onClick}
      style={n === 0 && !on ? { color: colorTextQuaternary } : undefined}
    >
      {label}
      {n !== undefined && (
        <span
          style={{
            marginInlineStart: SPACE.xs,
            fontSize: TYPE.sm,
            color: on ? undefined : colorTextSecondary,
            fontWeight: WEIGHT.regular,
          }}
        >
          {n}
        </span>
      )}
    </Button>
  );

  const PRESETS: { value: DatePreset | "any"; label: string }[] = [
    { value: "any", label: t("filterSheet.anyDate", "Any date") },
    { value: "today", label: t("filterSheet.today", "Today") },
    { value: "7d", label: t("filterSheet.sevenDays", "7 days") },
    { value: "month", label: t("filterSheet.thisMonth", "This month") },
  ];

  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={onClose}
      title={t("filterSheet.title", "Filters")}
      size="auto"
      rootClassName="nusantara-bottom-sheet"
      destroyOnHidden
      footer={
        <Flex gap={SPACE.sm}>
          <Button
            size="large"
            onClick={() => {
              setDraft({ filters: {}, ranges: {} });
              setCustom({});
            }}
            style={{ flex: "0 0 35%" }}
          >
            {t("filterSheet.reset", "Reset")}
          </Button>
          <Button
            size="large"
            type="primary"
            style={{ flex: 1 }}
            onClick={() => {
              onApply(draft.filters, draft.ranges);
              onClose();
            }}
          >
            {t("filterSheet.show", "Show {{count}} results", { count: shown })}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={SPACE.lg}>
        {dates.map((d) => {
          const now = presetOf(draft.ranges[d.key]);
          const isCustom = custom[d.key] === true || now === "custom";
          const r = draft.ranges[d.key];
          return (
            <Flex
              vertical
              gap={SPACE.sm}
              key={`date:${d.key}`}
              role="group"
              aria-label={d.label}
            >
              {heading(d.label, 0)}
              <Flex wrap gap={SPACE.sm}>
                {PRESETS.map((p) =>
                  chip(p.value, !isCustom && now === p.value, p.label, () => {
                    setCustom((c) => ({ ...c, [d.key]: false }));
                    setRange(
                      d.key,
                      p.value === "any" ? undefined : presetRange(p.value),
                    );
                  }),
                )}
                {chip(
                  "custom",
                  isCustom,
                  t("filterSheet.custom", "Custom"),
                  () => setCustom((c) => ({ ...c, [d.key]: true })),
                  undefined,
                  <CalendarOutlined aria-hidden />,
                )}
              </Flex>
              {isCustom && (
                <Flex gap={SPACE.sm}>
                  <DatePicker
                    inputReadOnly
                    aria-label={t("proTable.dateFrom", "From")}
                    placeholder={t("proTable.dateFrom", "From")}
                    format="DD MMM YYYY"
                    value={r?.[0] ? dayjs(r[0]) : null}
                    onChange={(v) =>
                      setRange(d.key, [
                        v ? v.format("YYYY-MM-DD") : null,
                        r?.[1] ?? null,
                      ])
                    }
                    style={{ flex: 1 }}
                  />
                  <DatePicker
                    inputReadOnly
                    aria-label={t("proTable.dateUntil", "Until")}
                    placeholder={t("proTable.dateUntil", "Until")}
                    format="DD MMM YYYY"
                    value={r?.[1] ? dayjs(r[1]) : null}
                    onChange={(v) =>
                      setRange(d.key, [
                        r?.[0] ?? null,
                        v ? v.format("YYYY-MM-DD") : null,
                      ])
                    }
                    style={{ flex: 1 }}
                  />
                </Flex>
              )}
            </Flex>
          );
        })}
        {facets.map((f) => {
          const picked = draft.filters[f.key] ?? [];
          const counts = optionCounts(f.key, draft.filters, draft.ranges);
          const q = (needle[f.key] ?? "").trim().toLowerCase();
          const many = f.options.length > CHIP_LIMIT;
          const matching = q
            ? f.options.filter((v) => v.toLowerCase().includes(q))
            : f.options;
          // Picked values stay visible whatever the search says.
          const visible =
            many && !q && !all[f.key]
              ? [
                  ...matching.slice(0, CHIP_LIMIT),
                  ...picked.filter(
                    (v) => !matching.slice(0, CHIP_LIMIT).includes(v),
                  ),
                ]
              : matching;
          return (
            <Flex
              vertical
              gap={SPACE.sm}
              key={f.key}
              role="group"
              aria-label={f.label}
            >
              {heading(f.label, picked.length)}
              {many && (
                <Input
                  allowClear
                  aria-label={t("filterSheet.searchIn", "Search {{label}}", {
                    label: f.label,
                  })}
                  placeholder={t("filterSheet.searchIn", "Search {{label}}", {
                    label: f.label,
                  })}
                  value={needle[f.key] ?? ""}
                  onChange={(e) =>
                    setNeedle((n) => ({ ...n, [f.key]: e.target.value }))
                  }
                />
              )}
              <Flex wrap gap={SPACE.sm}>
                {visible.map((v) =>
                  chip(
                    v,
                    picked.includes(v),
                    v,
                    () => toggle(f.key, v),
                    counts.get(v) ?? 0,
                  ),
                )}
              </Flex>
              {many && !q && !all[f.key] && (
                <Button
                  type="link"
                  style={{ alignSelf: "flex-start", paddingInline: 0 }}
                  onClick={() => setAll((a) => ({ ...a, [f.key]: true }))}
                >
                  {t("filterSheet.showAll", "Show all {{count}}", {
                    count: f.options.length,
                  })}
                </Button>
              )}
            </Flex>
          );
        })}
      </Flex>
    </Drawer>
  );
}
