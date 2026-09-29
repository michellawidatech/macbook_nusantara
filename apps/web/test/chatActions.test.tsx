/**
 * The action item a chatbot hand-over leaves, as a colleague meets it
 * (owner ask 2026-09-29): the dialog opens by itself, a negotiation is a form
 * with our price, the cost and the customer's offer, and answering it sends
 * the price and the sentence carrying it in one press.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAction } from "../src/lib/inboxApi.js";

const offerAction = vi.fn(async () => ({
  id: "a1",
  status: "QUEUED" as const,
}));
const finishAction = vi.fn(async () => ({ done: true as const }));
vi.mock("../src/lib/inboxApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/inboxApi.js")>()),
  offerAction: (...a: unknown[]) => offerAction(...(a as [])),
  finishAction: (...a: unknown[]) => finishAction(...(a as [])),
}));

const { ActionItems } = await import("../src/routes/chatbot/ActionItems.js");

vi.setConfig({ testTimeout: 60_000 });

const NEGOTIATION: ChatAction = {
  id: "a1",
  kind: "NEGOTIATION",
  status: "OPEN",
  topic: "negotiation",
  summary: "Nego Air M1",
  customerText: "kalau 7jt boleh kak?",
  unit: { serial: "C02AIRM1", name: "MacBook Air M1 8/256", grade: "A" },
  listPrice: "7500000",
  cost: "6000000",
  askPrice: "7000000",
  staffPrice: null,
  createdAt: "2026-09-29T03:00:00.000Z",
  updatedAt: "2026-09-29T03:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

function draw(actions: ChatAction[], onChanged = vi.fn()) {
  return render(
    <AntdApp>
      <ActionItems
        phone="628123"
        actions={actions}
        profile={null}
        onChanged={onChanged}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  offerAction.mockClear();
  finishAction.mockClear();
});

describe("a negotiation left by the bot", () => {
  it("opens its form by itself, with our price, the cost and the offer", async () => {
    draw([NEGOTIATION]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("MacBook Air M1 8/256");
    expect(dialog).toHaveTextContent(/7\.500\.000/);
    expect(dialog).toHaveTextContent(/6\.000\.000/);
    expect(dialog).toHaveTextContent(/7\.000\.000/);
  });

  it("sends the price and a sentence carrying it", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    draw([NEGOTIATION], onChanged);
    await screen.findByRole("dialog");
    await user.type(
      screen.getByRole("spinbutton", { name: "Your price" }),
      "7200000",
    );
    await user.click(screen.getByRole("button", { name: "Send offer" }));

    expect(offerAction).toHaveBeenCalledWith("628123", "a1", {
      price: "7200000",
      text: expect.stringMatching(/MacBook Air M1 8\/256.*7\.200\.000/),
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when the customer changes their offer while it is open", async () => {
    const { rerender } = draw([NEGOTIATION]);
    await screen.findByRole("dialog");
    rerender(
      <AntdApp>
        <ActionItems
          phone="628123"
          actions={[{ ...NEGOTIATION, askPrice: "7200000" }]}
          profile={null}
          onChanged={vi.fn()}
        />
      </AntdApp>,
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /changed their offer/,
    );
  });
});

describe("any other task", () => {
  it("closes with Mark done and sends nothing", async () => {
    const user = userEvent.setup();
    draw([{ ...NEGOTIATION, id: "a2", kind: "PRICE", askPrice: null }]);
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: "Send offer" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark done" }));
    expect(finishAction).toHaveBeenCalledWith("628123", "a2");
    expect(offerAction).not.toHaveBeenCalled();
  });

  it("draws nothing when nothing is open", () => {
    draw([{ ...NEGOTIATION, status: "DONE" }]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
