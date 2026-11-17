/**
 * Where everything on a price list story goes — design E, "Modern", the one
 * the owner chose on 2026-11-17 — as a list of drawing operations in poster
 * pixels (1080 × 1920, an Instagram story).
 *
 * Pure: it never touches a canvas. Text is measured through `measure`, which
 * the dialog binds to `ctx.measureText` and a test binds to a fixed-width
 * fake, so a name too long for its card is cut here, where a test can see it,
 * rather than overflowing on a phone nobody tested. `priceStoryPaint.ts`
 * turns the operations into pixels.
 */
import {
  nowText,
  dots,
  type StoryGroup,
  type StoryTexts,
} from "./priceStory.js";

export const STORY_W = 1080;
export const STORY_H = 1920;

/** Width over height of the shop's horizontal logo (5263 × 1403). */
export const LOGO_ASPECT = 5263 / 1403;

/** The typeface every word is set in (bundled, SIL OFL — see the assets). */
export const STORY_FONT = "StoryJakarta";

export type Fill =
  | string
  | {
      readonly kind: "linear";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly stops: readonly (readonly [number, string])[];
    }
  | {
      readonly kind: "radial";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly stops: readonly (readonly [number, string])[];
    };

export interface Shadow {
  readonly color: string;
  readonly blur: number;
  readonly y: number;
}

export type StoryOp =
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly r?: number;
      readonly fill?: Fill;
      readonly stroke?: string;
      readonly lineWidth?: number;
      readonly shadow?: Shadow;
    }
  | {
      readonly kind: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill: Fill;
    }
  | {
      readonly kind: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly color: string;
      readonly width: number;
      readonly dash?: readonly number[];
    }
  | {
      readonly kind: "text";
      readonly x: number;
      /** The alphabetic baseline. */
      readonly y: number;
      readonly text: string;
      readonly size: number;
      readonly weight: number;
      readonly color: string;
      readonly align?: "left" | "right" | "center";
      readonly spacing?: number;
      readonly strike?: boolean;
    }
  | { readonly kind: "dots"; readonly gap: number; readonly color: string }
  | {
      /** Its children, clipped to a rounded rectangle. */
      readonly kind: "clip";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly r: number;
      readonly ops: readonly StoryOp[];
    }
  | {
      readonly kind: "logo";
      readonly x: number;
      readonly y: number;
      readonly h: number;
    }
  | {
      /** The hero picture: the drawn laptop, or the shop's own photo. */
      readonly kind: "hero";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | {
      readonly kind: "icon";
      readonly name: "instagram" | "whatsapp" | "pin";
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly color: string;
    };

/** Width of `text` at `size` px and `weight`, in poster pixels. */
export type Measure = (text: string, size: number, weight: number) => number;

const C = {
  page: "#f2f5f3",
  dot: "rgba(11,63,46,0.08)",
  ink: "#0f1f19",
  green: "#0f5c40",
  lime: "#b7f36b",
  mute: "#5c6f66",
  struck: "#93a39b",
  chip: "#eef3f0",
  chipInk: "#2e4239",
  card: "#ffffff",
  cardLine: "#e6ece9",
  rule: "#dfe6e2",
  heroSub: "#d4ecdf",
};

/** The card list: where it starts, how much room it has, its spacing. */
export const LIST = {
  top: 760,
  bottom: 1760,
  gap: 14,
  /** Card padding above the name, the name line, and below the last row. */
  head: 62,
  row: 57,
  foot: 8,
};

/** How tall a product's card is with `rows` variants. */
export const cardHeight = (rows: number) =>
  LIST.head + rows * LIST.row + LIST.foot;

/** The room the list has on one page. */
export const LIST_ROOM = LIST.bottom - LIST.top;

/** Cut `text` to fit `max` px, with an ellipsis when it had to be cut. */
export function fit(
  text: string,
  max: number,
  size: number,
  weight: number,
  measure: Measure,
): string {
  if (measure(text, size, weight) <= max) return text;
  let s = text;
  while (s.length > 0 && measure(`${s}…`, size, weight) > max)
    s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Break `text` into at most `lines` lines of `max` px; the last is cut. */
export function wrap(
  text: string,
  max: number,
  size: number,
  weight: number,
  measure: Measure,
  lines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  let i = 0;
  for (; i < words.length; i += 1) {
    const next = cur === "" ? words[i]! : `${cur} ${words[i]}`;
    if (measure(next, size, weight) <= max || cur === "") {
      cur = next;
    } else {
      out.push(cur);
      cur = words[i]!;
      if (out.length === lines - 1) break;
    }
  }
  const rest = [cur, ...words.slice(i + 1)].filter(Boolean).join(" ");
  if (rest !== "") out.push(fit(rest, max, size, weight, measure));
  return out.slice(0, lines);
}

/** A pill with its words centred: returns its ops and its width. */
function pill(
  x: number,
  y: number,
  text: string,
  o: {
    size: number;
    weight: number;
    padX: number;
    h: number;
    fill: string;
    stroke?: string;
    color: string;
    spacing?: number;
    align?: "left" | "right";
  },
  measure: Measure,
): { ops: StoryOp[]; w: number } {
  const tw =
    measure(text, o.size, o.weight) +
    (o.spacing ?? 0) * Math.max(0, text.length - 1);
  const w = tw + o.padX * 2;
  const left = o.align === "right" ? x - w : x;
  return {
    w,
    ops: [
      {
        kind: "rect",
        x: left,
        y,
        w,
        h: o.h,
        r: o.h / 2,
        fill: o.fill,
        ...(o.stroke ? { stroke: o.stroke, lineWidth: 1.5 } : {}),
      },
      {
        kind: "text",
        x: left + w / 2,
        y: y + o.h / 2 + o.size * 0.36,
        text,
        size: o.size,
        weight: o.weight,
        color: o.color,
        align: "center",
        ...(o.spacing ? { spacing: o.spacing } : {}),
      },
    ],
  };
}

/** The comma-separated chips, trimmed, empties dropped. */
export const chipsOf = (s: string) =>
  s
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

/** One page of the story. `page` and `pages` are 1-based. */
export function layoutStory(
  groups: readonly StoryGroup[],
  texts: StoryTexts,
  page: number,
  pages: number,
  measure: Measure,
): StoryOp[] {
  const ops: StoryOp[] = [
    { kind: "rect", x: 0, y: 0, w: STORY_W, h: STORY_H, fill: C.page },
    { kind: "dots", gap: 28, color: C.dot },
  ];

  // ---- the green card --------------------------------------------------
  const hero = { x: 48, y: 48, w: 984, h: 622, r: 44 };
  ops.push({
    kind: "rect",
    ...hero,
    fill: {
      kind: "linear",
      x0: hero.x,
      y0: hero.y,
      x1: hero.x + hero.w,
      y1: hero.y + hero.h,
      stops: [
        [0, "#0a3326"],
        [0.55, "#0f5c40"],
        [1, "#169064"],
      ],
    },
    shadow: { color: "rgba(11,63,46,0.35)", blur: 60, y: 24 },
  });
  const inner: StoryOp[] = [
    {
      kind: "circle",
      cx: hero.x + hero.w - 40,
      cy: hero.y + 40,
      r: 380,
      fill: {
        kind: "radial",
        cx: hero.x + hero.w - 40,
        cy: hero.y + 40,
        r: 380,
        stops: [
          [0, "rgba(183,243,107,0.42)"],
          [1, "rgba(183,243,107,0)"],
        ],
      },
    },
    {
      kind: "circle",
      cx: hero.x + 40,
      cy: hero.y + hero.h + 20,
      r: 360,
      fill: {
        kind: "radial",
        cx: hero.x + 40,
        cy: hero.y + hero.h + 20,
        r: 360,
        stops: [
          [0, "rgba(227,181,76,0.38)"],
          [1, "rgba(227,181,76,0)"],
        ],
      },
    },
    // The picture first, so the words sit over its edge rather than under it.
    { kind: "hero", x: 580, y: 190, w: 440, h: 380 },
    { kind: "logo", x: hero.x + 52, y: hero.y + 46, h: 78 },
  ];
  const left = hero.x + 52;
  if (texts.promo.trim() !== "") {
    const promo = fit(texts.promo.trim(), 500, 21, 700, measure);
    const chip = pill(
      left,
      hero.y + 156,
      promo,
      {
        size: 21,
        weight: 700,
        padX: 22,
        h: 48,
        fill: "rgba(255,255,255,0.12)",
        stroke: "rgba(255,255,255,0.25)",
        color: "#ffffff",
        spacing: 2,
      },
      measure,
    );
    inner.push(...chip.ops);
  }
  // The headline: as big as fits beside the picture, 140px at most.
  const headline = [texts.titleTop.trim(), texts.titleBottom.trim()];
  let size = 140;
  while (size > 72 && headline.some((l) => measure(l, size, 800) > 520))
    size -= 4;
  const lineH = size * 0.92;
  let base = hero.y + 220 + size * 0.78;
  headline.forEach((line, i) => {
    if (line === "") return;
    inner.push({
      kind: "text",
      x: left - 4,
      y: base + i * lineH,
      text: fit(line, 540, size, 800, measure),
      size,
      weight: 800,
      color: i === 0 ? "#ffffff" : C.lime,
      spacing: -size * 0.04,
    });
  });
  base += lineH + 66;
  for (const [i, line] of wrap(
    texts.subtitle.trim(),
    450,
    28,
    500,
    measure,
    2,
  ).entries()) {
    inner.push({
      kind: "text",
      x: left,
      y: base + i * 37,
      text: line,
      size: 28,
      weight: 500,
      color: C.heroSub,
    });
  }
  // The chips, right-aligned at the foot of the card.
  let cx = hero.x + hero.w - 40;
  for (const c of chipsOf(texts.chips).slice(0, 3).reverse()) {
    const chip = pill(
      cx,
      hero.y + hero.h - 34 - 44,
      fit(c, 260, 18, 600, measure),
      {
        size: 18,
        weight: 600,
        padX: 16,
        h: 44,
        fill: "rgba(255,255,255,0.14)",
        stroke: "rgba(255,255,255,0.22)",
        color: "#ffffff",
        align: "right",
      },
      measure,
    );
    inner.push(...chip.ops);
    cx -= chip.w + 10;
  }
  ops.push({ kind: "clip", ...hero, ops: inner });

  // ---- the list --------------------------------------------------------
  if (texts.listTitle.trim() !== "") {
    ops.push({
      kind: "text",
      x: 56,
      y: 738,
      text: fit(texts.listTitle.trim(), 640, 34, 700, measure),
      size: 34,
      weight: 700,
      color: C.ink,
    });
  }
  if (pages > 1) {
    ops.push({
      kind: "text",
      x: STORY_W - 56,
      y: 738,
      text: `Halaman ${page} / ${pages}`,
      size: 21,
      weight: 600,
      color: C.mute,
      align: "right",
    });
  }
  let y = LIST.top;
  const cardX = 48;
  const cardW = 984;
  const padX = 28;
  for (const g of groups) {
    const h = cardHeight(g.rows.length);
    ops.push({
      kind: "rect",
      x: cardX,
      y,
      w: cardW,
      h,
      r: 28,
      fill: C.card,
      stroke: C.cardLine,
      lineWidth: 1.5,
      shadow: { color: "rgba(11,63,46,0.10)", blur: 30, y: 10 },
    });
    ops.push({
      kind: "text",
      x: cardX + padX,
      y: y + 47,
      text: fit(g.name, cardW - padX * 2, 28, 700, measure),
      size: 28,
      weight: 700,
      color: C.ink,
    });
    g.rows.forEach((r, i) => {
      const top = y + LIST.head + i * LIST.row;
      ops.push({
        kind: "line",
        x1: cardX + padX,
        y1: top,
        x2: cardX + cardW - padX,
        y2: top,
        color: C.rule,
        width: 1.5,
        dash: [5, 5],
      });
      const mid = top + LIST.row / 2;
      // The price, right to left: what it is now, then what it was.
      const right = cardX + cardW - padX;
      const now = nowText(r);
      ops.push({
        kind: "text",
        x: right,
        y: mid + 10,
        text: now,
        size: 29,
        weight: 700,
        color: C.green,
        align: "right",
      });
      let priceLeft = right - measure(now, 29, 700);
      if (r.before !== undefined) {
        const was = `Rp ${dots(r.before)}`;
        ops.push({
          kind: "text",
          x: priceLeft - 14,
          y: mid + 8,
          text: was,
          size: 18,
          weight: 500,
          color: C.struck,
          align: "right",
          strike: true,
        });
        priceLeft -= 14 + measure(was, 18, 500);
      }
      // The specs as chips, as many as fit before the price; NEW after them.
      let x = cardX + padX;
      const limit = priceLeft - 24;
      const chips = r.spec === "" ? [] : r.spec.split(" | ");
      for (const c of chips) {
        const w = measure(c, 20, 600) + 28;
        if (x + w > limit) {
          ops.push(
            ...pill(
              x,
              mid - 19,
              "…",
              {
                size: 20,
                weight: 600,
                padX: 12,
                h: 38,
                fill: C.chip,
                color: C.chipInk,
              },
              measure,
            ).ops,
          );
          x = limit;
          break;
        }
        const p = pill(
          x,
          mid - 19,
          c,
          {
            size: 20,
            weight: 600,
            padX: 14,
            h: 38,
            fill: C.chip,
            color: C.chipInk,
          },
          measure,
        );
        ops.push(...p.ops);
        x += p.w + 8;
      }
      if (r.isNew && x + 80 <= limit) {
        ops.push(
          ...pill(
            x + 4,
            mid - 15,
            "NEW",
            {
              size: 15,
              weight: 800,
              padX: 12,
              h: 30,
              fill: C.lime,
              color: C.ink,
              spacing: 1,
            },
            measure,
          ).ops,
        );
      }
    });
    y += h + LIST.gap;
  }

  // ---- the footer ------------------------------------------------------
  const foot = { x: 48, y: 1784, w: 984, h: 92 };
  ops.push({ kind: "rect", ...foot, r: 46, fill: C.ink });
  const items = [
    { icon: "instagram" as const, text: texts.instagram.trim() },
    { icon: "whatsapp" as const, text: texts.whatsapp.trim() },
    { icon: "pin" as const, text: texts.location.trim() },
  ].filter((i) => i.text !== "");
  const slot = foot.w / Math.max(1, items.length);
  items.forEach((it, i) => {
    const words = fit(it.text, slot - 90, 24, 600, measure);
    const w = 34 + 12 + measure(words, 24, 600);
    const x0 = foot.x + slot * i + (slot - w) / 2;
    const cy = foot.y + foot.h / 2;
    ops.push({
      kind: "icon",
      name: it.icon,
      x: x0,
      y: cy - 17,
      size: 34,
      color: C.lime,
    });
    ops.push({
      kind: "text",
      x: x0 + 46,
      y: cy + 9,
      text: words,
      size: 24,
      weight: 600,
      color: "#ffffff",
    });
    if (i > 0) {
      ops.push({
        kind: "line",
        x1: foot.x + slot * i,
        y1: cy - 17,
        x2: foot.x + slot * i,
        y2: cy + 17,
        color: "rgba(255,255,255,0.19)",
        width: 1.5,
      });
    }
  });
  return ops;
}
