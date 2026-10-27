/**
 * The Evaluation tab (2026-10-15): it opens on "bad and still open", Apply
 * confirms or rewrites the better answer before posting it, Dismiss closes a
 * row, and Open chat hands the thread back to the page.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluation } from "../src/lib/chatApi.js";

const base: Evaluation = {
  id: "e1",
  rating: "BAD",
  reason: "WRONG_FACT",
  agent: "ADVISOR",
  note: "unit sudah terjual",
  corrected: "Air M2 sudah terjual kak, ada Air M3",
  status: "OPEN",
  createdAt: "2026-10-14T03:40:00.000Z",
  createdBy: "Ersen",
  reviewedAt: null,
  reviewedBy: null,
  phone: "628980092978",
  customerText: "Air M2 ada?",
  reply: "Ada kak, Air M2 siap",
  messageId: "m1",
};

const ROWS: Evaluation[] = [
  base,
  {
    ...base,
    id: "e2",
    rating: "GOOD",
    reason: null,
    agent: null,
    note: null,
    corrected: null,
    phone: "628111000001",
    reply: "Halo kak, ada yang bisa dibantu?",
  },
  {
    ...base,
    id: "e3",
    status: "APPLIED",
    phone: "628111000002",
    reply: "Sudah diterapkan sebelumnya",
  },
];

const listEvaluations = vi.fn(async () => ({ evaluations: ROWS }));
const applyEvaluation = vi.fn(async (id: string) => ({
  evaluation: { ...base, id, status: "APPLIED" },
}));
const dismissEvaluation = vi.fn(async (id: string) => ({
  evaluation: { ...base, id, status: "DISMISSED" },
}));
const deleteEvaluation = vi.fn(async (id: string) => ({ withdrawn: id }));

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  listEvaluations: (...a: unknown[]) => listEvaluations(...(a as [])),
  applyEvaluation: (...a: unknown[]) => applyEvaluation(...(a as [string])),
  dismissEvaluation: (id: string) => dismissEvaluation(id),
  deleteEvaluation: (id: string) => deleteEvaluation(id),
}));

const { EvaluationPanel } =
  await import("../src/routes/chatbot/EvaluationPanel.js");

vi.setConfig({ testTimeout: 90_000 });

function draw(onOpenChat = vi.fn()) {
  render(
    <AntdApp>
      <EvaluationPanel onOpenChat={onOpenChat} />
    </AntdApp>,
  );
  return onOpenChat;
}

beforeEach(() => {
  listEvaluations.mockClear();
  applyEvaluation.mockClear();
  dismissEvaluation.mockClear();
  deleteEvaluation.mockClear();
});

describe("the Evaluation tab", () => {
  it("opens on the bad replies still waiting for review", async () => {
    draw();
    expect(await screen.findByText("Ada kak, Air M2 siap")).toBeInTheDocument();
    expect(listEvaluations).toHaveBeenCalledWith({ status: "ALL" });
    expect(
      screen.queryByText("Halo kak, ada yang bisa dibantu?"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Sudah diterapkan sebelumnya"),
    ).not.toBeInTheDocument();
    // The two filters are chips, each one × away.
    expect(screen.getByLabelText("Remove Rating Bad")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Remove Status Needs review"),
    ).toBeInTheDocument();
  });

  it("applies the better answer, as edited in the dialog", async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText("Ada kak, Air M2 siap");
    await user.click(screen.getByRole("button", { name: /Apply/ }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("textbox", { name: "Better answer" });
    expect(box).toHaveValue("Air M2 sudah terjual kak, ada Air M3");

    await user.clear(box);
    await user.type(box, "Air M2 habis kak, Air M3 ada 😊");
    await user.click(within(dialog).getByRole("button", { name: /Apply/ }));

    await waitFor(() =>
      expect(applyEvaluation).toHaveBeenCalledWith(
        "e1",
        "Air M2 habis kak, Air M3 ada 😊",
      ),
    );
    // The list is read again so the row moves out of the queue.
    expect(listEvaluations).toHaveBeenCalledTimes(2);
  });

  it("dismisses a row and opens its chat", async () => {
    const user = userEvent.setup();
    const onOpenChat = draw();
    await screen.findByText("Ada kak, Air M2 siap");
    await user.click(screen.getByRole("button", { name: /Dismiss/ }));
    await waitFor(() => expect(dismissEvaluation).toHaveBeenCalledWith("e1"));

    await user.click(screen.getByRole("button", { name: /Open chat/ }));
    expect(onOpenChat).toHaveBeenCalledWith("628980092978");
  });

  it("deletes a row after a confirm", async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText("Ada kak, Air M2 siap");
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    const confirm = await screen.findByRole("tooltip");
    await user.click(within(confirm).getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(deleteEvaluation).toHaveBeenCalledWith("e1"));
    expect(listEvaluations).toHaveBeenCalledTimes(2);
  });
});
