/**
 * A page declares what a scan means to it.
 *
 * The handler is held in a ref and the registration is made once, so a page
 * that re-renders on every keystroke — which the scan-heavy ones do — does not
 * churn the scanner's target stack. The stack is last-in-wins, so a modal that
 * registers a target takes scans from the page behind it and hands them back
 * when it closes.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getScannerStatus,
  registerScanTarget,
  subscribeScannerStatus,
  type ScanHandler,
  type ScannerStatus,
} from "../lib/scanner.js";

export function useScanTarget(handler: ScanHandler): void {
  const ref = useRef(handler);
  // Assigned in an effect rather than during render: a render that is thrown
  // away must not leave its handler behind as the live one.
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => registerScanTarget((serial) => ref.current(serial)), []);
}

export function useScannerStatus(): ScannerStatus {
  return useSyncExternalStore(subscribeScannerStatus, getScannerStatus);
}
