/**
 * A donut with a legend, drawn as inline SVG — the same no-library choice
 * `TimeSeriesChart` explains, and the same palette, extended by one hue.
 * First used by Income & Expense's expense breakdown (owner ask 2026-10-23).
 *
 * - Slices keep their order (largest first, as given) and their colour slot;
 *   a slice called "Other" is always neutral grey, because it is not one
 *   thing and should not look like one.
 * - Text never wears the slice colour: the legend's names and figures use
 *   antd's text tokens, with a swatch beside them for identity.
 * - The legend carries every figure, so the chart reads without hovering.
 */
import { useContext } from "react";
import { Flex, Typography, theme } from "antd";
import { SPACE } from "../theme/tokens";
import { ColorSchemeContext } from "../theme/context";

const SLICE_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#8a5cd6"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#9b70e0"],
} as const;
const OTHER_COLOR = { light: "#9aa1a9", dark: "#6b727a" } as const;

export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Drawn grey: the folded-together remainder. */
  readonly other?: boolean;
}

export function DonutChart({
  slices,
  format,
  centre,
  size = 200,
  emptyText,
}: {
  readonly slices: readonly DonutSlice[];
  readonly format: (n: number) => string;
  /** The figure in the hole — usually the total. */
  readonly centre?: string;
  readonly size?: number;
  readonly emptyText: string;
}) {
  // Light outside a ThemeProvider (a page rendered bare in a test) rather
  // than a throw: a chart is never the reason a screen should fail.
  const resolved = useContext(ColorSchemeContext)?.resolved ?? "light";
  const {
    token: { colorText, colorTextSecondary, colorFillSecondary },
  } = theme.useToken();
  const total = slices.reduce((n, s) => n + Math.max(0, s.value), 0);
  const colorOf = (i: number, s: DonutSlice) =>
    s.other
      ? OTHER_COLOR[resolved]
      : SLICE_COLORS[resolved][i % SLICE_COLORS[resolved].length]!;

  const r = 80;
  const stroke = 28;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <Flex wrap gap={SPACE.lg} align="center">
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        role="img"
        aria-label={slices
          .map((s) => `${s.label} ${format(s.value)}`)
          .join(", ")}
      >
        <circle
          cx={100}
          cy={100}
          r={r}
          fill="none"
          stroke={colorFillSecondary}
          strokeWidth={stroke}
        />
        {total > 0 &&
          slices.map((s, i) => {
            const len = (Math.max(0, s.value) / total) * c;
            const el = (
              <circle
                key={s.key}
                cx={100}
                cy={100}
                r={r}
                fill="none"
                stroke={colorOf(i, s)}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
              />
            );
            offset += len;
            return el;
          })}
        {centre !== undefined && (
          <text
            x={100}
            y={106}
            textAnchor="middle"
            fontSize={15}
            fontWeight={600}
            fill={colorText}
          >
            {centre}
          </text>
        )}
      </svg>
      <Flex vertical gap={SPACE.xs} style={{ minWidth: 200, flex: 1 }}>
        {total === 0 ? (
          <Typography.Text type="secondary">{emptyText}</Typography.Text>
        ) : (
          slices.map((s, i) => (
            <Flex key={s.key} align="center" gap={SPACE.sm}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colorOf(i, s),
                  flex: "none",
                }}
              />
              <span style={{ flex: 1, color: colorText }}>{s.label}</span>
              <span
                style={{
                  color: colorTextSecondary,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round((Math.max(0, s.value) / total) * 100)}%
              </span>
              <span
                style={{
                  color: colorText,
                  minWidth: 120,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {format(s.value)}
              </span>
            </Flex>
          ))
        )}
      </Flex>
    </Flex>
  );
}
