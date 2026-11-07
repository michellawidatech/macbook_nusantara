/**
 * A photo the server refused is not silently gone (client report
 * 2026-11-07): it stays as a red tile with a retry, because the photo is still
 * in hand, and the retry saves it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  qcPhotosOf,
  type CommitResult,
} from "../src/mock/store.js";
import { ApiRequestError } from "../src/lib/api.js";
import { UnitPhotos } from "../src/components/UnitPhotos.js";
import { __clearPhotoIssues } from "../src/lib/photoIssues.js";

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

function echo(change: Changeset, cursor: number): CommitResult {
  const rows: Record<string, unknown[]> = {};
  for (const [name, c] of Object.entries(change.collections)) {
    rows[name] = c!.rows.flatMap((r) => (r.next === undefined ? [] : [r.next]));
  }
  return { cursor: String(cursor), rows, removed: {}, codes: {} };
}

let refuse = true;
let snapshot: MockDb;

beforeEach(async () => {
  __clearPhotoIssues();
  refuse = true;
  snapshot = buildSeed();
  let cursor = 1;
  __useRemoteStore({
    load: async () => ({ cursor: String(cursor), db: wireOf(snapshot) }),
    commit: async (change) => {
      if (refuse) {
        throw new ApiRequestError(400, {
          code: "VALIDASI",
          message: "Foto terlalu besar (maksimal 8 MB).",
        });
      }
      return echo(change, ++cursor);
    },
    changes: async () => ({ cursor: String(cursor) }),
  });
  await loadStore();
  __stopStorePolling();
});

afterEach(() => __stopStorePolling());

describe("a photo the server refused", () => {
  it("stays as a red tile with a retry, and the retry saves it", async () => {
    const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
    const before = qcPhotosOf(getDb(), serial).length;
    const { container } = render(
      <AntdApp>
        <UnitPhotos serial={serial} editable size={72} />
      </AntdApp>,
    );
    fireEvent.change(container.querySelector("input[type=file]")!, {
      target: {
        files: [
          new File([new Uint8Array(2048).fill(7)], "lid.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });

    expect(
      await screen.findByLabelText("lid.jpg was not added"),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not be saved/)).toBeInTheDocument();
    expect(qcPhotosOf(getDb(), serial)).toHaveLength(before);

    refuse = false;
    fireEvent.click(screen.getByLabelText("Retry lid.jpg"));
    expect(
      await screen.findByText(`1 photo(s) added to ${serial}.`),
    ).toBeInTheDocument();
    expect(qcPhotosOf(getDb(), serial)).toHaveLength(before + 1);
    expect(screen.queryByLabelText("lid.jpg was not added")).toBeNull();
  });
});
