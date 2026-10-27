/**
 * The knowledge base's file import (owner ask 2026-10-14: one column of
 * questions, one of answers). What only the page can show: a file sorted into
 * new, changed and unchanged before anything is saved, and that importing
 * UPDATES an answer the sheet changed instead of adding the question twice.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgePanel } from "../src/routes/chatbot/KnowledgePage.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

const NOW = "2026-10-01T00:00:00.000Z";

beforeEach(() => {
  mutate((d) => {
    d.knowledge = [
      {
        id: "k-cod",
        question: "Cod bisa ga kak?",
        answer: "Bisa kak",
        active: true,
        updatedAt: NOW,
      },
      {
        id: "k-garansi",
        question: "Garansi berapa lama?",
        answer: "1 bulan ya kak",
        active: false,
        updatedAt: NOW,
      },
    ];
  });
});

async function openWith(name: string, text: string) {
  render(
    <AntdApp>
      <KnowledgePanel />
    </AntdApp>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Import from a file/ }),
  );
  const dialog = await screen.findByRole("dialog");
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File([text], name, { type: "text/csv" }));
  return dialog;
}

describe("importing the knowledge base from a file", () => {
  it("adds what is new and updates what changed, leaving the rest alone", async () => {
    await openWith(
      "answers.csv",
      [
        "Question,Answer",
        "Cod bisa ga kak?,Bisa kak",
        'Garansi berapa lama?,"3 bulan ya kak"',
        "Bisa tukar tambah?,Bisa kak",
        "Bisa nego?,",
      ].join("\n"),
    );

    expect(await screen.findByText("answer changed")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("no change")).toBeInTheDocument();
    // Today's answer is shown under the one replacing it.
    expect(
      screen.getByText("1 bulan ya kak", { selector: "del" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 questions have no answer and will not be imported/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Import 2" }));

    await waitFor(() => expect(getDb().knowledge).toHaveLength(3));
    const byId = (id: string) => getDb().knowledge.find((k) => k.id === id)!;
    expect(byId("k-garansi").answer).toBe("3 bulan ya kak");
    // An update is to the words, not to the switch somebody set.
    expect(byId("k-garansi").active).toBe(false);
    expect(byId("k-garansi").updatedAt).not.toBe(NOW);
    expect(byId("k-cod").updatedAt).toBe(NOW);
    expect(
      getDb().knowledge.find((k) => k.question === "Bisa tukar tambah?"),
    ).toMatchObject({ answer: "Bisa kak", active: true });
  });

  it("leaves a changed answer alone when its row is unticked", async () => {
    await openWith(
      "answers.csv",
      "Garansi berapa lama?;3 bulan ya kak\nBisa tukar tambah?;Bisa kak\n",
    );
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Garansi berapa lama?" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Import 1" }));

    await waitFor(() => expect(getDb().knowledge).toHaveLength(3));
    expect(getDb().knowledge.find((k) => k.id === "k-garansi")!.answer).toBe(
      "1 bulan ya kak",
    );
  });

  it("offers nothing to import from a file that changes nothing", async () => {
    await openWith("answers.csv", "Cod bisa ga kak?,Bisa kak\n");
    expect(await screen.findByText("no change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0" })).toBeDisabled();
  });
});
