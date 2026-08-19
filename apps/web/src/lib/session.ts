/**
 * Who is signed in.
 *
 * Server data, so it lives in TanStack Query (01 §5) keyed by section — not in
 * a bespoke context that a second copy could disagree with.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.setQueryData(sessionKey, null);
      // Section keys, never queryClient.clear() (01 §5).
      void qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}
