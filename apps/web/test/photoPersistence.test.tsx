/**
 * A photo that is on screen and then gone after a refresh (client report
 * 2026-10-21: *"when they upload photo, then they refresh, the photo is
 * gone"*).
 *
 * The server keeps a photo once it has it — `packages/db`'s unitNotes adapter
 * stores the bytes and projects a `/api/store/photos/:id` url, which was
 * checked over HTTP the same day. Both losses were in the browser:
 *
 * - A photo of a unit with a serial was drawn, and announced as added, the
 *   moment it was picked, while a full-size phone photo (several megabytes of
 *   text) was still being sent. A refresh in that window cancelled the send
 *   and nothing said so.
 * - A photo of an inbound row with no serial yet lives in `localStorage`
 *   only, whose few megabytes one phone photo fills. The write was refused in
 *   silence and the refresh brought back the row without it.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLECTION_NAMES,
  SINGLETON_NAMES,
  encodeRow,
  encodeSingleton,
  type Changeset,
} from "@nusantara/store";
import { buildSeed, type MockDb } from "../src/mock/seed.js";
import {
  __stopStorePolling,
  __useRemoteStore,
  getDb,
  loadStore,
  mutate,
  qcPhotosOf,
  type CommitResult,
} from "../src/mock/store.js";
import { UnitPhotos } from "../src/components/UnitPhotos.js";
import { StoreGate } from "../src/components/StoreGate.js";
import {
  draftKey,
  usePersistentState,
} from "../src/hooks/usePersistentState.js";
import { fitWithin } from "../src/lib/photoShrink.js";

function wireOf(db: MockDb): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = db as unknown as Record<string, unknown>;
  for (const name of COLLECTION_NAMES) {
    out[name] = (source[name] as Record<string, unknown>[]).map((r) =>
      encodeRow(name, r),
    );
  }
  for (const name of SINGLETON_NAMES)
    out[name] = encodeSingleton(name, source[name]);
  return out;
}

/** Every `next` row of a changeset, as the server would echo it back. */
function echo(change: Changeset, cursor: number): CommitResult {
  const rows: Record<string, unknown[]> = {};
  for (const [name, c] of Object.entries(change.collections)) {
    rows[name] = c!.rows.flatMap((r) => (r.next === undefined ? [] : [r.next]));
  }
  return { cursor: String(cursor), rows, removed: {}, codes: {} };
}

/** A server whose commits wait until the test lets them through. */
let release: () => void = () => {};
let commits = 0;

beforeEach(async () => {
  commits = 0;
  const snapshot = buildSeed();
  let cursor = 1;
  __useRemoteStore({
    load: async () => ({ cursor: String(cursor), db: wireOf(snapshot) }),
    commit: async (change) => {
      commits += 1;
      await new Promise<void>((r) => (release = r));
      return echo(change, ++cursor);
    },
    changes: async () => ({ cursor: String(cursor) }),
  });
  await loadStore();
  __stopStorePolling();
});

afterEach(() => {
  release();
  __stopStorePolling();
});

const photoFile = () =>
  new File([new Uint8Array(2048).fill(7)], "lid.jpg", { type: "image/jpeg" });

describe("a photo of a unit", () => {
  it("is announced as added only once the server has it", async () => {
    const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
    const { container } = render(
      <AntdApp>
        <UnitPhotos serial={serial} editable />
      </AntdApp>,
    );
    fireEvent.change(container.querySelector("input[type=file]")!, {
      target: { files: [photoFile()] },
    });

    // Sent, and on screen, but not saved yet — so not "added".
    await vi.waitFor(() => expect(commits).toBe(1));
    expect(qcPhotosOf(getDb(), serial)).toHaveLength(1);
    // antd draws a toast a moment after it is called; give it that moment.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(screen.queryByText(/photo\(s\) added/)).toBeNull();

    await act(async () => release());
    expect(await screen.findByText(/1 photo\(s\) added/)).toBeInTheDocument();
  });
});

describe("leaving the page", () => {
  it("asks first while a change has not reached the server", async () => {
    render(
      <AntdApp>
        <StoreGate staffName="Michella">
          <p>page</p>
        </StoreGate>
      </AntdApp>,
    );
    await screen.findByText("page");

    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);

    let saved!: Promise<boolean>;
    act(() => {
      saved = mutate((d) => {
        d.units[0]!.description = "Penyok di sudut";
      });
    });
    expect(leave()).toBe(true);

    await act(async () => {
      release();
      await saved;
    });
    expect(leave()).toBe(false);
  });
});

describe("a draft this device cannot keep", () => {
  it("says so rather than pretending it will outlive a refresh", () => {
    const key = draftKey("test.photos");
    const real = localStorage.setItem.bind(localStorage);
    // A browser's quota: a few megabytes per site, and a phone photo is one.
    vi.spyOn(localStorage, "setItem").mockImplementation((k, v) => {
      if (v.length > 5_000_000) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      real(k, v);
    });
    const hook = renderHook(() => usePersistentState(key, ""));
    expect(hook.result.current[3]).toBe(true);

    act(() => hook.result.current[1]("x".repeat(6_000_000)));
    expect(hook.result.current[3]).toBe(false);

    act(() => hook.result.current[1]("small again"));
    expect(hook.result.current[3]).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("shrinking a photo", () => {
  it("fits the long edge and keeps the shape", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
