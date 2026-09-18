/**
 * The owner's account screen, typed — `/api/staff` (apps/api/src/routes/staff.ts).
 *
 * Server data in TanStack Query, keyed under `staff`, like the session beside
 * it. Staff logins are NOT in the store (`mock/store.ts`): the store is the
 * shop's data every till shares, and who may sign in is neither the shop's
 * data nor something every till should hold a copy of.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export interface StaffAccount {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
  readonly active: boolean;
  readonly mustChangePassword: boolean;
  /** ISO string, or null if they have never signed in. */
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  /** False: the account has no password at all and cannot sign in yet. */
  readonly hasPassword: boolean;
}

export const staffAccountsKey = ["staff", "accounts"] as const;

export function useStaffAccounts(enabled = true) {
  return useQuery({
    queryKey: staffAccountsKey,
    queryFn: async () =>
      (await api<{ accounts: StaffAccount[] }>("/api/staff")).accounts,
    enabled,
  });
}

function useAccountMutation<I, O>(run: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: staffAccountsKey }),
  });
}

export function useCreateAccount() {
  return useAccountMutation(
    (input: {
      username: string;
      name: string;
      role: "OWNER" | "STAFF";
      canApprove: boolean;
    }) =>
      api<{ account: StaffAccount }>("/api/staff", {
        method: "POST",
        body: input,
      }),
  );
}

export function useUpdateAccount() {
  return useAccountMutation(
    ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      role?: "OWNER" | "STAFF";
      canApprove?: boolean;
      active?: boolean;
    }) =>
      api<{ account: StaffAccount }>(`/api/staff/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      }),
  );
}

export function useResetPassword() {
  return useAccountMutation((id: string) =>
    api<{ account: StaffAccount }>(
      `/api/staff/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" },
    ),
  );
}
