/**
 * Settings → Activity (owner ask 2026-10-22): who did what, read from
 * `/api/kontrol/audit`, which every store save writes to since that release.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySettings } from "../src/routes/settings/ActivitySettings.js";
import { getDb } from "../src/mock/store.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(entries: unknown[]) {
  const asked: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const body = url.startsWith("/api/staff")
      ? {
          accounts: [
            { id: "st-dina", name: "Dina", username: "dina", role: "STAFF" },
          ],
        }
      : { entries, page: 1, perPage: 50, total: entries.length };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return asked;
}

function renderTab() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AntdApp>
        <ActivitySettings />
      </AntdApp>
    </QueryClientProvider>,
  );
}

describe("the activity tab", () => {
  it("says who changed what, and the change itself", async () => {
    const order = getDb().orders[0]!;
    serve([
      {
        id: "a1",
        at: "2026-10-22T03:00:00.000Z",
        action: "UPDATE",
        entity: "units",
        entityId: "C02ABC123DEF",
        field: "price, grade",
        before: JSON.stringify({ price: "7000000", grade: "A" }),
        after: JSON.stringify({ price: "7250000", grade: "B" }),
        requestId: null,
        ip: null,
        staff: { id: "st-dina", name: "Dina", username: "dina" },
      },
      {
        id: "a2",
        at: "2026-10-22T02:00:00.000Z",
        action: "CREATE",
        entity: "orders",
        entityId: order.id,
        field: null,
        before: null,
        after: JSON.stringify({ code: order.code, total: "5000000" }),
        requestId: null,
        ip: null,
        staff: { id: "st-dina", name: "Dina", username: "dina" },
      },
    ]);
    renderTab();

    const edit = (await screen.findByText("C02ABC123DEF")).closest("tr")!;
    expect(within(edit).getByText("Dina")).toBeInTheDocument();
    expect(within(edit).getByText("Changed")).toBeInTheDocument();
    expect(within(edit).getByText("Unit")).toBeInTheDocument();
    expect(edit.textContent).toContain("Rp 7.000.000 → Rp 7.250.000");
    expect(edit.textContent).toContain("A → B");

    // A sale is named by its code, the way every other screen names it.
    const sale = screen.getByText(order.code).closest("tr")!;
    expect(within(sale).getByText("Added")).toBeInTheDocument();
    expect(within(sale).getByText("Sale")).toBeInTheDocument();
  });

  it("asks the server for one person's activity", async () => {
    const asked = serve([]);
    renderTab();
    await vi.waitFor(() =>
      expect(asked.some((u) => u.startsWith("/api/kontrol/audit"))).toBe(true),
    );
    fireEvent.mouseDown(screen.getByLabelText("Person"));
    fireEvent.click(
      await vi.waitFor(() => {
        const opt = document.querySelector<HTMLElement>(
          '.ant-select-item-option[title="Dina"]',
        );
        if (!opt) throw new Error("no Dina yet");
        return opt;
      }),
    );
    await vi.waitFor(() =>
      expect(asked.some((u) => u.includes("staffId=st-dina"))).toBe(true),
    );
  });

  it("clears the whole log only after the confirm word is typed", async () => {
    const asked: { url: string; method: string }[] = [];
    let cleared = false;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        asked.push({ url, method });
        if (method === "DELETE") cleared = true;
        const body = url.startsWith("/api/staff")
          ? { accounts: [] }
          : method === "DELETE"
            ? { cleared: 42 }
            : {
                entries: cleared
                  ? [
                      {
                        id: "c1",
                        at: "2026-10-22T04:00:00.000Z",
                        action: "DELETE",
                        entity: "AuditLog",
                        entityId: "all",
                        field: null,
                        before: JSON.stringify({ rows: 42 }),
                        after: null,
                        requestId: null,
                        ip: null,
                        staff: {
                          id: "st-ersen",
                          name: "Ersen",
                          username: "ersen",
                        },
                      },
                    ]
                  : [],
                page: 1,
                perPage: 50,
                total: cleared ? 1 : 0,
              };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as typeof globalThis.fetch;
    renderTab();

    fireEvent.click(
      await screen.findByRole("button", { name: /Clear all activity/ }),
    );
    const dialog = await screen.findByRole("dialog");
    const ok = within(dialog).getByRole("button", { name: "Clear it" });
    expect(ok).toBeDisabled();

    const box = within(dialog).getByLabelText("Type the word to confirm");
    fireEvent.change(box, { target: { value: "clear" } });
    expect(ok).toBeDisabled();
    expect(asked.some((a) => a.method === "DELETE")).toBe(false);

    fireEvent.change(box, { target: { value: "CLEAR" } });
    expect(ok).toBeEnabled();
    fireEvent.click(ok);

    expect(
      await screen.findByText("42 activity line(s) cleared."),
    ).toBeInTheDocument();
    expect(
      asked.filter((a) => a.method === "DELETE").map((a) => a.url),
    ).toEqual(["/api/kontrol/audit"]);
    // The list is read again, and the clear is the line left in it.
    expect(await screen.findByText("Activity log")).toBeInTheDocument();
  });
});
