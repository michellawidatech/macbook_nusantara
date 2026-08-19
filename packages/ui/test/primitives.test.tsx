/**
 * The state primitives: useUrlState (02 §7), DraftStore (02 §7),
 * Money/MoneyInput (02 §9, §5), FacetFilter/FilterChipBar (02 §8),
 * shortcuts + KeyboardHelp + CommandPalette (02 §2).
 */

import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  CommandPalette,
  CommandRegistryProvider,
  DraftBar,
  draftKey,
  FacetFilter,
  FilterChipBar,
  KeyboardHelp,
  loadDraft,
  matchCommands,
  Money,
  MoneyInput,
  saveDraft,
  ShortcutProvider,
  useCommandProvider,
  useDraftAutosave,
  useShortcut,
  useUrlState,
} from "../src/index.js";

beforeEach(() => {
  globalThis.localStorage?.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- useUrlState ------------------------------------------------------------

let lastUrl = "";
function UrlProbe() {
  const loc = useLocation();
  lastUrl = `${loc.pathname}${loc.search}`;
  return null;
}

function renderUrlState(initial = "/halaman") {
  return renderHook(() => useUrlState(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[initial]}>
        <UrlProbe />
        {children}
      </MemoryRouter>
    ),
  });
}

describe("useUrlState — 02 §7", () => {
  it("round-trips lists, resets the page on any filter change", () => {
    const { result } = renderUrlState("/halaman?page=3");

    act(() => result.current.toggleInList("lokasi", "toko"));
    expect(lastUrl).toBe("/halaman?lokasi=toko");
    expect(result.current.getList("lokasi")).toEqual(["toko"]);

    act(() => result.current.toggleInList("lokasi", "gudang"));
    expect(result.current.getList("lokasi")).toEqual(["toko", "gudang"]);

    act(() => result.current.toggleInList("lokasi", "toko"));
    expect(result.current.getList("lokasi")).toEqual(["gudang"]);

    // Removing the last value removes the param: reset URL == pristine URL.
    act(() => result.current.toggleInList("lokasi", "gudang"));
    expect(lastUrl).toBe("/halaman");
  });

  it("reads and writes sort in the S9-compatible sort/dir shape", () => {
    const { result } = renderUrlState("/halaman?sort=landed&dir=desc");
    expect(result.current.getSort({ column: "serial", dir: "asc" })).toEqual([
      { column: "landed", dir: "desc" },
    ]);

    act(() =>
      result.current.setSort([
        { column: "landed", dir: "desc" },
        { column: "serial", dir: "asc" },
      ]),
    );
    expect(lastUrl).toContain("sort=landed%2Cserial");
    expect(lastUrl).toContain("dir=desc%2Casc");

    expect(result.current.getSort({ column: "serial", dir: "asc" })).toEqual([
      { column: "landed", dir: "desc" },
      { column: "serial", dir: "asc" },
    ]);
  });

  it("set removes empty values and keeps page only when told", () => {
    const { result } = renderUrlState("/halaman?page=2&q=abc");
    act(() => result.current.set("q", ""));
    expect(lastUrl).toBe("/halaman");

    act(() => result.current.set("drawer", "unit_1", { keepPage: true }));
    expect(lastUrl).toBe("/halaman?drawer=unit_1");
  });

  it("reset returns to the pristine URL", () => {
    const { result } = renderUrlState("/halaman?lokasi=a&q=x&page=4");
    act(() => result.current.reset());
    expect(lastUrl).toBe("/halaman");
  });
});

// --- DraftStore -------------------------------------------------------------

describe("DraftStore — 02 §7", () => {
  it("round-trips a draft with BigInt money intact", () => {
    const key = draftKey("staff_1", "kasir");
    saveDraft(
      key,
      { lines: [{ serial: "NUS1", price: 12_400_000n }] },
      new Date("2026-08-15T14:32:00"),
    );

    const draft = loadDraft<{ lines: { serial: string; price: bigint }[] }>(
      key,
    );
    expect(draft?.value.lines[0]?.price).toBe(12_400_000n);
    expect(typeof draft?.value.lines[0]?.price).toBe("bigint");
    expect(draft?.savedAt.getHours()).toBe(14);

    clearDraft(key);
    expect(loadDraft(key)).toBeNull();
  });

  it("a corrupt draft is silently not offered", () => {
    globalThis.localStorage?.setItem("nusantara.draft.s.x", "{broken");
    expect(loadDraft("nusantara.draft.s.x")).toBeNull();
  });

  it("autosaves debounced, and never saves the mount render", async () => {
    vi.useFakeTimers();
    const key = draftKey("staff_1", "po");

    const { rerender } = renderHook(
      ({ value }: { value: { qty: number } }) =>
        useDraftAutosave(key, value, { delayMs: 400 }),
      { initialProps: { value: { qty: 1 } } },
    );

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    // Mount state is not an edit: restoring it would clobber a real draft.
    expect(loadDraft(key)).toBeNull();

    rerender({ value: { qty: 2 } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(loadDraft<{ qty: number }>(key)?.value.qty).toBe(2);
  });

  it("DraftBar words the §7 bar exactly and offers both actions", async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    const discard = vi.fn();
    render(
      <DraftBar
        savedAt={new Date("2026-08-15T14:32:00")}
        onRestore={restore}
        onDiscard={discard}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Draft dari 14.32");
    await user.click(screen.getByRole("button", { name: "Pulihkan" }));
    await user.click(screen.getByRole("button", { name: "Buang" }));
    expect(restore).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
  });
});

// --- Money / MoneyInput -----------------------------------------------------

describe("Money — 02 §9", () => {
  it("negative and zero are distinct, with a word not just a colour", () => {
    render(
      <>
        <Money value={4_200_000n} />
        <Money value={-50_000n} />
        <Money value={0n} />
      </>,
    );
    expect(screen.getByTitle("rugi")).toHaveTextContent("-Rp");
    expect(screen.getByTitle("gratis")).toHaveTextContent("Rp");
  });
});

describe("MoneyInput — 02 §9 and §5", () => {
  function Harness({ initial = null as bigint | null }) {
    const [value, setValue] = useState<bigint | null>(initial);
    return (
      <>
        <MoneyInput label="Harga" value={value} onChange={setValue} />
        <output data-testid="value">
          {value === null ? "null" : value.toString()}
        </output>
      </>
    );
  }

  it.each([
    ["4200000", "4200000"],
    ["4.200.000", "4200000"],
    ["4,2jt", "4200000"],
    ["4200rb", "4200000"],
  ])("accepts %s and normalizes on blur", (typed, expected) => {
    render(<Harness />);
    const input = screen.getByLabelText("Harga");
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);
    expect(screen.getByTestId("value")).toHaveTextContent(expected);
    expect(input).toHaveValue("4.200.000"); // the formatted result, shown
  });

  it("rejects nonsense with the reason under the field, keeping the value (§5)", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Harga");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("abc"); // never cleared
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Format tidak dikenali",
    );
    expect(screen.getByTestId("value")).toHaveTextContent("null");
  });

  it("names the whole-rupiah rule for fractions", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Harga");
    fireEvent.change(input, { target: { value: "4,5" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Harus rupiah bulat");
  });

  it("an empty optional field is null, not an error", () => {
    render(<Harness initial={5_000n} />);
    const input = screen.getByLabelText("Harga");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("value")).toHaveTextContent("null");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });
});

// --- FacetFilter / FilterChipBar -------------------------------------------

describe("filters — 02 §8", () => {
  it("facet is multi-select and announces counts with a unit", async () => {
    const user = userEvent.setup();
    const toggled: string[] = [];
    render(
      <FacetFilter
        label="Lokasi"
        options={[
          { id: "toko", name: "Toko", count: 40 },
          { id: "gudang", name: "Gudang", count: 4_960 },
        ]}
        selected={["toko"]}
        onToggle={(id) => toggled.push(id)}
      />,
    );

    expect(
      screen.getByText("Lokasi (1)", { selector: "summary" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Toko\b/)).toBeChecked();
    await user.click(screen.getByLabelText(/^Gudang\b/));
    expect(toggled).toEqual(["gudang"]);
  });

  it("chips remove one filter each; Reset clears all", async () => {
    const user = userEvent.setup();
    const removed: string[] = [];
    const reset = vi.fn();
    render(
      <FilterChipBar
        chips={[
          {
            key: "lokasi:toko",
            label: "Lokasi: Toko",
            srLabel: "Hapus filter Toko",
            onRemove: () => removed.push("toko"),
          },
        ]}
        onReset={reset}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Lokasi: Toko/ }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(removed).toEqual(["toko"]);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders nothing at all when no filter is active", () => {
    render(<FilterChipBar chips={[]} onReset={() => undefined} />);
    expect(screen.queryByLabelText("Filter aktif")).not.toBeInTheDocument();
  });
});

// --- shortcuts / KeyboardHelp / CommandPalette ------------------------------

describe("shortcuts — 02 §2", () => {
  function Page({
    onSlash,
    onLetter,
  }: {
    onSlash?: () => void;
    onLetter?: () => void;
  }) {
    useShortcut({
      combo: "/",
      description: "Fokus ke pencarian",
      group: "Halaman ini",
      handler: onSlash ?? (() => undefined),
    });
    useShortcut({
      combo: "n",
      description: "Tambah catatan",
      group: "Halaman ini",
      handler: onLetter ?? (() => undefined),
    });
    return <input aria-label="Cari" />;
  }

  it("fires a bare key on the page but never from inside a text input", () => {
    const onLetter = vi.fn();
    render(
      <ShortcutProvider>
        <Page onLetter={onLetter} />
      </ShortcutProvider>,
    );

    fireEvent.keyDown(document.body, { key: "n" });
    expect(onLetter).toHaveBeenCalledOnce();

    const input = screen.getByLabelText("Cari");
    input.focus();
    fireEvent.keyDown(input, { key: "n" });
    expect(onLetter).toHaveBeenCalledOnce(); // still once — §2's rule
  });

  it("mod combos fire even from inside an input", () => {
    const onCombo = vi.fn();
    function WithCombo() {
      useShortcut({ combo: "mod+k", description: "Palet", handler: onCombo });
      return <input aria-label="Cari" />;
    }
    render(
      <ShortcutProvider>
        <WithCombo />
      </ShortcutProvider>,
    );

    const input = screen.getByLabelText("Cari");
    input.focus();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    expect(onCombo).toHaveBeenCalledOnce();
  });

  it("? opens the help sheet listing the page's registered shortcuts", () => {
    render(
      <ShortcutProvider>
        <Page />
        <KeyboardHelp />
      </ShortcutProvider>,
    );

    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });

    const dialog = screen.getByRole("dialog", { name: "Pintasan keyboard" });
    expect(dialog).toHaveTextContent("Fokus ke pencarian");
    expect(dialog).toHaveTextContent("Tambah catatan");
    expect(dialog).toHaveTextContent("Halaman ini");
    // The sheet's own shortcut is listed too — it registered like everyone.
    expect(dialog).toHaveTextContent("Bantuan pintasan keyboard");
  });

  it("a page shortcut unregisters with its page", () => {
    const onLetter = vi.fn();
    const view = render(
      <ShortcutProvider>
        <Page onLetter={onLetter} />
      </ShortcutProvider>,
    );
    view.rerender(<ShortcutProvider>{null}</ShortcutProvider>);
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onLetter).not.toHaveBeenCalled();
  });
});

describe("CommandPalette — 02 §2", () => {
  function Providers({ run }: { run: (id: string) => void }) {
    useCommandProvider("nav", () => [
      {
        id: "nav:inventori",
        label: "Buka Inventori",
        hint: "Katalog",
        run: () => run("inventori"),
      },
      {
        id: "nav:kasir",
        label: "Buka Kasir",
        hint: "Penjualan",
        run: () => run("kasir"),
      },
    ]);
    return null;
  }

  function renderPalette(run: (id: string) => void = () => undefined) {
    return render(
      <ShortcutProvider>
        <CommandRegistryProvider>
          <Providers run={run} />
          <CommandPalette />
        </CommandRegistryProvider>
      </ShortcutProvider>,
    );
  }

  it("opens with mod+k, filters, and runs the active command on Enter", async () => {
    const ran: string[] = [];
    renderPalette((id) => ran.push(id));

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", {
      name: "Cari perintah",
    });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "kasir" } });
    expect(
      screen.getByRole("option", { name: /Buka Kasir/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Buka Inventori/ }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(ran).toEqual(["kasir"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("arrows move the active option", () => {
    const ran: string[] = [];
    renderPalette((id) => ran.push(id));

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const input = screen.getByRole("combobox", { name: "Cari perintah" });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ran).toEqual(["kasir"]); // second in the list
  });

  it("providers are pluggable: unmounting one removes its commands", () => {
    function Removable({ mounted }: { mounted: boolean }) {
      return (
        <ShortcutProvider>
          <CommandRegistryProvider>
            {mounted ? <Providers run={() => undefined} /> : null}
            <CommandPalette />
          </CommandRegistryProvider>
        </ShortcutProvider>
      );
    }
    const view = render(<Removable mounted />);
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(
      screen.getByRole("option", { name: /Buka Inventori/ }),
    ).toBeInTheDocument();

    view.rerender(<Removable mounted={false} />);
    const input = screen.getByRole("combobox", { name: "Cari perintah" });
    fireEvent.change(input, { target: { value: "" } });
    expect(
      screen.queryByRole("option", { name: /Buka Inventori/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Tidak ada perintah yang cocok."),
    ).toBeInTheDocument();
  });

  it("matchCommands is a case-insensitive substring match", () => {
    const commands = [
      { id: "a", label: "Buka Inventori", run: () => undefined },
      { id: "b", label: "Buka Kasir", run: () => undefined },
    ];
    expect(matchCommands(commands, "INVEN")).toHaveLength(1);
    expect(matchCommands(commands, "")).toHaveLength(2);
    expect(matchCommands(commands, "zzz")).toHaveLength(0);
  });
});
