/**
 * A multi-series line chart, drawn as inline SVG.
 *
 * ## Nothing imports this today (2026-09-01)
 *
 * Its only caller was the "Money over time" card on the Income & Expense page,
 * removed at the owner's request — the header of `routes/finance/CashflowPage.tsx`
 * carries the reasoning. This file is kept rather than deleted, because that
 * call was a judgement about one page's data (a handful of sales a day leaves
 * the daily buckets mostly zero) and not about this component, and because it
 * is the only charting primitive in the app — there is no chart library in
 * `apps/web`, by the deliberate choice described below. Keeping it costs
 * nothing: an unimported module is tree-shaken out of the bundle, and `tsc`
 * still checks it against the theme tokens, so it cannot rot unnoticed. The
 * props are generic — categories, series, a formatter — so the next report
 * screen that wants a line can take it as it stands. If that screen never
 * arrives, delete the file; the history has it.
 *
 * No charting library. Recharts, AntV G2 and the rest are 150–400kB for one
 * chart on one page, and every one of them wants its own theme configuration
 * beside antd's. This draws four polylines and an axis; that is a hundred lines
 * of SVG, not a dependency.
 *
 * The palette, the marks and the interaction follow the house data-viz rules:
 *
 * - **Categorical hues in fixed order, never cycled.** Slots 1–4 are blue,
 *   orange, aqua, yellow, in that order, and a series keeps its slot when the
 *   others are switched off — colour follows the entity, not its rank, so
 *   hiding "Income" must not repaint "Expenses" in Income's blue.
 * - **Both palettes are chosen, not flipped.** The dark column is the same four
 *   hues re-stepped for a dark surface and validated against it.
 * - **Direct labels are mandatory at four series**, and two of the light-mode
 *   hues sit under 3:1 against white, which obliges visible labels or a table
 *   view. This ships both: a value at the end of every visible line, and the
 *   movements table underneath on the page itself.
 * - **Text never wears the series colour** — labels and the tooltip's numbers
 *   use antd's text tokens; a short stroke of the series colour carries
 *   identity beside them.
 * - **One axis.** Every series here is rupiah, so they share a scale. If a
 *   measure in different units is ever wanted, it gets its own chart.
 */
import { useMemo, useRef, useState } from "react";
import { Checkbox, Flex, Typography, theme } from "antd";
import { SPACE, TYPE } from "../theme/tokens";
import { useColorScheme } from "../theme/useColorScheme";

/** Categorical slots 1–4, light and dark, from the validated house palette. */
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
} as const;

export interface ChartSeries {
  key: string;
  label: string;
  /** One value per category, same length and order as `categories`. */
  values: number[];
}

export interface TimeSeriesChartProps {
  /** X labels, oldest first. */
  categories: string[];
  series: ChartSeries[];
  /** How a value is written in the tooltip, the axis and the end labels. */
  format: (n: number) => string;
  /** Compact axis text for the y ticks; falls back to `format`. */
  formatTick?: (n: number) => string;
  height?: number;
}

const PAD = { top: 16, right: 92, bottom: 28, left: 76 };

/** Round a domain out to clean tick values, so the axis reads 0 / 5M / 10M. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) out.push(v);
  return out;
}

export function TimeSeriesChart({
  categories,
  series,
  format,
  formatTick,
  height = 280,
}: TimeSeriesChartProps) {
  const { resolved } = useColorScheme();
  const {
    token: {
      colorBgContainer,
      colorBorderSecondary,
      colorText,
      colorTextSecondary,
      colorTextTertiary,
    },
  } = theme.useToken();
  const palette = SERIES_COLORS[resolved];

  // Hidden rather than filtered: a series keeps its slot index while off, which
  // is what stops the remaining lines changing colour when one is unticked.
  const [hidden, setHidden] = useState<string[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const visible = series.filter((s) => !hidden.includes(s.key));
  const colorFor = (key: string) =>
    palette[series.findIndex((s) => s.key === key) % palette.length]!;

  const width = 900; // viewBox units; the SVG scales to its container.
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const { ticks, yMin, yMax } = useMemo(() => {
    const all = visible.flatMap((s) => s.values);
    // A zero baseline always in view: a cashflow line that never touches zero
    // makes a 2% wobble look like a collapse.
    const lo = Math.min(0, ...all);
    const hi = Math.max(0, ...all);
    const t = niceTicks(lo, hi === lo ? lo + 1 : hi);
    return { ticks: t, yMin: Math.min(...t, lo), yMax: Math.max(...t, hi) };
  }, [visible]);

  const x = (i: number) =>
    PAD.left +
    (categories.length <= 1
      ? plotW / 2
      : (i / (categories.length - 1)) * plotW);
  const y = (v: number) =>
    PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  /** The crosshair snaps to the nearest category, so the reader aims at a date. */
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || categories.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = (px - PAD.left) / (plotW || 1);
    const i = Math.round(ratio * (categories.length - 1));
    setHoverIndex(Math.max(0, Math.min(categories.length - 1, i)));
  };

  /**
   * Which x positions get a label. Thinned to ~8, and the last one wins any
   * collision with its neighbour — the most recent date is the one a reader
   * looks for, and two dates printed on top of each other are worse than one.
   */
  const tickIndices = useMemo(() => {
    if (categories.length === 0) return [];
    const step = Math.max(1, Math.ceil(categories.length / 8));
    const last = categories.length - 1;
    const picked = [];
    for (let i = 0; i <= last; i += step) picked.push(i);
    // Drop anything the final label would sit on top of, then add it.
    const minGapIndexes = Math.max(1, Math.floor(step / 2));
    return [
      ...picked.filter((i) => last - i >= minGapIndexes && i !== last),
      last,
    ];
  }, [categories.length]);

  /**
   * End-of-line labels, nudged apart.
   *
   * Two series that finish on the same value — very common here, where three of
   * the four sit at zero on a quiet day — would print their labels at the same
   * y and render as one unreadable smear. Walking the list in y order and
   * pushing each label down to clear the one above is the cheap fix, and it
   * keeps every label attached to the right line because the order is preserved.
   */
  const endLabels = useMemo(() => {
    const MIN_GAP = 13;
    const raw = visible
      .map((s) => ({
        key: s.key,
        value: s.values[s.values.length - 1] ?? 0,
        y: y(s.values[s.values.length - 1] ?? 0),
      }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < raw.length; i += 1) {
      const prev = raw[i - 1]!;
      const cur = raw[i]!;
      if (cur.y - prev.y < MIN_GAP) cur.y = prev.y + MIN_GAP;
    }
    // If the stack ran off the bottom, slide the whole group back up.
    const overflow = (raw[raw.length - 1]?.y ?? 0) - (PAD.top + plotH);
    if (overflow > 0) raw.forEach((r) => (r.y -= overflow));
    return raw;
  }, [visible, yMin, yMax, plotH]);

  const tickText = formatTick ?? format;

  return (
    <div>
      {/* The legend doubles as the filter the owner asked for: tick a category
          off and its line leaves, the rest keep their colours. */}
      <Flex gap={SPACE.lg} wrap style={{ marginBottom: SPACE.md }}>
        {series.map((s) => (
          <Checkbox
            key={s.key}
            checked={!hidden.includes(s.key)}
            onChange={(e) =>
              setHidden((h) =>
                e.target.checked ? h.filter((k) => k !== s.key) : [...h, s.key],
              )
            }
          >
            <Flex align="center" gap={SPACE.sm}>
              {/* Legends mirror the mark: a line chart's key is a stroke. */}
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 2,
                  borderRadius: 1,
                  background: colorFor(s.key),
                }}
              />
              <span style={{ color: colorText }}>{s.label}</span>
            </Flex>
          </Checkbox>
        ))}
      </Flex>

      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          role="img"
          aria-label={`${series.map((s) => s.label).join(", ")} over ${categories.length} periods`}
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            touchAction: "none",
          }}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {/* Recessive grid: hairlines in the border token, never data-weight. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke={colorBorderSecondary}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fill={colorTextTertiary}
                fontSize={11}
              >
                {tickText(t)}
              </text>
            </g>
          ))}

          {tickIndices.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fill={colorTextTertiary}
              fontSize={11}
            >
              {categories[i]}
            </text>
          ))}

          {hoverIndex !== null && (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={colorTextTertiary}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {visible.map((s) => {
            const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            return (
              <polyline
                key={s.key}
                points={points}
                fill="none"
                stroke={colorFor(s.key)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Markers only where the reader is looking. A dot on every point of
              four series is 200 dots and no signal. The surface-coloured ring is
              what keeps two crossing lines readable where they overlap. */}
          {hoverIndex !== null &&
            visible.map((s) => (
              <circle
                key={s.key}
                cx={x(hoverIndex)}
                cy={y(s.values[hoverIndex] ?? 0)}
                r={4}
                fill={colorFor(s.key)}
                stroke={colorBgContainer}
                strokeWidth={2}
              />
            ))}

          {/* Direct label at the end of every visible line — mandatory at four
              series, and the relief for the two light-mode hues that sit under
              3:1 on white. */}
          {endLabels.map((label) => (
            <text
              key={label.key}
              x={PAD.left + plotW + 8}
              y={label.y}
              dominantBaseline="middle"
              fill={colorTextSecondary}
              fontSize={11}
            >
              {tickText(label.value)}
            </text>
          ))}
        </svg>

        {hoverIndex !== null && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 0,
              // Flip to the left half once the pointer passes the middle, so
              // the readout never runs off the card.
              left: hoverIndex > categories.length / 2 ? undefined : "55%",
              right: hoverIndex > categories.length / 2 ? "55%" : undefined,
              background: colorBgContainer,
              border: `1px solid ${colorBorderSecondary}`,
              borderRadius: 6,
              padding: SPACE.sm,
              pointerEvents: "none",
              minWidth: 200,
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            }}
          >
            <Typography.Text
              style={{ fontSize: TYPE.sm, color: colorTextSecondary }}
            >
              {categories[hoverIndex]}
            </Typography.Text>
            {visible.map((s) => (
              <Flex
                key={s.key}
                justify="space-between"
                align="center"
                gap={SPACE.md}
              >
                <Flex align="center" gap={SPACE.sm}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 2,
                      borderRadius: 1,
                      background: colorFor(s.key),
                    }}
                  />
                  {/* Series name secondary, value strong: the reader already
                      knows which series they want and came for the number. */}
                  <Typography.Text
                    style={{ fontSize: TYPE.sm, color: colorTextSecondary }}
                  >
                    {s.label}
                  </Typography.Text>
                </Flex>
                <Typography.Text
                  strong
                  style={{ fontSize: TYPE.sm, color: colorText }}
                >
                  {format(s.values[hoverIndex] ?? 0)}
                </Typography.Text>
              </Flex>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
