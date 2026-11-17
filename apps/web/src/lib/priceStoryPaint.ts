/**
 * Paints a price list story onto a canvas — the one file of the feature that
 * touches one (`priceStoryLayout.ts` decides where everything goes).
 *
 * The preview IS this canvas, scaled down by CSS, and a download is the same
 * canvas as a PNG — one path, so what staff see is the file they post.
 *
 * The laptop is the product photo the owner supplied (2026-11-17, "use
 * this"), its white background cut away so it sits on the green card; staff
 * can put the shop's own photo in its place (`hero`). Soft light is radial
 * gradients, not `ctx.filter` — Safari before 18 ignores a filter, and the
 * shop posts from phones.
 */
import fontUrl from "../assets/story/PlusJakartaSans.ttf?url";
import logoUrl from "../assets/story/logo-horizontal.png";
import laptopUrl from "../assets/story/laptop.png";
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
  /** The MacBook the owner chose (2026-11-17), cut out of its white. */
  readonly laptop: HTMLImageElement;
  /** The shop's own picture in place of the laptop, when chosen. */
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
export const loadStoryLaptop = () => loadImage(laptopUrl);

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
        drawPhoto(ctx, assets.hero ?? assets.laptop, op.x, op.y, op.w, op.h);
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
