/**
 * The approval gate must not stand in the way of work that is not an edit of
 * money (2026-11-13): "Payments added to a sale (debt payments, returns,
 * exchanges adding items) still pass."
 *
 * Rather than restate those flows, this file RE-RUNS two existing suites —
 * the return desk with its exchanges (`customerReturn.test.tsx`) and the debt
 * payment dialog (`debtPaymentModal.test.tsx`) — with the store's `mutate`
 * wrapped: every change a SCREEN commits is also asked `approvalNeeded`, the
 * same rule `/api/store/commit` applies to an account without `canApprove`.
 * Any answer fails the test that caused it. A change the suites make
 * themselves to set the shop up (a `mutate` called straight from a test file)
 * is not a screen's and is left out.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvalNeeded,
  diffStore,
  type ApprovalRefusal,
  type StoreShape,
} from "@nusantara/store";
import { produce } from "immer";

const seen = vi.hoisted(() => ({
  refusals: [] as { refusal: ApprovalRefusal; caller: string }[],
}));

vi.mock("../src/mock/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mock/store.js")>();
  return {
    ...actual,
    mutate: (fn: Parameters<typeof actual.mutate>[0]) => {
      // The frame that called `mutate`: a screen, or a test setting up.
      const caller = new Error().stack?.split("\n")[2] ?? "";
      if (!/[/\\]test[/\\]/.test(caller)) {
        // The diff as rows, unencoded: the demo seed carries rows the wire
        // schema would refuse, and in-memory mode never encodes. The rule
        // reads numbers as money as readily as strings.
        const before = actual.getDb();
        const after = produce(before, (d) => {
          fn(d);
        });
        const refusal = approvalNeeded(
          diffStore(
            before as unknown as StoreShape,
            after as unknown as StoreShape,
          ),
        );
        if (refusal !== undefined) seen.refusals.push({ refusal, caller });
      }
      return actual.mutate(fn);
    },
  };
});

afterEach(() => {
  const found = seen.refusals.splice(0);
  expect(found, "a screen wrote a change only an approver may").toEqual([]);
});

/*
 * The wrapper must be able to see a refusal at all, or the two suites below
 * prove nothing: an approver's Delete on Transaction History is exactly the
 * change it exists to catch.
 */
describe("the wrapper itself", () => {
  it("catches a screen deleting a sale", async () => {
    const { TransactionsPage } =
      await import("../src/routes/finance/TransactionsPage.js");
    const { getDb } = await import("../src/mock/store.js");
    const { saleDeletionBlock } = await import("../src/lib/saleDeletion.js");
    const target = [...getDb().orders]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .find((o) => saleDeletionBlock(getDb(), o) === undefined)!;
    render(
      <AntdApp>
        <MemoryRouter>
          <TransactionsPage />
        </MemoryRouter>
      </AntdApp>,
    );
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: `Delete ${target.code}` })
      )[0]!,
    );
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Delete transaction" })).at(
        -1,
      )!,
    );
    await waitFor(() => expect(seen.refusals).toHaveLength(1));
    expect(seen.refusals.splice(0)[0]!.refusal).toMatchObject({
      reason: "SALE_REMOVED",
      key: target.id,
    });
  });
});

// Registered after the mock above (vitest hoists `vi.mock`), so every screen
// in them writes through the wrapped `mutate`.
import "./customerReturn.test.tsx";
import "./debtPaymentModal.test.tsx";
