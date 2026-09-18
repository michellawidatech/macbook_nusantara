/**
 * The store against a server — `mock/store.ts` in remote mode, driven by a
 * fake transport (docs/store-on-postgres.md).
 *
 * The rest of the web suite runs the store on the demo seed, which is how it
 * has always tested the pages. This file tests what only exists against a
 * server: what a mutation sends, what happens to the screen when the server
 * refuses it, redoing a change after somebody else was first, keeping a change
 * through a dropped connection, swapping a provisional document number for the
 * real one, and taking in what another till wrote.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLECTION_NAMES,
  SINGLETON_NAMES,
  comparable,
  encodeRow,
  encodeSingleton,
  isProvisionalCode,
  type Changeset,
} from "@nusantara/store";
import { buildSeed, type MockDb } from "../src/mock/seed.js";
import {
  __pollStore,
  __stopStorePolling,
  __useRemoteStore,
  docCode,
  getDb,
  loadStore,
  mutate,
  nextId,
  onStoreError,
  type CommitResult,
  type StoreDelta,
  type StoreTransport,
} from "../src/mock/store.js";
import { ApiOfflineError, ApiRequestError } from "../src/lib/api.js";

function wireOf(db: MockDb): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = db as unknown as Record<string, unknown>;
  for (const name of COLLECTION_NAMES) {
    out[name] = (source[name] as Record<string, unknown>[]).map((r) => encodeRow(name, r));
  }
  for (const name of SINGLETON_NAMES) out[name] = encodeSingleton(name, source[name]);
  return out;
}

/** Every `next` row of a changeset, as the server would echo it back. */
function echo(change: Changeset, cursor: number, codes: Record<string, string> = {}): CommitResult {
  let text = JSON.stringify(change);
  for (const [from, to] of Object.entries(codes)) text = text.split(from).join(to);
  const replaced = JSON.parse(text) as Changeset;
  const rows: Record<string, unknown[]> = {};
  const removed: Record<string, string[]> = {};
  for (const [name, c] of Object.entries(replaced.collections)) {
    rows[name] = c!.rows.flatMap((r) => (r.next === undefined ? [] : [r.next]));
    removed[name] = c!.rows.flatMap((r) => (r.next === undefined ? [r.key] : []));
  }
  return { cursor: String(cursor), rows, removed, codes };
}

interface Fake {
  readonly transport: StoreTransport;
  readonly commits: { change: Changeset; key: string }[];
  snapshot: MockDb;
  onCommit: (change: Changeset, key: string) => Promise<CommitResult>;
  onChanges: (after: string) => Promise<StoreDelta | "RESET">;
}

function fakeServer(): Fake {
  let cursor = 1;
  const fake: Fake = {
    commits: [],
    snapshot: buildSeed(),
    onCommit: async (change) => echo(change, ++cursor),
    onChanges: async () => ({ cursor: String(cursor) }),
    transport: {
      load: async () => ({ cursor: String(cursor), db: wireOf(fake.snapshot) }),
      commit: (change, key) => {
        fake.commits.push({ change, key });
        return fake.onCommit(change, key);
      },
      changes: (after) => fake.onChanges(after),
    },
  };
  return fake;
}

let fake: Fake;

beforeEach(async () => {
  fake = fakeServer();
  __useRemoteStore(fake.transport);
  await loadStore();
  __stopStorePolling();
});

afterEach(() => {
  __stopStorePolling();
  vi.useRealTimers();
});

describe("the store against a server", () => {
  it("loads the shop the server sends", () => {
    expect(comparable(getDb().units)).toBe(comparable(fake.snapshot.units));
    expect(comparable(getDb().settings)).toBe(comparable(fake.snapshot.settings));
  });

  it("shows a change at once and sends only the rows it touched, money as strings", async () => {
    const serial = getDb().units[0]!.serial;
    const done = mutate((d) => {
      d.units[0]!.buy = 4_321_000;
    });
    expect(getDb().units[0]!.buy).toBe(4_321_000);
    expect(await done).toBe(true);
    const sent = fake.commits[0]!.change;
    expect(Object.keys(sent.collections)).toEqual(["units"]);
    const row = sent.collections.units!.rows[0]!;
    expect(row.key).toBe(serial);
    expect(row.next).toMatchObject({ buy: "4321000" });
    expect(row.base).toMatchObject({ buy: String(fake.snapshot.units[0]!.buy) });
  });

  it("mints ids no other till can mint, and provisional document numbers", () => {
    expect(nextId("o")).toMatch(/^o_[a-z0-9]{16}$/);
    expect(isProvisionalCode(docCode("SI"))).toBe(true);
  });

  it("swaps a provisional number for the server's, in the store and in what is still queued", async () => {
    const code = docCode("RV");
    const real = "RV-2026/09-000007";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.onCommit = async (change) => {
      await gate;
      return echo(change, 10, { [code]: real });
    };
    const customer = getDb().customers[0]!;
    const first = mutate((d) => {
      d.reservations.unshift({
        id: "rsv_test",
        code,
        customerId: customer.id,
        when: new Date().toISOString(),
        note: `Hold ${code}`,
        items: [],
        status: "ACTIVE",
      });
    });
    // Queued behind the first, and naming its provisional code.
    const second = mutate((d) => {
      d.reservations.find((r) => r.id === "rsv_test")!.note = `Still ${code}`;
    });
    release();
    fake.onCommit = async (change) => echo(change, 11);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(getDb().reservations.find((r) => r.id === "rsv_test")!.code).toBe(real);
    expect(JSON.stringify(fake.commits[1]!.change)).toContain(real);
    expect(JSON.stringify(fake.commits[1]!.change)).not.toContain(code);
  });

  it("takes a refused change back off the screen and says why", async () => {
    const reasons: string[] = [];
    const stop = onStoreError((m) => reasons.push(m));
    const before = getDb().customers[0]!.name;
    fake.onCommit = async () => {
      throw new ApiRequestError(400, { code: "VALIDASI", message: "Tidak boleh." });
    };
    const done = mutate((d) => {
      d.customers[0]!.name = "Salah";
    });
    expect(getDb().customers[0]!.name).toBe("Salah");
    expect(await done).toBe(false);
    expect(getDb().customers[0]!.name).toBe(before);
    expect(reasons).toEqual(["Tidak boleh."]);
    stop();
  });

  it("takes the edits built on a refused change down with it, in one message", async () => {
    // The owner's report of 2026-09-15: a line was added, its insert refused,
    // and the product picked on it afterwards replayed against a line that no
    // longer existed — one toast per queued edit, in JavaScript's words.
    const reasons: string[] = [];
    const stop = onStoreError((m) => reasons.push(m));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.onCommit = async () => {
      await gate;
      throw new ApiRequestError(400, { code: "VALIDASI", message: "Baris ditolak." });
    };
    const poId = getDb().pos[0]!.id;
    const skuId = getDb().skus[0]!.id;
    const inserted = mutate((d) => {
      d.pos
        .find((p) => p.id === poId)!
        .items.push({ id: "poi_refused", skuId: "", serial: null, qty: 1, unitCost: 0 });
    });
    const picked = mutate((d) => {
      d.pos
        .find((p) => p.id === poId)!
        .items.find((i) => i.id === "poi_refused")!.skuId = skuId;
    });
    release();
    expect(await inserted).toBe(false);
    expect(await picked).toBe(false);
    expect(reasons).toEqual(["Baris ditolak — 1 perubahan sesudahnya ikut dibatalkan."]);
    expect(
      getDb().pos.find((p) => p.id === poId)!.items.some((i) => i.id === "poi_refused"),
    ).toBe(false);
    stop();
  });

  it("names the field of a row the browser could not encode, not a JSON dump", async () => {
    const reasons: string[] = [];
    const stop = onStoreError((m) => reasons.push(m));
    const done = mutate((d) => {
      d.customers[0]!.name = "";
    });
    expect(await done).toBe(false);
    expect(fake.commits).toHaveLength(0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^name: /);
    expect(reasons[0]).not.toContain("[{");
    stop();
  });

  it("redoes a change on the newer copy after somebody else was first", async () => {
    let calls = 0;
    fake.onCommit = async (change) => {
      calls += 1;
      if (calls === 1) {
        // Somebody renamed the second customer meanwhile.
        fake.snapshot = { ...fake.snapshot };
        fake.snapshot.customers = fake.snapshot.customers.map((c, i) =>
          i === 1 ? { ...c, name: "Diubah orang lain" } : c,
        );
        throw new ApiRequestError(409, { code: "KONFLIK", message: "Konflik." });
      }
      return echo(change, 20);
    };
    const done = mutate((d) => {
      d.customers[0]!.name = "Punyaku";
    });
    expect(await done).toBe(true);
    expect(fake.commits).toHaveLength(2);
    expect(fake.commits[1]!.key).not.toBe(fake.commits[0]!.key);
    expect(getDb().customers[0]!.name).toBe("Punyaku");
    expect(getDb().customers[1]!.name).toBe("Diubah orang lain");
  });

  it("keeps a change through a dropped connection and sends it when it is back", async () => {
    vi.useFakeTimers();
    let calls = 0;
    fake.onCommit = async (change) => {
      calls += 1;
      if (calls === 1) throw new ApiOfflineError();
      return echo(change, 30);
    };
    const done = mutate((d) => {
      d.customers[0]!.name = "Nanti";
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDb().customers[0]!.name).toBe("Nanti");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBe(true);
    expect(fake.commits).toHaveLength(2);
    // The same body under the same key: a commit that did land is not repeated.
    expect(fake.commits[1]!.key).toBe(fake.commits[0]!.key);
  });

  it("takes in what another till wrote", async () => {
    const other = { ...fake.snapshot.customers[0]!, name: "Dari kasir lain" };
    fake.onChanges = async () => ({
      cursor: "99",
      rows: { customers: [encodeRow("customers", other)] },
    });
    await __pollStore();
    expect(getDb().customers[0]!.name).toBe("Dari kasir lain");
  });
});
