/**
 * Taking a 👍/👎 back (owner ask 2026-10-27): the same thumb pressed again
 * withdraws the rating, the other thumb replaces it in one request, and a
 * rating that became a Knowledge Base answer stays put and says where to go.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyEvaluation } from "../src/lib/inboxApi.js";

const createEvaluation = vi.fn(async (body: Record<string, unknown>) => ({
  evaluation: { id: "ev2", ...body },
}));
const withdrawEvaluation = vi.fn(async (id: string) => ({ withdrawn: id }));

vi.mock("../src/lib/chatApi.js", async (original) => ({
  ...(await original<typeof import("../src/lib/chatApi.js")>()),
  createEvaluation: (body: Record<string, unknown>) => createEvaluation(body),
  withdrawEvaluation: (id: string) => withdrawEvaluation(id),
}));

const { ReplyRating } = await import("../src/routes/chatbot/ReplyRating.js");

vi.setConfig({ testTimeout: 90_000 });

const onChanged = vi.fn();
const draw = (evaluation: ReplyEvaluation | null) =>
  render(
    <AntdApp>
      <ReplyRating
        messageId="m1"
        text="halo kak"
        evaluation={evaluation}
        onChanged={onChanged}
      />
    </AntdApp>,
  );

beforeEach(() => {
  createEvaluation.mockClear();
  withdrawEvaluation.mockClear();
  onChanged.mockClear();
});

describe("a rated reply", () => {
  it("takes a 👍 back when it is pressed again", async () => {
    const user = userEvent.setup();
    draw({ id: "ev1", rating: "GOOD", status: "OPEN" });
    await user.click(screen.getByRole("button", { name: /Good reply/ }));
    await waitFor(() => expect(withdrawEvaluation).toHaveBeenCalledWith("ev1"));
    expect(createEvaluation).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("takes a 👎 back without asking why again", async () => {
    const user = userEvent.setup();
    draw({ id: "ev1", rating: "BAD", status: "OPEN" });
    await user.click(screen.getByRole("button", { name: /Bad reply/ }));
    await waitFor(() => expect(withdrawEvaluation).toHaveBeenCalledWith("ev1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("replaces a 👎 with a 👍 in one request", async () => {
    const user = userEvent.setup();
    draw({ id: "ev1", rating: "BAD", status: "OPEN" });
    await user.click(screen.getByRole("button", { name: /Good reply/ }));
    await waitFor(() =>
      expect(createEvaluation).toHaveBeenCalledWith({
        messageId: "m1",
        rating: "GOOD",
        replaces: "ev1",
      }),
    );
    expect(withdrawEvaluation).not.toHaveBeenCalled();
  });

  it("stays put once it became a Knowledge Base answer, and says where", async () => {
    const user = userEvent.setup();
    draw({ id: "ev1", rating: "BAD", status: "APPLIED" });
    const bad = screen.getByRole("button", { name: /Bad reply/ });
    expect(bad).toBeDisabled();
    expect(screen.getByRole("button", { name: /Good reply/ })).toBeDisabled();
    // The tooltip hangs on the span round the disabled button.
    fireEvent.mouseOver(screen.getByTestId("rate-bad"));
    expect(
      await screen.findByText(
        "This rating became a Knowledge Base answer — remove it there",
        {},
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    await user.click(bad).catch(() => undefined);
    expect(withdrawEvaluation).not.toHaveBeenCalled();
  });

  it("is rated by a first press as before", async () => {
    const user = userEvent.setup();
    draw(null);
    await user.click(screen.getByRole("button", { name: /Good reply/ }));
    await waitFor(() =>
      expect(createEvaluation).toHaveBeenCalledWith({
        messageId: "m1",
        rating: "GOOD",
      }),
    );
  });
});
