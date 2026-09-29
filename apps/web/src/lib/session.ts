/**
 * Who is signed in.
 *
 * Server data, so it lives in TanStack Query (01 §5) keyed by section — not in
 * a bespoke context that a second copy could disagree with.
 *
 * Since 2026-09-18 sign-in is the app's own (Auth0 is gone): a form posts to
 * `/api/auth/login`, and an account still on a password somebody else chose —
 * the shop's initial one, or an owner's reset — comes back with
 * `mustChangePassword`, which `App` answers with the change-password screen
 * and nothing else. The API enforces the same thing per request (403
 * GANTI_SANDI); the screen is the courtesy, never the control.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, ApiRequestError, onApiRefusal } from "./api.js";

export interface Staff {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
  /** On a password somebody else chose: may do nothing but choose a new one. */
  readonly mustChangePassword: boolean;
}

export const sessionKey = ["auth", "me"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        const { staff } = await api<{ staff: Staff }>("/api/auth/me");
        return staff;
      } catch (e) {
        // Not signed in is an answer, not a failure: it must not retry or
        // surface as an error screen.
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Keep the session answer honest when some OTHER request finds out first.
 *
 * A session can end under a page that is open — it expired after twelve hours,
 * an owner reset the password, somebody pressed "sign out everywhere" on
 * another device — and the store's next poll is what hears about it. Without
 * this the page just stops saving; with it, a 401 anywhere drops the person on
 * the sign-in screen and a 403 GANTI_SANDI on the change-password one.
 * Registered once, by `App`.
 */
export function watchSession(qc: QueryClient): () => void {
  return onApiRefusal((status, code) => {
    if (status === 401) qc.setQueryData(sessionKey, null);
    else if (code === "GANTI_SANDI")
      qc.setQueryData<Staff | null>(sessionKey, (s) =>
        s ? { ...s, mustChangePassword: true } : s,
      );
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api<{ staff: Staff }>("/api/auth/login", { method: "POST", body: input }),
    onSuccess: ({ staff }) => {
      // Seed the cache so the shell renders without a second round trip.
      qc.setQueryData(sessionKey, staff);
    },
  });
}

/**
 * Choose a new password. The API rotates the session cookie on the way, so
 * the page carries on signed in; the cache just learns the flag is down.
 */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api<{ staff: Staff }>("/api/auth/password", {
        method: "POST",
        body: input,
      }),
    onSuccess: ({ staff }) => {
      qc.setQueryData(sessionKey, staff);
    },
  });
}

/**
 * Sign out, then reload onto the sign-in screen.
 *
 * A full navigation rather than a cache reset: the store, every open tab and
 * half a sale live in this document's memory, and the next person to sign in
 * at this till must not inherit any of it. The session is revoked server-side
 * first; if that call fails (the server is unreachable) the reload still
 * happens, and the cookie dies at its own expiry.
 */
export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await api<void>("/api/auth/logout", { method: "POST" }).catch(
        () => undefined,
      );
      window.location.replace("/login");
      // Never settles; the page is on its way out. Keeps the button in its
      // loading state instead of flashing back to idle mid-navigation.
      return new Promise<void>(() => undefined);
    },
  });
}
