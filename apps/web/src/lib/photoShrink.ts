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

/** The photo to store, as a data URL and its size in bytes. */
export async function shrinkPhoto(
  file: File,
): Promise<{ url: string; bytes: number }> {
  const original = async () => ({
    url: await dataUrlOf(file),
    bytes: file.size,
  });
  if (typeof createImageBitmap !== "function") return original();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return original();
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return original();
    // JPEG has no transparency: a screenshot's clear pixels would go black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    // Already small, and re-encoding only made it bigger: keep what came.
    if (blob === null || blob.size >= file.size) return original();
    return { url: await dataUrlOf(blob), bytes: blob.size };
  } catch {
    return original();
  } finally {
    bitmap.close();
  }
}
