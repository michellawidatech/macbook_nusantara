/**
 * The customer profile column on /chat (2026-10-15): the bot's guesses say
 * they are estimates, the budget is a range, and every field is corrected in
 * place.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation } from "../src/lib/inboxApi.js";

const patchProfile = vi.fn(async () => ({}));
const addProfileFact = vi.fn(async () => ({}));
const removeProfileFact = vi.fn(async () => ({ ok: true as const }));
const closeStockWatch = vi.fn(async () => ({ watches: [] }));

vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  patchProfile: (...a: unknown[]) => patchProfile(...(a as [])),
  addProfileFact: (...a: unknown[]) => addProfileFact(...(a as [])),
  removeProfileFact: (...a: unknown[]) => removeProfileFact(...(a as [])),
  closeStockWatch: (...a: unknown[]) => closeStockWatch(...(a as [])),
}));

const { CustomerProfilePanel } =
  await import("../src/routes/chatbot/CustomerProfilePanel.js");

vi.setConfig({ testTimeout: 90_000 });

const PHONE = "628980092978";

const CONVERSATION: InboxConversation = {
  phone: PHONE,
  name: "Michella",
  channel: "WHATSAPP",
  windowClosesAt: null,
  messages: [],
  summary: {
    text: "Mahasiswa, cari MacBook untuk deep learning.",
    at: "2026-10-14T03:33:00.000Z",
  },
  directive: null,
  handoff: null,
  autoReply: { enabled: true, by: null, at: null },
  customer: null,
  actions: [],
  profile: {
    name: "Michella",
    ageEstimate: "20–25",
    occupation: "Mahasiswa",
    budgetMin: "12000000",
    budgetMax: "15000000",
    useCase: null,
    currentDevice: "Windows laptop",
    preference: null,
    facts: [
      { id: "f1", kind: "USAGE", value: "Deep learning", source: "BOT" },
      { id: "f2", kind: "APP", value: "VSCode", source: "BOT" },
      { id: "f3", kind: "APP", value: "CapCut", source: "BOT" },
      { id: "f4", kind: "PREFERENCE", value: "Baru", source: "BOT" },
      { id: "f5", kind: "ABOUT", value: "Kuliah di Bandung", source: "STAFF" },
    ],
    updatedAt: "2026-10-14T03:33:00.000Z",
  },
  lead: { on: true, score: 72, by: "BOT" },
  reservations: [
    {
      code: "RV-2026/10-0004",
      scheduledFor: "2026-10-16T07:00:00.000Z",
      status: "TERJADWAL",
      units: [{ serial: "C02XYZ123", name: "MacBook Air M2 8/256" }],
    },
  ],
};

function draw(conversation = CONVERSATION, onChanged = vi.fn()) {
  render(
    <AntdApp>
      <CustomerProfilePanel
        phone={PHONE}
        conversation={conversation}
        onChanged={onChanged}
      />
    </AntdApp>,
  );
  return onChanged;
}

beforeEach(() => {
  patchProfile.mockClear();
  addProfileFact.mockClear();
  removeProfileFact.mockClear();
});

describe("the customer profile", () => {
  it("labels the bot's guesses as estimates and shows the budget as a range", () => {
    draw();
    const about = screen.getByRole("region", { name: "About" });
    expect(within(about).getByText("20–25")).toBeInTheDocument();
    expect(within(about).getByText("Mahasiswa")).toBeInTheDocument();
    // Age and job/school, each with its own label.
    expect(within(about).getAllByText("estimate")).toHaveLength(2);

    expect(screen.getByRole("region", { name: "Budget" })).toHaveTextContent(
      "Rp 12.000.000 – Rp 15.000.000",
    );
    expect(screen.getByText("Bot score 72")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Apps" })).toHaveTextContent(
      /VSCode.*CapCut/,
    );
    expect(screen.getByRole("region", { name: "Other" })).toHaveTextContent(
      "Kuliah di Bandung",
    );
    expect(
      screen.getByRole("region", { name: "Reservations" }),
    ).toHaveTextContent(/RV-2026\/10-0004.*MacBook Air M2 8\/256 · C02XYZ123/);
  });

  it("shows one figure when only one end of the budget is known, None when neither", () => {
    draw({
      ...CONVERSATION,
      profile: { ...CONVERSATION.profile!, budgetMin: null },
    });
    expect(screen.getByRole("region", { name: "Budget" })).toHaveTextContent(
      "Rp 15.000.000",
    );
  });

  it("shows an open task as an action item, an old one too (2026-10-27)", () => {
    const task = (id: string, summary: string, topic: string) => ({
      id,
      kind: "PRICE" as const,
      status: "OPEN" as const,
      topic,
      summary,
      customerText: null,
      unit: null,
      listPrice: null,
      cost: null,
      askPrice: null,
      staffPrice: null,
      createdAt: "2026-10-27T03:00:00.000Z",
      updatedAt: "2026-10-27T03:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
    });
    draw({
      ...CONVERSATION,
      actions: [
        task(
          "a1",
          'Perlu cek harga — Air 15" M2 8/256\n"air 15 m2 berapa?"',
          "price",
        ),
        task(
          "a2",
          'Balasan bot ditahan (NO_SOURCE): "Bisa kak, cicilan 0%"',
          "other",
        ),
      ],
    });
    const tasks = screen.getByRole("region", { name: "Open tasks" });
    expect(tasks).toHaveTextContent('Need price check — Air 15" M2 8/256');
    expect(tasks).toHaveTextContent("air 15 m2 berapa?");
    expect(tasks).toHaveTextContent("Need reply — no source for the answer");
    expect(tasks).not.toHaveTextContent("NO_SOURCE");
    expect(tasks).not.toHaveTextContent("Balasan bot ditahan");
  });

  it("draws every field as None for a customer the bot knows nothing about", () => {
    draw({ ...CONVERSATION, profile: null, reservations: [], summary: null });
    expect(screen.getByRole("region", { name: "Budget" })).toHaveTextContent(
      "None",
    );
    expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent(
      "None",
    );
  });

  it("corrects a field in place", async () => {
    const user = userEvent.setup();
    const onChanged = draw();
    await user.click(
      screen.getByRole("button", { name: "Edit Job or school" }),
    );
    const box = screen.getByRole("textbox", { name: "Job or school" });
    await user.clear(box);
    await user.type(box, "Karyawan swasta{Enter}");
    await waitFor(() =>
      expect(patchProfile).toHaveBeenCalledWith(PHONE, {
        occupation: "Karyawan swasta",
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("corrects the budget as rupiah strings", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Edit Budget" }));
    const max = screen.getByRole("spinbutton", { name: "Budget up to" });
    await user.clear(max);
    await user.type(max, "17000000");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(patchProfile).toHaveBeenCalledWith(PHONE, {
        budgetMin: "12000000",
        budgetMax: "17000000",
      }),
    );
  });

  it("adds a fact with + and removes one with its ×", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Add an app" }));
    await user.type(
      screen.getByRole("textbox", { name: "Add an app" }),
      "Photoshop{Enter}",
    );
    await waitFor(() =>
      expect(addProfileFact).toHaveBeenCalledWith(PHONE, {
        kind: "APP",
        value: "Photoshop",
      }),
    );

    await user.click(screen.getByLabelText("Remove VSCode"));
    await waitFor(() =>
      expect(removeProfileFact).toHaveBeenCalledWith(PHONE, "f2"),
    );
  });

  it("shows the bot's lead and offers nothing to change it", async () => {
    // Owner, 2026-10-21: "the user cannot choose / determine the lead".
    draw();
    expect(screen.getByText("Bot score 72")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("waiting for stock (2026-10-27)", () => {
  it("lists the watches and closes an open one", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    draw(
      {
        ...CONVERSATION,
        reservations: [
          {
            code: "RV-2026/10-0009",
            scheduledFor: "2026-10-30T07:00:00.000Z",
            status: "TERJADWAL",
            units: [],
          },
        ],
        watches: [
          {
            id: "sw1",
            query: "macbook air m3 16/512",
            label: "Air M3 16/512",
            budget: "20000000",
            createdAt: "2026-10-26T03:00:00.000Z",
            notifiedAt: "2026-10-27T03:00:00.000Z",
            closedAt: null,
          },
          {
            id: "sw2",
            query: "ipad pro m4",
            label: null,
            budget: null,
            createdAt: "2026-10-20T03:00:00.000Z",
            notifiedAt: null,
            closedAt: "2026-10-21T03:00:00.000Z",
          },
        ],
      },
      onChanged,
    );
    const section = screen.getByRole("region", { name: "Waiting for stock" });
    expect(within(section).getByText("Air M3 16/512")).toBeInTheDocument();
    expect(within(section).getByText(/up to Rp/)).toBeInTheDocument();
    expect(
      within(section).getByText("In stock — tell them"),
    ).toBeInTheDocument();
    expect(within(section).getByText("ipad pro m4")).toBeInTheDocument();
    expect(within(section).getByText("Closed")).toBeInTheDocument();
    // Only the open one can be closed.
    expect(within(section).getAllByRole("button")).toHaveLength(1);
    await user.click(
      within(section).getByRole("button", { name: "Close Air M3 16/512" }),
    );
    await waitFor(() =>
      expect(closeStockWatch).toHaveBeenCalledWith(PHONE, "sw1"),
    );
    expect(onChanged).toHaveBeenCalled();
    // A bot visit holds nothing, and says so.
    expect(screen.getByText("Visit, nothing held")).toBeInTheDocument();
  });
});
