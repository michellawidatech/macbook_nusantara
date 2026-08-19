/**
 * Overlay (02 §3) and UndoToast (02 §6) — the two components whose whole value
 * is behaviour under pressure: focus, escape, unsaved input, and the undo
 * window's clock.
 */

import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "../src/Overlay.js";
import { ToastProvider, useToast } from "../src/UndoToast.js";

afterEach(() => {
  vi.useRealTimers();
});

function OverlayHarness({ dirty }: { readonly dirty: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <Overlay
        open={open}
        onOpenChange={setOpen}
        title="Detail unit"
        variant="drawer"
        dirty={dirty}
      >
        <input aria-label="Catatan" />
      </Overlay>
    </>
  );
}

describe("Overlay — 02 §3", () => {
  it("opens focused inside, closes on Esc, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<OverlayHarness dirty={false} />);

    const opener = screen.getByRole("button", { name: "Buka" });
    opener.focus();
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Detail unit" });
    // The trap put focus inside the overlay, not left it behind.
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Radix restores focus in an effect cleanup — one tick later in jsdom.
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("with unsaved input, Esc asks once and the second Esc closes", async () => {
    const user = userEvent.setup();
    render(<OverlayHarness dirty />);
    await user.click(screen.getByRole("button", { name: "Buka" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    // Still open, and the question is on screen.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Perubahan belum disimpan — tekan Esc sekali lagi untuk menutup.",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("with unsaved input, outside interaction does not close it", async () => {
    const user = userEvent.setup();
    render(<OverlayHarness dirty />);
    await user.click(screen.getByRole("button", { name: "Buka" }));
    await screen.findByRole("dialog");

    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clean overlays close from the labelled close control", async () => {
    const user = userEvent.setup();
    render(<OverlayHarness dirty={false} />);
    await user.click(screen.getByRole("button", { name: "Buka" }));
    await user.click(await screen.findByRole("button", { name: "Tutup" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function ToastHarness({
  onUndo,
  onExpire,
}: {
  onUndo?: () => void;
  onExpire?: () => void;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.showUndo({ message: "Baris kasir dihapus", onUndo, onExpire })
      }
    >
      Hapus
    </button>
  );
}

describe("UndoToast — 02 §6", () => {
  it("announces politely and never steals focus (§3)", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness onUndo={() => undefined} />
      </ToastProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Hapus" });
    await user.click(trigger);

    expect(screen.getByText("Baris kasir dihapus")).toBeInTheDocument();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    // Focus stayed exactly where it was.
    expect(trigger).toHaveFocus();
  });

  it("Urungkan runs the undo and dismisses", async () => {
    const user = userEvent.setup();
    const undone = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={undone} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Hapus" }));
    await user.click(screen.getByRole("button", { name: "Urungkan" }));

    expect(undone).toHaveBeenCalledOnce();
    expect(screen.queryByText("Baris kasir dihapus")).not.toBeInTheDocument();
  });

  it("shows a visible countdown and expires after 8 s (§6's number)", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={() => undefined} onExpire={expired} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByTestId("toast-timer")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByText("5")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(screen.queryByText("Baris kasir dihapus")).not.toBeInTheDocument();
    expect(expired).toHaveBeenCalledOnce();
  });

  it("hovering pauses the clock — reading must not spend the undo window", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness onUndo={() => undefined} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    const toast = screen.getByText("Baris kasir dihapus").closest("div")!;

    fireEvent.mouseEnter(toast);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    // Ten seconds later, still there: the clock was paused.
    expect(screen.getByText("Baris kasir dihapus")).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    await act(() => vi.advanceTimersByTimeAsync(8_100));
    expect(screen.queryByText("Baris kasir dihapus")).not.toBeInTheDocument();
  });
});
