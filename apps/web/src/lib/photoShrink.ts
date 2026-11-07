/**
 * A QC photo, made the size a QC photo needs to be (client report 2026-10-21:
 * a photo uploaded and then refreshed was gone).
 *
 * A phone hands over its photo as taken — 4000 pixels across and several
 * megabytes — and it travels as a data URL, a third bigger again. That much
 * text took long enough to send that a refresh landed in the middle of it, and
 * an inbound row's photo held before its serial did not fit in the few
 * megabytes `localStorage` has at all. A dent on a lid reads perfectly at
 * 1600 pixels, which is a twentieth of the bytes.
 *
 * Where the browser cannot decode the file (HEIC on a desktop browser, or
 * jsdom, which has no `createImageBitmap`), the original is kept, exactly as
 * before this existed.
 */

/** The long edge of a stored photo, in pixels. */
export const PHOTO_MAX_EDGE = 1600;

/** JPEG quality for a shrunk photo. */
export const PHOTO_QUALITY = 0.82;

/** `width` × `height` scaled down so neither edge passes `max`. Never up. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Types every browser draws in an `<img>`. A file of one of these that the
 * browser still cannot decode to shrink (an enormous JPEG on a phone short of
 * memory) is kept as it came, exactly as before — it will still display.
 */
const WEB_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Extensions read as a photo when the browser hands over no type at all — a
 * file AirDropped from an iPhone onto a desktop often arrives with `type: ""`.
 */
const PHOTO_EXTENSION = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

/** The largest photo kept, in bytes, measured AFTER shrinking. */
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/**
 * Why one picked file was not added (client report 2026-11-07: of ten photos
 * picked, nine were saved). The server stores every photo it is sent; the one
 * that went missing was skipped HERE, with a toast gone in four seconds.
 * Each reason is something the person can act on, so the picker names the
 * file and the reason and waits to be read.
 */
export type PhotoProblem =
  /** Not a picture at all — a Live Photo's video, an iPhone `.AAE` edit file. */
  | "not-image"
  /**
   * A picture that cannot be opened at all. An iPhone HEIC in Chrome is
   * CONVERTED (`decodeHeic`); this is what is left when even that fails. It
   * used to be stored as it came and drawn as a broken thumbnail on every
   * screen that showed it.
   */
  | "unreadable"
  /** Readable, but still over `PHOTO_MAX_BYTES` once shrunk. */
  | "too-big";

export type PhotoRead =
  | { readonly ok: true; readonly url: string; readonly bytes: number }
  | { readonly ok: false; readonly problem: PhotoProblem };

/** Whether a picked file is a picture, by its type or, lacking one, its name. */
export function looksLikePhoto(file: { type: string; name: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  return file.type === "" && PHOTO_EXTENSION.test(file.name);
}

/** The photo to store, or why it cannot be. */
export async function readPhoto(file: File): Promise<PhotoRead> {
  if (!looksLikePhoto(file)) return { ok: false, problem: "not-image" };
  let shrunk: Awaited<ReturnType<typeof shrinkPhoto>>;
  try {
    shrunk = await shrinkPhoto(file);
  } catch {
    // The file could not even be read off the disk — an iCloud photo not
    // downloaded to this Mac yet, a file moved away mid-pick. One file's
    // failure, not the pick's: it used to reject the whole `choose`, every
    // tile spun for ever and none of the others were saved.
    return { ok: false, problem: "unreadable" };
  }
  if (shrunk === "unreadable") return { ok: false, problem: "unreadable" };
  if (shrunk.bytes > PHOTO_MAX_BYTES) return { ok: false, problem: "too-big" };
  return { ok: true, ...shrunk };
}

/** An iPhone photo's container — by type, or by name when the type is blank. */
export function isHeicFile(file: { type: string; name: string }): boolean {
  return (
    /^image\/hei[cf](-sequence)?$/i.test(file.type) ||
    /\.hei[cf]$/i.test(file.name)
  );
}

/**
 * A HEIC decoded in the browser, for one this browser cannot open itself —
 * Chrome cannot; Safari can, and never gets here. `heic-to` is libheif in
 * WebAssembly, about 0.8MB gzipped, so it is a separate chunk fetched the
 * first time one is needed rather than part of every page load (owner
 * decision 2026-11-07). `undefined` when it cannot be decoded either.
 */
async function decodeHeic(file: File): Promise<ImageBitmap | undefined> {
  try {
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap" });
  } catch {
    return undefined;
  }
}

/**
 * The photo shrunk, as a data URL and its size in bytes — or `"unreadable"`
 * when the browser could not decode it and could not draw it either.
 */
export async function shrinkPhoto(
  file: File,
): Promise<{ url: string; bytes: number } | "unreadable"> {
  const original = async () => ({
    url: await dataUrlOf(file),
    bytes: file.size,
  });
  // A JPEG kept as it came still displays; a HEIC kept as it came is a broken
  // thumbnail in Chrome on every screen that shows it.
  const asItCame = () =>
    WEB_TYPES.has(file.type)
      ? original()
      : Promise.resolve("unreadable" as const);
  if (typeof createImageBitmap !== "function") return original();
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = isHeicFile(file) ? await decodeHeic(file) : undefined;
  }
  if (bitmap === undefined) return asItCame();
  // Re-encoded below, so a converted HEIC must not fall back to its original.
  const converted = !WEB_TYPES.has(file.type);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return asItCame();
    // JPEG has no transparency: a screenshot's clear pixels would go black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    if (blob === null) return asItCame();
    // Already small, and re-encoding only made it bigger: keep what came —
    // unless what came is a format the page cannot draw.
    if (blob.size >= file.size && !converted) return original();
    return { url: await dataUrlOf(blob), bytes: blob.size };
  } catch {
    return asItCame();
  } finally {
    bitmap.close();
  }
}
