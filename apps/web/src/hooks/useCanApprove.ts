/**
 * May the signed-in person commit an edit or a delete of money themselves —
 * `Staff.canApprove` (2026-11-13)? Everybody else gets *Request edit* /
 * *Request delete* in place of Edit / Delete, and the API refuses the edit
 * itself (`apps/api/src/auth/approvalScope.ts`): this is the courtesy, the
 * server is the control.
 *
 * Provided by `AppLayout` from the session. Without a provider it answers
 * TRUE — the page suites render screens on their own, with no session, and
 * they test the approver's flow that every screen had before; a test of the
 * request flow wraps the page in `<CanApproveContext.Provider value={false}>`.
 * In the app a page is only ever drawn inside `AppLayout`, after the session
 * answered (App.tsx).
 */
import { createContext, useContext } from "react";

export const CanApproveContext = createContext<boolean>(true);

export function useCanApprove(): boolean {
  return useContext(CanApproveContext);
}
