/**
 * Who is signed in.
 *
 * Server data, so it lives in TanStack Query (01 §5) keyed by section — not in
 * a bespoke context that a second copy could disagree with.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "./api.js";

export interface Staff {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
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
 * Leave for Auth0.
 *
 * Both ends of the session are top-level redirects now, not fetches: signing in
 * goes out to the tenant and comes back through `/auth/callback`, and signing
 * out has to reach Auth0 too, or its SSO cookie survives and the next click on
 * Sign in walks straight back into the same account. Neither can be an XHR.
 *
 * There is no cache to tidy on the way out — the document is being replaced,
 * and `/auth/logout` revokes the session server-side before it redirects.
 */
export function useLogout() {
  return useMutation({
    mutationFn: () => {
      window.location.assign("/auth/logout");
      // Never settles; the page is on its way out. Keeps the button in its
      // loading state instead of flashing back to idle mid-navigation.
      return new Promise<void>(() => undefined);
    },
  });
}
