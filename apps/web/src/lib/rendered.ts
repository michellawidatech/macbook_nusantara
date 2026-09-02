/**
 * Resolves once the browser has painted.
 *
 * Both scan-driven grids need this for the same reason: their handlers read
 * `rows`/`draft` out of the render closure, so a burst of scans that resolved
 * inside one frame would every time pick the same "first empty row" and each
 * scan would overwrite the last. The scanner's queue awaits the handler, so
 * awaiting this between fills is what makes fifty scans land on fifty rows.
 *
 * Falls back to a task when there is no frame loop — jsdom, and any test that
 * drives the scanner without rendering.
 */
export function rendered(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
