import { createContext, useContext } from "react";
import type { Staff } from "../lib/session.js";

/**
 * Who is signed in, for a page that needs more than `canApprove`
 * (2026-11-16: the phone's More screen draws the account card and the menu
 * this person may see). `AppLayout` provides it; `null` outside the shell —
 * a test rendering one page — and a reader falls back to the narrowest view.
 */
export const StaffContext = createContext<Staff | null>(null);

export function useStaff(): Staff | null {
  return useContext(StaffContext);
}
