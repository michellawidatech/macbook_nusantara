/**
 * Financial & Report → Reconciliation, on the demo store (owner ask
 * 2026-10-27): a daily count that matches, one that is adjusted with an edit
 * and an added transaction, reopening it, "changed since reconciled", and a
 * month's statement uploaded, matched and every kind of suggestion accepted.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";
import { ReconciliationPage } from "../src/routes/finance/ReconciliationPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { cashflowRows } from "../src/lib/cashflowRows.js";
import { posBalanceAt } from "../src/lib/reconciliation.js";
import { makeT } from "../src/i18n/translate.js";

vi.setConfig({ testTimeout: 90_000 });

const t = makeT("en");
const today = dayjs().format("YYYY-MM-DD");
const pos = (pot: "BANK" | "CASH", day = today) =>
  posBalanceAt(cashflowRows(getDb(), t), getDb().settings, pot, day);

function renderAt(url: string) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[url]}>
        <ReconciliationPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

const dialogOf = (text: string) =>
  screen.getByText(text).closest(".ant-modal") as HTMLElement;

async function typeMoney(input: HTMLElement, value: number) {
  await userEvent.clear(input);
  await userEvent.type(input, String(value));
  fireEvent.blur(input);
}

beforeEach(() => {
  mutate((d) => {
    d.reconciliations = [];
    d.statementLines = [];
    // The demo shop states no opening balance, so its pots run negative —
    // and a balance is typed as a positive figure.
    d.settings.openingCash = 500_000_000;
    d.settings.openingBank = 2_000_000_000;
  });
});

describe("the daily count", () => {
  it("saves a pot that matches the POS as Matched", async () => {
    renderAt("/finance/reconciliation?reconcile=today");
    const start = dialogOf("Reconcile a day");
    await typeMoney(
      within(start).getByRole("spinbutton", {
        name: "Bank balance (from the bank)",
      }),
      pos("BANK"),
    );
    await typeMoney(
      within(start).getByRole("spinbutton", {
        name: "Cash counted in the drawer",
      }),
      pos("CASH"),
    );
    await userEvent.click(
      within(start).getByRole("button", { name: "Check against the POS" }),
    );
    await vi.waitFor(() => expect(getDb().reconciliations).toHaveLength(2));
    expect(getDb().reconciliations.map((r) => r.status)).toEqual([
      "MATCHED",
      "MATCHED",
    ]);
    expect(await screen.findByText("Bank: Matched")).toBeTruthy();
    expect(screen.getByText("Cash: Matched")).toBeTruthy();
  });

  it("corrects a movement, adds a missing one, and saves Adjusted; reopens; notices a later change", async () => {
    mutate((d) => {
      d.expenses.unshift({
        id: "e-recon-1",
        kind: "OPERATIONAL",
        label: "ZZ courier",
        amount: 500_000,
        date: today,
        createdAt: new Date().toISOString(),
        method: "TRANSFER",
      });
    });
    const before = pos("BANK");
    // The bank says 75.000 more than the POS: the courier was 400.000, not
    // 500.000, and a 25.000 bank charge was never entered.
    const actual = before + 75_000;
    renderAt("/finance/reconciliation?reconcile=today");
    const start = dialogOf("Reconcile a day");
    await typeMoney(
      within(start).getByRole("spinbutton", {
        name: "Bank balance (from the bank)",
      }),
      actual,
    );
    await userEvent.click(
      within(start).getByRole("button", { name: "Check against the POS" }),
    );

    const dialog = await screen.findByText(/^Reconcile Bank — /);
    const pot = dialog.closest(".ant-modal") as HTMLElement;
    expect(within(pot).getByTestId("recon-difference").textContent).toBe(
      "Rp 75.000",
    );
    const courier = within(pot).getByRole("spinbutton", {
      name: "Amount of ZZ courier",
    });
    await typeMoney(courier, 400_000);
    await vi.waitFor(() =>
      expect(within(pot).getByTestId("recon-difference").textContent).toBe(
        "Rp -25.000",
      ),
    );
    expect(pot.querySelector(".recon-row-changed")).not.toBeNull();

    await userEvent.click(
      within(pot).getByRole("button", { name: /Add a transaction/ }),
    );
    const add = (await screen.findByText("Record it")).closest(
      ".ant-modal",
    ) as HTMLElement;
    await typeMoney(within(add).getByRole("spinbutton"), 25_000);
    await userEvent.click(
      within(add).getByRole("button", { name: "Record it" }),
    );
    await vi.waitFor(() =>
      expect(within(pot).getByTestId("recon-difference").textContent).toBe(
        "Rp 0",
      ),
    );
    expect(pot.querySelector(".recon-row-added")).not.toBeNull();

    await userEvent.click(
      within(pot).getByRole("button", { name: "Save reconciliation" }),
    );
    await vi.waitFor(() =>
      expect(getDb().reconciliations[0]?.status).toBe("ADJUSTED"),
    );
    const rec = getDb().reconciliations[0]!;
    expect(rec.edits.map((e) => [e.action, e.before, e.after])).toEqual([
      ["EDITED", 500_000, 400_000],
      ["ADDED", undefined, 25_000],
    ]);
    expect(getDb().expenses.find((e) => e.id === "e-recon-1")!.amount).toBe(
      400_000,
    );
    expect(rec.posBalance).toBe(actual);

    // Changed since reconciled: the courier is corrected again elsewhere.
    mutate((d) => {
      d.expenses.find((e) => e.id === "e-recon-1")!.amount = 450_000;
    });
    expect(await screen.findByTestId(`changed-BANK-${today}`)).toBeTruthy();

    // Reopen: the day is OPEN again and its dialog is back.
    await userEvent.click(screen.getByRole("button", { name: "Reopen Bank" }));
    await vi.waitFor(() =>
      expect(getDb().reconciliations[0]?.status).toBe("OPEN"),
    );
    expect(await screen.findByText(/^Reconcile Bank — /)).toBeTruthy();
  });
});

describe("the monthly statement", () => {
  const CSV = [
    "No. rekening : 0001234567",
    "Nama : TOKO CONTOH",
    "Periode : 01/03/2026 - 31/03/2026",
    "Kode Mata Uang : Rp",
    "",
    "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
    `'02/03,"TRSF E-BANKING CR BUDI",'0000,2000000.00,CR,2000000.00`,
    `'05/03,"TRSF E-BANKING CR SITI",'0000,1520000.00,CR,3520000.00`,
    `'09/03,"TRSF E-BANKING CR SHOPEE",'0000,9700000.00,CR,13220000.00`,
    `'12/03,"TRSF E-BANKING CR TOKOPEDIA",'0000,8000000.00,CR,21220000.00`,
    `'15/03,"SETORAN VIA CDM",'0000,6000000.00,CR,27220000.00`,
    `'15/03,"SETORAN VIA CDM",'0000,4000000.00,CR,31220000.00`,
    `'31/03,"BUNGA",'0000,4512.37,CR,31224512.37`,
    "",
    "Saldo Awal,=0.00",
    "Mutasi Kredit,=31224512.37,7",
    "Mutasi Debet,=0.00,0",
    "Saldo Akhir,=31224512.37",
  ].join("\r\n");

  it("is read, matched, and every kind of suggestion accepted", async () => {
    mutate((d) => {
      const income = (id: string, day: string, amount: number) =>
        d.incomes.unshift({
          id,
          reason: "SALES",
          amount,
          date: day,
          method: "TRANSFER",
          note: `ZZ ${id}`,
          createdAt: dayjs(`${day}T10:00:00`).toISOString(),
        });
      income("m-exact", "2026-03-02", 2_000_000);
      income("m-typo", "2026-03-05", 1_250_000);
      income("m-fee", "2026-03-09", 10_000_000);
      income("m-split-a", "2026-03-12", 3_000_000);
      income("m-split-b", "2026-03-12", 5_000_000);
      income("m-cdm", "2026-03-15", 10_000_000);
    });
    renderAt("/finance/reconciliation?tab=monthly");
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(
      input,
      new File([CSV], "mutasi-maret.csv", { type: "text/csv" }),
    );
    const preview = (await screen.findByText(/7 movements read/)).closest(
      ".ant-modal",
    ) as HTMLElement;
    expect(within(preview).getByText(/1 line\(s\) carry sen/)).toBeTruthy();
    fireEvent.click(
      within(preview).getByText("Match against the POS").closest("button")!,
    );

    await screen.findByText("Suggestions (4)");
    const rec = getDb().reconciliations.find((r) => r.kind === "MONTHLY")!;
    expect(rec).toMatchObject({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      statementOpening: 0,
      statementClosing: 31_224_512,
      statementFile: "mutasi-maret.csv",
      status: "OPEN",
    });
    const lines = () =>
      getDb()
        .statementLines.filter((l) => l.reconciliationId === rec.id)
        .sort((a, b) => a.lineNo - b.lineNo);
    expect(lines().map((l) => l.status)).toEqual([
      "MATCHED",
      "SUGGESTED",
      "SUGGESTED",
      "SUGGESTED",
      "SUGGESTED",
      "SUGGESTED",
      "UNMATCHED",
    ]);

    /*
     * By text and `fireEvent`, not by role and `userEvent`: on a page this
     * size every role query and every pointer check asks jsdom for computed
     * styles across all of antd's injected CSS, and one Accept took a minute.
     */
    const press = (scope: HTMLElement, label: string) =>
      fireEvent.click(within(scope).getByText(label).closest("button")!);
    const acceptRow = async (what: RegExp) => {
      press(screen.getByText(what).closest("tr") as HTMLElement, "Accept");
    };
    await acceptRow(/Correct the POS amount to Rp 1\.520\.000/);
    await vi.waitFor(() =>
      expect(getDb().incomes.find((i) => i.id === "m-typo")!.amount).toBe(
        1_520_000,
      ),
    );
    await acceptRow(/Record Rp 300\.000 as a fee/);
    await vi.waitFor(() =>
      expect(
        getDb().expenses.some(
          (e) =>
            e.amount === 300_000 &&
            e.method === "TRANSFER" &&
            // A bank's or a marketplace's fee, not "Operational" (2026-10-27).
            e.kind === "BIAYA_ADMIN",
        ),
      ).toBe(true),
    );
    await acceptRow(/These 2 POS movements add up/);
    await acceptRow(/These 2 bank lines add up/);
    await vi.waitFor(() =>
      expect(lines().map((l) => l.status)).toEqual([
        "MATCHED",
        "MATCHED",
        "MATCHED",
        "MATCHED",
        "MATCHED",
        "MATCHED",
        "UNMATCHED",
      ]),
    );

    // The interest: added to the POS, its category guessed.
    // On a phone (every test, `test/setup.ts`) a list row is a card.
    const bunga = screen
      .getAllByText("BUNGA")[0]!
      .closest(".ant-card") as HTMLElement;
    expect(within(bunga).getByText("Interest")).toBeTruthy();
    press(bunga, "Add to POS");
    const add = (await screen.findByText("Record it")).closest(
      ".ant-modal",
    ) as HTMLElement;
    press(add, "Record it");
    await vi.waitFor(() => expect(lines()[6]!.status).toBe("MATCHED"));
    expect(lines()[6]!.matches[0]!.reason).toBe("ADDED");
    const interest = getDb().incomes.find(
      (i) => i.id === lines()[6]!.matches[0]!.incomeId,
    )!;
    expect(interest).toMatchObject({
      reason: "BUNGA",
      amount: 4_512,
      method: "TRANSFER",
    });

    const r = getDb().reconciliations.find((x) => x.id === rec.id)!;
    expect(r.edits.map((e) => e.action)).toEqual(["EDITED", "ADDED", "ADDED"]);
    expect(screen.getByTestId("month-counts").textContent).toBe("4 · 3 · 0");

    press(document.body, "Mark the month reconciled");
    await vi.waitFor(() =>
      expect(getDb().reconciliations.find((x) => x.id === rec.id)!.status).toBe(
        "RECONCILED",
      ),
    );
  });

  it("refuses a statement that does not add up, saying what", async () => {
    renderAt("/finance/reconciliation?tab=monthly");
    const broken = CSV.replace(
      "Saldo Akhir,=31224512.37",
      "Saldo Akhir,=31223000.00",
    );
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File([broken], "rusak.csv", { type: "text/csv" }),
    );
    expect(
      await screen.findByText("This statement was not taken"),
    ).toBeTruthy();
    expect(screen.getByText(/but the statement closes at/)).toBeTruthy();
    expect(getDb().statementLines).toEqual([]);
  });

  it("closes only once every POS entry the bank never saw is paired or set aside (owner-approved 2026-10-27)", async () => {
    const small = [
      "No. rekening : 0001234567",
      "Nama : TOKO CONTOH",
      "Periode : 01/04/2026 - 30/04/2026",
      "Kode Mata Uang : Rp",
      "",
      "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
      `'02/04,"TRSF E-BANKING CR BUDI",'0000,2000000.00,CR,2000000.00`,
      `'05/04,"TRSF E-BANKING CR SITI",'0000,1520000.00,CR,3520000.00`,
      "",
      "Saldo Awal,=0.00",
      "Mutasi Kredit,=3520000.00,2",
      "Mutasi Debet,=0.00,0",
      "Saldo Akhir,=3520000.00",
    ].join("\r\n");
    // April: the test above leaves its March incomes in the shared store.
    mutate((d) => {
      const income = (id: string, day: string, amount: number) =>
        d.incomes.unshift({
          id,
          reason: "SALES",
          amount,
          date: day,
          method: "TRANSFER",
          note: `ZZ ${id}`,
          createdAt: dayjs(`${day}T10:00:00`).toISOString(),
        });
      income("m-a", "2026-04-02", 2_000_000);
      income("m-b", "2026-04-05", 1_520_000);
      // Recorded as a transfer; the bank never saw it.
      income("m-lost", "2026-04-20", 750_000);
    });
    renderAt("/finance/reconciliation?tab=monthly");
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File([small], "mutasi-april.csv", { type: "text/csv" }),
    );
    const preview = (await screen.findByText(/2 movements read/)).closest(
      ".ant-modal",
    ) as HTMLElement;
    fireEvent.click(
      within(preview).getByText("Match against the POS").closest("button")!,
    );
    const press = (scope: HTMLElement, label: string) =>
      fireEvent.click(within(scope).getByText(label).closest("button")!);
    const markButton = () =>
      screen.getByText("Mark the month reconciled").closest("button")!;

    // Every line matched, one POS entry left: blocked, and it says why.
    expect((await screen.findByTestId("month-close-blocked")).textContent).toBe(
      "1 POS entries never reached the bank — pair or explain them",
    );
    expect(markButton().disabled).toBe(true);
    const rec = () =>
      getDb().reconciliations.find((r) => r.kind === "MONTHLY")!;

    // Set aside, with a note.
    const row = () =>
      screen.getByText("ZZ m-lost").closest("tr") as HTMLElement;
    press(row(), "Set aside with a note");
    const dialog = (await screen.findByText("Set this entry aside")).closest(
      ".ant-modal",
    ) as HTMLElement;
    fireEvent.change(
      within(dialog).getByLabelText("Why did the bank never see it?"),
      { target: { value: "Paid into the owner's own account" } },
    );
    press(dialog, "Set aside");
    await vi.waitFor(() =>
      expect(rec().asides).toMatchObject([
        { incomeId: "m-lost", note: "Paid into the owner's own account" },
      ]),
    );
    expect(
      within(row()).getByText("Paid into the owner's own account"),
    ).toBeTruthy();
    expect(screen.queryByTestId("month-close-blocked")).toBeNull();
    expect(markButton().disabled).toBe(false);

    // Undo: withdrawn, kept, and the month is blocked again.
    press(row(), "Undo");
    await vi.waitFor(() => expect(rec().asides[0]!.withdrawnAt).toBeDefined());
    expect(rec().asides).toHaveLength(1);
    expect((await screen.findByTestId("month-close-blocked")).textContent).toBe(
      "1 POS entries never reached the bank — pair or explain them",
    );
    expect(markButton().disabled).toBe(true);

    // Set aside again, and the month closes.
    press(row(), "Set aside with a note");
    const again = (await screen.findByText("Set this entry aside")).closest(
      ".ant-modal",
    ) as HTMLElement;
    fireEvent.change(
      within(again).getByLabelText("Why did the bank never see it?"),
      { target: { value: "Owner's account" } },
    );
    press(again, "Set aside");
    await vi.waitFor(() => expect(markButton().disabled).toBe(false));
    fireEvent.click(markButton());
    await vi.waitFor(() => expect(rec().status).toBe("RECONCILED"));
  });
});

describe("deleting a reconciliation (owner ask 2026-10-27)", () => {
  const AT = "2026-09-30T10:00:00.000Z";
  const rec = (
    id: string,
    kind: "DAILY" | "MONTHLY",
    pot: "BANK" | "CASH",
    start: string,
    end: string,
  ) => ({
    id,
    kind,
    pot,
    periodStart: start,
    periodEnd: end,
    posBalance: 1_000,
    actualBalance: 1_000,
    status: "MATCHED" as const,
    staff: "Dina",
    createdAt: AT,
    updatedAt: AT,
    edits: [
      {
        id: `${id}-e1`,
        expenseId: "e-x",
        action: "EDITED" as const,
        before: 2_000,
        after: 1_000,
        staff: "Dina",
        at: AT,
      },
    ],
    asides: [],
  });

  it("deletes a day's two pots behind a confirm, and the day is not done again", async () => {
    mutate((d) => {
      d.reconciliations = [
        rec("rc-b", "DAILY", "BANK", "2026-09-02", "2026-09-02"),
        rec("rc-c", "DAILY", "CASH", "2026-09-02", "2026-09-02"),
        rec("rc-b3", "DAILY", "BANK", "2026-09-03", "2026-09-03"),
      ];
    });
    renderAt("/finance/reconciliation");
    expect(await screen.findAllByText("Bank: Matched")).toHaveLength(2);
    const deletes = screen.getAllByRole("button", { name: /Delete/ });
    expect(deletes).toHaveLength(2);
    // Newest first: 3 September, then 2 September.
    await userEvent.click(deletes[1]!);
    const pop = (
      await screen.findByText(/Delete the reconciliation of/)
    ).closest(".ant-popover") as HTMLElement;
    expect(
      within(pop).getByText("Corrections already made to transactions stay."),
    ).toBeTruthy();
    await userEvent.click(within(pop).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() =>
      expect(getDb().reconciliations.map((r) => r.id)).toEqual(["rc-b3"]),
    );
    expect(screen.getAllByText("Bank: Matched")).toHaveLength(1);
  });

  it("deletes a month only once the month is typed back, with its statement lines", async () => {
    mutate((d) => {
      d.reconciliations = [
        rec("rc-sep", "MONTHLY", "BANK", "2026-09-01", "2026-09-30"),
      ];
      d.statementLines = [
        {
          id: "sl-1",
          reconciliationId: "rc-sep",
          lineNo: 1,
          date: "2026-09-02",
          description: "TRSF CR",
          amount: 1_000,
          status: "MATCHED",
          matches: [{ id: "sm-1", expenseId: "e-x", reason: "EXACT" }],
        },
      ];
    });
    renderAt("/finance/reconciliation?tab=monthly");
    await userEvent.click(
      await screen.findByRole("button", { name: /Delete/ }),
    );
    const dialog = (
      await screen.findByText(/Delete the reconciliation of/)
    ).closest(".ant-modal") as HTMLElement;
    expect(within(dialog).getByText(/Corrections already made/)).toBeTruthy();
    const ok = () =>
      within(dialog).getByRole("button", {
        name: "Delete",
      }) as HTMLButtonElement;
    expect(ok().disabled).toBe(true);
    const box = within(dialog).getByLabelText("Type the month to confirm");
    await userEvent.type(box, "2026-08");
    expect(ok().disabled).toBe(true);
    await userEvent.clear(box);
    await userEvent.type(box, "2026-09");
    expect(ok().disabled).toBe(false);
    await userEvent.click(ok());
    await vi.waitFor(() => expect(getDb().reconciliations).toEqual([]));
    expect(getDb().statementLines).toEqual([]);
  });
});
