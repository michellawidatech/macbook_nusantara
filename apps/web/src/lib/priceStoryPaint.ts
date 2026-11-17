/**
 * Paints a price list story onto a canvas — the one file of the feature that
 * touches one (`priceStoryLayout.ts` decides where everything goes).
 *
 * The preview IS this canvas, scaled down by CSS, and a download is the same
 * canvas as a PNG — one path, so what staff see is the file they post.
 *
 * Everything is drawn: the laptop is paths and gradients, not a photograph,
 * because a product photo off the web is someone else's copyright and this
 * goes on the shop's Instagram. Staff can put the shop's own photo in its
 * place (`hero`). Soft light is radial gradients, not `ctx.filter` — Safari
 * before 18 ignores a filter, and the shop posts from phones.
 */
import fontUrl from "../assets/story/PlusJakartaSans.ttf?url";
import logoUrl from "../assets/story/logo-horizontal.png";
import {
  LOGO_ASPECT,
  STORY_FONT,
  STORY_H,
  STORY_W,
  type Fill,
  type Measure,
  type StoryOp,
} from "./priceStoryLayout.js";

export interface StoryAssets {
  readonly logo: HTMLImageElement;
  /** The shop's own picture in place of the drawn laptop, when chosen. */
  readonly hero?: HTMLImageElement;
}

let fontReady: Promise<void> | undefined;

/** The typeface, once per page; drawing before it loads would fall back. */
export function loadStoryFont(): Promise<void> {
  fontReady ??= (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined")
      return;
    const face = new FontFace(STORY_FONT, `url(${fontUrl})`, {
      weight: "200 800",
    });
    document.fonts.add(await face.load());
  })().catch(() => {
    // A font that will not load still leaves a usable story in the fallback.
  });
  return fontReady;
}

/** An image from a URL, once it has decoded. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image did not load: ${src}`));
    img.src = src;
  });
}

export const loadStoryLogo = () => loadImage(logoUrl);

const fontOf = (size: number, weight: number) =>
  `${weight} ${size}px ${STORY_FONT}, "Plus Jakarta Sans", system-ui, sans-serif`;

/** `ctx.measureText` in the story's typeface. */
export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, size, weight) => {
    ctx.font = fontOf(size, weight);
    return ctx.measureText(text).width;
  };
}

function fillOf(
  ctx: CanvasRenderingContext2D,
  f: Fill,
): string | CanvasGradient {
  if (typeof f === "string") return f;
  const g =
    f.kind === "linear"
      ? ctx.createLinearGradient(f.x0, f.y0, f.x1, f.y1)
      : ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.r);
  for (const [at, color] of f.stops) g.addColorStop(at, color);
  return g;
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | readonly [number, number, number, number],
) {
  const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly (readonly [number, string])[],
) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, c] of stops) g.addColorStop(at, c);
  return g;
}

/**
 * An open MacBook, front on, with two closed lids standing behind it — the
 * composition of the owner's reference poster. Drawn in a box of `w` wide;
 * the lid is 0.72 of it, the rest is the lids peeking out on the right.
 */
export function drawLaptop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const W = Math.min(w / 1.2, h * 1.2); // the open lid's width
  const H = W * 0.655;
  const lx = x + (w - W * 1.2) / 2;
  const ly = y + (h - H) / 2 + H * 0.06;

  ctx.save();
  ctx.translate(lx + W / 2, ly + H / 2);
  ctx.rotate((-6 * Math.PI) / 180);
  ctx.translate(-(lx + W / 2), -(ly + H / 2));

  // The two closed lids standing behind, darker one furthest back.
  const lid = (dx: number, dy: number, s: number, dark: boolean) => {
    const bx = lx + W * dx;
    const by = ly + H * dy;
    const bw = W * 0.92 * s;
    const bh = H * 0.94 * s;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = W * 0.06;
    ctx.shadowOffsetY = W * 0.02;
    rounded(ctx, bx, by, bw, bh, W * 0.03);
    ctx.fillStyle = dark
      ? linear(ctx, bx, by, bx + bw, by + bh, [
          [0, "#5b6168"],
          [0.45, "#33373c"],
          [1, "#1b1d20"],
        ])
      : linear(ctx, bx, by, bx + bw, by + bh, [
          [0, "#f4f6f8"],
          [0.5, "#cfd4d8"],
          [1, "#9ea5ab"],
        ]);
    ctx.fill();
    ctx.restore();
    // A soft sheen down the metal.
    rounded(ctx, bx, by, bw, bh, W * 0.03);
    ctx.fillStyle = linear(ctx, bx, by, bx + bw, by, [
      [0, "rgba(255,255,255,0)"],
      [0.8, dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.55)"],
      [0.88, "rgba(255,255,255,0)"],
    ]);
    ctx.fill();
  };
  lid(0.26, -0.13, 0.96, true);
  lid(0.13, -0.065, 1, false);

  // Contact shadow under the base.
  const baseY = ly + H;
  ctx.save();
  ctx.translate(lx + W / 2, baseY + W * 0.045);
  ctx.scale(1, 0.07);
  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.62);
  sh.addColorStop(0, "rgba(0,0,0,0.55)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The lid: an aluminium rim round a black bezel.
  const R = W * 0.034;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = W * 0.05;
  ctx.shadowOffsetY = W * 0.015;
  rounded(ctx, lx, ly, W, H, [R, R, W * 0.004, W * 0.004]);
  ctx.fillStyle = linear(ctx, lx, ly, lx + W, ly + H, [
    [0, "#e6e9ec"],
    [0.5, "#b8bec3"],
    [1, "#8c939a"],
  ]);
  ctx.fill();
  ctx.restore();
  const rim = W * 0.0055;
  rounded(ctx, lx + rim, ly + rim, W - rim * 2, H - rim, [
    R - rim,
    R - rim,
    0,
    0,
  ]);
  ctx.fillStyle = "#0a0b0c";
  ctx.fill();

  // The screen.
  const side = W * 0.024;
  const sx = lx + side;
  const sy = ly + side;
  const sw = W - side * 2;
  const shh = H - side - W * 0.03;
  ctx.save();
  rounded(ctx, sx, sy, sw, shh, W * 0.008);
  ctx.clip();
  // Wallpaper: a sky of green over rolling bands, original to this poster.
  ctx.fillStyle = linear(ctx, sx, sy, sx + sw, sy + shh, [
    [0, "#c9f7df"],
    [0.35, "#5fd3a3"],
    [0.7, "#138a65"],
    [1, "#073f31"],
  ]);
  ctx.fillRect(sx, sy, sw, shh);
  const band = (
    yA: number,
    c1: number,
    c2: number,
    yB: number,
    stops: readonly (readonly [number, string])[],
  ) => {
    ctx.beginPath();
    ctx.moveTo(sx, sy + shh * yA);
    ctx.bezierCurveTo(
      sx + sw * 0.32,
      sy + shh * c1,
      sx + sw * 0.62,
      sy + shh * c2,
      sx + sw,
      sy + shh * yB,
    );
    ctx.lineTo(sx + sw, sy + shh);
    ctx.lineTo(sx, sy + shh);
    ctx.closePath();
    ctx.fillStyle = linear(
      ctx,
      sx,
      sy + shh * 0.3,
      sx + sw * 0.4,
      sy + shh,
      stops,
    );
    ctx.fill();
  };
  band(0.42, 0.2, 0.62, 0.3, [
    [0, "rgba(46,190,140,0.85)"],
    [1, "rgba(14,112,84,0.95)"],
  ]);
  band(0.66, 0.4, 0.86, 0.5, [
    [0, "rgba(16,128,95,0.95)"],
    [1, "rgba(8,74,57,1)"],
  ]);
  band(0.86, 0.7, 1.02, 0.72, [
    [0, "rgba(6,70,54,1)"],
    [1, "rgba(3,40,31,1)"],
  ]);
  // A highlight riding the top band's crest.
  ctx.beginPath();
  ctx.moveTo(sx, sy + shh * 0.42);
  ctx.bezierCurveTo(
    sx + sw * 0.32,
    sy + shh * 0.2,
    sx + sw * 0.62,
    sy + shh * 0.62,
    sx + sw,
    sy + shh * 0.3,
  );
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = W * 0.004;
  ctx.stroke();
  // The menu bar, barely there.
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(sx, sy, sw, W * 0.024);
  // Glare across the glass.
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + sw * 0.55, sy);
  ctx.lineTo(sx + sw * 0.18, sy + shh);
  ctx.lineTo(sx, sy + shh);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, sx, sy, sx + sw * 0.4, sy + shh * 0.6, [
    [0, "rgba(255,255,255,0.16)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  ctx.fill();
  ctx.restore();

  // The notch and its camera.
  const nw = W * 0.12;
  const nh = W * 0.028;
  rounded(ctx, lx + (W - nw) / 2, sy - 1, nw, nh, [0, 0, nh * 0.45, nh * 0.45]);
  ctx.fillStyle = "#0a0b0c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx + W / 2, sy + nh * 0.45, nh * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "#1c2733";
  ctx.fill();

  // The hinge, then the base it closes onto.
  ctx.fillStyle = "#141516";
  ctx.fillRect(lx + W * 0.04, baseY - W * 0.004, W * 0.92, W * 0.01);
  const bw = W * 1.1;
  const bx = lx - (bw - W) / 2;
  const bh = W * 0.034;
  rounded(ctx, bx, baseY + W * 0.004, bw, bh, [
    W * 0.004,
    W * 0.004,
    bh * 0.9,
    bh * 0.9,
  ]);
  ctx.fillStyle = linear(ctx, 0, baseY, 0, baseY + bh, [
    [0, "#f6f7f8"],
    [0.35, "#d3d7db"],
    [1, "#7f868d"],
  ]);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(
    bx + bw * 0.01,
    baseY + W * 0.004,
    bw * 0.98,
    Math.max(1, W * 0.002),
  );
  // The thumb notch to open it by.
  const tw = W * 0.16;
  rounded(ctx, bx + (bw - tw) / 2, baseY + W * 0.004, tw, bh * 0.38, [
    0,
    0,
    bh * 0.3,
    bh * 0.3,
  ]);
  ctx.fillStyle = linear(ctx, 0, baseY, 0, baseY + bh * 0.38, [
    [0, "#9aa1a7"],
    [1, "#c9cdd1"],
  ]);
  ctx.fill();
  ctx.restore();
}

/** The shop's own picture, contained in the box with a soft shadow. */
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

const ICONS: Record<"instagram" | "whatsapp" | "pin", string[]> = {
  instagram: [
    "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3z",
    "M12 7.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4z",
    "M17.3 6.2v.1",
  ],
  whatsapp: [
    "M4 20l1.3-4A8.5 8.5 0 1 1 8.4 19z",
    "M9 8.6c.2 2.9 3.2 6 6.4 6.4l1.1-1.4-2-1-.9.8a5 5 0 0 1-2.9-2.9l.8-.9-1-2z",
  ],
  pin: [
    "M12 21s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z",
    "M12 6.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z",
  ],
};

function paintOps(
  ctx: CanvasRenderingContext2D,
  ops: readonly StoryOp[],
  assets: StoryAssets,
) {
  for (const op of ops) {
    switch (op.kind) {
      case "rect": {
        ctx.save();
        if (op.shadow) {
          ctx.shadowColor = op.shadow.color;
          ctx.shadowBlur = op.shadow.blur;
          ctx.shadowOffsetY = op.shadow.y;
        }
        rounded(ctx, op.x, op.y, op.w, op.h, op.r ?? 0);
        if (op.fill !== undefined) {
          ctx.fillStyle = fillOf(ctx, op.fill);
          ctx.fill();
        }
        ctx.restore();
        if (op.stroke) {
          rounded(ctx, op.x, op.y, op.w, op.h, op.r ?? 0);
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lineWidth ?? 1;
          ctx.stroke();
        }
        break;
      }
      case "circle":
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fillStyle = fillOf(ctx, op.fill);
        ctx.fill();
        break;
      case "line":
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(op.dash ? [...op.dash] : []);
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.stroke();
        ctx.restore();
        break;
      case "text": {
        ctx.save();
        ctx.font = fontOf(op.size, op.weight);
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align ?? "left";
        ctx.textBaseline = "alphabetic";
        if (op.spacing !== undefined && "letterSpacing" in ctx)
          (ctx as { letterSpacing: string }).letterSpacing = `${op.spacing}px`;
        ctx.fillText(op.text, op.x, op.y);
        if (op.strike) {
          const w = ctx.measureText(op.text).width;
          const x0 =
            op.align === "right"
              ? op.x - w
              : op.align === "center"
                ? op.x - w / 2
                : op.x;
          ctx.fillRect(
            x0,
            op.y - op.size * 0.33,
            w,
            Math.max(1.5, op.size * 0.09),
          );
        }
        ctx.restore();
        break;
      }
      case "dots":
        ctx.fillStyle = op.color;
        for (let y = op.gap / 2; y < STORY_H; y += op.gap) {
          for (let x = op.gap / 2; x < STORY_W; x += op.gap) {
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case "clip":
        ctx.save();
        rounded(ctx, op.x, op.y, op.w, op.h, op.r);
        ctx.clip();
        paintOps(ctx, op.ops, assets);
        ctx.restore();
        break;
      case "logo":
        ctx.drawImage(assets.logo, op.x, op.y, op.h * LOGO_ASPECT, op.h);
        break;
      case "hero":
        if (assets.hero) drawPhoto(ctx, assets.hero, op.x, op.y, op.w, op.h);
        else drawLaptop(ctx, op.x, op.y, op.w, op.h);
        break;
      case "icon": {
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.scale(op.size / 24, op.size / 24);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = 1.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const [outline, ...rest] = ICONS[op.name];
        ctx.stroke(new Path2D(outline));
        rest.forEach((d, i) => {
          if (op.name === "whatsapp" && i === 0) {
            ctx.fillStyle = op.color;
            ctx.fill(new Path2D(d));
          } else {
            ctx.stroke(new Path2D(d));
          }
        });
        ctx.restore();
        break;
      }
    }
  }
}

/** Paint one page onto a 1080 × 1920 canvas. */
export function paintStory(
  canvas: HTMLCanvasElement,
  ops: readonly StoryOp[],
  assets: StoryAssets,
): void {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, STORY_W, STORY_H);
  paintOps(ctx, ops, assets);
}

/** A canvas as a PNG file. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no image"))),
      "image/png",
    ),
  );
}
