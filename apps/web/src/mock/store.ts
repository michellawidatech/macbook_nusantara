/**
 * The store every POS screen reads.
 *
 * ## Where the data comes from (2026-09-13)
 *
 * Until this date this module held an in-memory demo shop that reset on every
 * reload, and every browser had its own copy. It is now the browser's copy of
 * PostgreSQL — docs/store-on-postgres.md is the design:
 *
 * - `loadStore()` fetches `/api/store`: the whole shop, in the shape the pages
 *   already read.
 * - `mutate(fn)` runs `fn` on a copy-on-write draft, shows the result at once,
 *   and commits the rows it changed to `/api/store/commit`, one commit at a
 *   time, in the order they were made.
 * - Every few seconds the store asks `/api/store/changes` what the other tills
 *   did.
 *
 * `useDb()` and `mutate(fn)` keep the signatures every page was written
 * against, which is the point of the design: no page had to learn a new data
 * layer, and every tested `lib/` function still reads the same shape.
 *
 * Under the test runner (`import.meta.env.MODE === "test"`) nothing is fetched:
 * the store boots on the demo seed exactly as it always has, so the web suite
 * keeps exercising the pages without a server.
 *
 * ## What the server decides, not this file
 *
 * Document numbers (a provisional `SI-2026/09-Tk3x9q2a` is swapped for the real
 * one), who did it (the session, not the name typed here), and whether a change
 * is allowed at all — the ledger is append-only, a unit's status moves only
 * with the event that explains it. A refused commit is undone on screen and
 * its reason reaches `onStoreError`.
 *
 * Money stays whole-rupiah numbers in here and travels as strings;
 * `@nusantara/store` converts at the boundary.
 */
import { useSyncExternalStore } from "react";
import { produce, setAutoFreeze } from "immer";
import {
  applyRows,
  decodeRow,
  decodeSingleton,
  decodeStore,
  diffStore,
  encodeChangeset,
  isCollectionName,
  isEmptyChangeset,
  isSingletonName,
  keyOf,
  replaceStrings,
  type Changeset,
  type CollectionName,
  type Row,
  type SingletonName,
  type StoreShape,
} from "@nusantara/store";
import {
  buildSeed,
  type MockDb,
  type ReasonActivity,
  type UnitNotePhoto,
} from "./seed.js";
import { purgePlaceholderUnits } from "../lib/inboundQc.js";
import { ApiOfflineError, ApiRequestError, api } from "../lib/api.js";
import { fmtNone } from "../lib/format.js";

// Pages keep references to rows they read and occasionally compare them after
// a write; a frozen object would throw where a plain one never did.
setAutoFreeze(false);

/**
 * Boot, minus the residue of a withdrawn design.
 *
 * Arrival used to mint a `TBD-…` unit for every line-quantity, so a store could
 * be carrying units that stand for no machine. Nothing mints them any more
 * (see lib/inboundQc.ts) and the owner asked for the ones already there to be
 * deleted outright rather than migrated — a row with no serial is not about
 * anything, so there is nothing it could be reconciled against. The seed has
 * never written one; this is here so that no store can start holding one.
 */
function boot(): MockDb {
  const seeded = buildSeed();
  purgePlaceholderUnits(seeded);
  return seeded;
}

/** What a remote store shows before its first load lands. */
function emptyDb(): MockDb {
  return {
    settings: { batteryGoodMin: 80, batteryFairMin: 76 },
    paymentMethods: [],
    warehouses: [],
    racks: [],
    suppliers: [],
    reasons: [],
    qcDescriptions: [],
    gradingCriteria: [],
    gradingRules: [],
    reservationSources: [],
    salesmen: [],
    categories: [],
    models: [],
    appleDbHidden: [],
    skus: [],
    units: [],
    events: [],
    unitNotes: [],
    pos: [],
    stockMoves: [],
    stockIns: [],
    customers: [],
    orders: [],
    returns: [],
    reservations: [],
    discounts: [],
    expenses: [],
    incomes: [],
    paymentLog: [],
    settlements: [],
    settlementLog: [],
    services: [],
    deposits: [],
    chats: [],
    knowledge: [],
    corrections: [],
    personas: [],
    activePersonaId: "",
    adjustments: [],
    opnames: [],
    referralSources: [],
    myWarehouseId: "",
  };
}

// ---------------------------------------------------------------------------
// The conversation with the server
// ---------------------------------------------------------------------------

/** Rows that changed since a cursor, as the server sends them (wire form). */
export interface StoreDelta {
  readonly cursor: string;
  readonly rows?: Partial<Record<CollectionName, readonly unknown[]>>;
  readonly removed?: Partial<Record<CollectionName, readonly string[]>>;
  /** Every key of an ordered collection whose order moved. */
  readonly order?: Partial<Record<CollectionName, readonly string[]>>;
  readonly singletons?: Partial<Record<SingletonName, unknown>>;
}

export interface CommitResult extends StoreDelta {
  /** Provisional document code → the number the server gave it. */
  readonly codes?: Readonly<Record<string, string>>;
}

export interface StoreSnapshot {
  readonly cursor: string;
  readonly db: unknown;
}

export interface StoreTransport {
  load(): Promise<StoreSnapshot>;
  commit(change: Changeset, idempotencyKey: string): Promise<CommitResult>;
  /** `"RESET"` when the cursor is older than the server keeps changes for. */
  changes(after: string): Promise<StoreDelta | "RESET">;
}

const httpTransport: StoreTransport = {
  load: () => api<StoreSnapshot>("/api/store"),
  commit: (change, idempotencyKey) =>
    api<CommitResult>("/api/store/commit", {
      method: "POST",
      body: change,
      idempotencyKey,
    }),
  changes: async (after) => {
    try {
      return await api<StoreDelta>(
        `/api/store/changes?after=${encodeURIComponent(after)}`,
      );
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 410) return "RESET";
      throw e;
    }
  },
};

export type StorePhase = "idle" | "loading" | "ready" | "error";

export interface StoreStatus {
  readonly phase: StorePhase;
  /** Why the last load failed, in the server's words. */
  readonly error?: string;
  /** Changes on screen that the server has not confirmed yet. */
  readonly pending: number;
  /** True while commits wait for the connection to come back. */
  readonly offline: boolean;
}

interface Pending {
  key: string;
  readonly fn: (draft: MockDb) => void;
  change: Changeset;
  attempts: number;
  readonly done: (committed: boolean) => void;
}

let remote = import.meta.env.MODE !== "test";
let transport: StoreTransport = httpTransport;

/** What pages see: the server's copy with every queued change laid on top. */
let db: MockDb = remote ? emptyDb() : boot();
/** The server's copy, as of `cursor`. */
let confirmed: MockDb = db;
let cursor = "0";
let status: StoreStatus = {
  phase: remote ? "idle" : "ready",
  pending: 0,
  offline: false,
};
let queue: Pending[] = [];
let inFlight = false;
let poller: ReturnType<typeof setInterval> | undefined;

const POLL_MS = 5_000;
const RETRY_MS = 3_000;

const listeners = new Set<() => void>();
const errorListeners = new Set<(message: string) => void>();

function notify(): void {
  for (const l of listeners) l();
}

function setStatus(next: Partial<StoreStatus>): void {
  status = { ...status, ...next };
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const asShape = (value: MockDb): StoreShape => value as unknown as StoreShape;

export function useDb(): MockDb {
  return useSyncExternalStore(subscribe, () => db);
}

export function useStoreStatus(): StoreStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/**
 * The store as it stands, outside React.
 *
 * For tests and for code that is not a component. Never keep the draft a
 * `mutate` callback receives for this: it is a copy-on-write proxy that stops
 * working the moment the callback returns.
 */
export function getDb(): MockDb {
  return db;
}

/** Why a commit was refused, for whoever shows the toast. */
export function onStoreError(fn: (message: string) => void): () => void {
  errorListeners.add(fn);
  return () => {
    errorListeners.delete(fn);
  };
}

/** Fetch the shop. Safe to call again — a retry after a failed load. */
export async function loadStore(): Promise<void> {
  if (!remote || status.phase === "loading") return;
  setStatus({ phase: "loading", error: undefined });
  try {
    const snapshot = await transport.load();
    confirmed = decodeStore(snapshot.db) as unknown as MockDb;
    cursor = snapshot.cursor;
    let view = confirmed;
    for (const p of queue) view = applyChange(view, p.change);
    db = view;
    setStatus({ phase: "ready" });
    startPolling();
  } catch (e) {
    setStatus({ phase: "error", error: messageOf(e) });
  }
}

/**
 * Change the store.
 *
 * `fn` edits a draft; the result is on screen before this returns. The
 * promise settles when the server has answered: `true` when the change is in
 * PostgreSQL, `false` when it was refused and taken back off the screen. Most
 * callers never look — a modal's `onOk` that returns it simply keeps its
 * button spinning until the save is real.
 */
export function mutate(fn: (draft: MockDb) => void): Promise<boolean> {
  const before = db;
  const after = produce(before, (draft) => {
    fn(draft as MockDb);
  });
  if (after === before) return Promise.resolve(true);
  db = after;
  if (!remote) {
    notify();
    return Promise.resolve(true);
  }
  const change = diffStore(asShape(before), asShape(after));
  if (isEmptyChangeset(change)) {
    notify();
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    queue.push({
      key: randomToken(24),
      fn,
      change,
      attempts: 0,
      done: resolve,
    });
    setStatus({ pending: queue.length });
    void pump();
  });
}

async function pump(): Promise<void> {
  if (inFlight) return;
  const head = queue[0];
  if (head === undefined) return;
  if (isEmptyChangeset(head.change)) {
    queue.shift();
    head.done(true);
    setStatus({ pending: queue.length });
    void pump();
    return;
  }

  inFlight = true;
  let retryIn = 0;
  try {
    const result = await transport.commit(
      encodeChangeset(head.change),
      head.key,
    );
    queue.shift();
    absorb(result, result.codes);
    head.done(true);
    if (status.offline) setStatus({ offline: false });
  } catch (e) {
    if (e instanceof ApiOfflineError) {
      // Nothing is lost: the change stays queued and on screen, and the same
      // idempotency key makes a commit that did land harmless to send again.
      setStatus({ offline: true });
      retryIn = RETRY_MS;
    } else if (
      e instanceof ApiRequestError &&
      e.status === 409 &&
      head.attempts < 3
    ) {
      // Somebody else changed a row this change was based on. Take their
      // version and redo the change on top of it.
      head.attempts += 1;
      await rebase().catch(() => {
        retryIn = RETRY_MS;
      });
    } else {
      queue.shift();
      // Back to what the server holds BEFORE anybody is told: the promise
      // settling is a caller's cue that the screen is honest again.
      //
      // The edits queued behind the refused one are replayed QUIETLY (owner
      // report 2026-09-15). Those that leaned on it — picking the product of
      // the line whose insert was just refused — cannot apply any more, and
      // each used to raise its own toast in JavaScript's words ("Cannot set
      // properties of undefined"). One message, about the change the person
      // actually made, says what happened.
      const dropped = await rebase(true).catch(() => 0);
      report(e, dropped);
      head.done(false);
    }
  } finally {
    inFlight = false;
    setStatus({ pending: queue.length });
  }
  if (retryIn > 0) setTimeout(() => void pump(), retryIn);
  else if (queue.length > 0) void pump();
}

/**
 * Start again from the server's copy: reload it, then re-run every queued
 * mutation on top. Used after a conflict, and after a refusal to take the
 * refused change back off the screen.
 */
async function rebase(quiet = false): Promise<number> {
  const snapshot = await transport.load();
  confirmed = decodeStore(snapshot.db) as unknown as MockDb;
  cursor = snapshot.cursor;
  let view = confirmed;
  const kept: Pending[] = [];
  /** Queued changes that no longer apply, and were refused. */
  let dropped = 0;
  for (const p of queue) {
    try {
      const after = produce(view, (draft) => {
        p.fn(draft as MockDb);
      });
      p.change = diffStore(asShape(view), asShape(after));
      // A new body needs a new key: the old one is bound to the old body.
      p.key = randomToken(24);
      view = after;
      kept.push(p);
    } catch (e) {
      // The change no longer makes sense against what is really there — the
      // machine it sold has gone, say. Refuse it rather than guess.
      p.done(false);
      dropped += 1;
      if (!quiet) {
        // A mutation that throws on replay throws whatever JavaScript throws
        // — `find(...)!.skuId = v` on a row that is gone — which names nothing
        // the person did. The original is kept on the console for whoever
        // debugs it.
        if (e instanceof TypeError) console.error(e);
        report(e instanceof TypeError ? new Error(REPLAY_MISMATCH) : e);
      }
    }
  }
  queue = kept;
  db = view;
  notify();
  return dropped;
}

/** What a replayed change that no longer fits the server's rows is called. */
const REPLAY_MISMATCH = "Perubahan ini tidak cocok lagi dengan data terbaru.";

/** Take in rows the server sent — after a commit, or from polling. */
function absorb(
  delta: StoreDelta,
  codes?: Readonly<Record<string, string>>,
): void {
  if (compareCursor(delta.cursor, cursor) > 0) cursor = delta.cursor;
  const previous = db;
  confirmed = patch(confirmed, delta);
  if (codes !== undefined && Object.keys(codes).length > 0) {
    for (const p of queue) p.change = replaceStrings(p.change, codes);
  }
  let view = confirmed;
  for (const p of queue) view = applyChange(view, p.change);
  db = keepPositions(view, previous, delta);
  notify();
}

function startPolling(): void {
  if (poller !== undefined) return;
  poller = setInterval(() => {
    void poll();
  }, POLL_MS);
}

async function poll(): Promise<void> {
  if (!remote || status.phase !== "ready" || inFlight) return;
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const delta = await transport.changes(cursor);
    // A commit started while this was in the air; its answer brings the
    // store up to date and the next tick asks again.
    if (inFlight) return;
    if (delta === "RESET") {
      await rebase();
      return;
    }
    if (compareCursor(delta.cursor, cursor) <= 0) return;
    absorb(delta);
  } catch {
    // Offline or a blip. The next tick tries again.
  }
}

function compareCursor(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x > y ? 1 : -1;
}

/**
 * Tell whoever shows toasts. `dependents` is how many queued changes went down
 * with this one because they were built on it.
 */
function report(e: unknown, dependents = 0): void {
  const text =
    dependents > 0
      ? `${messageOf(e).replace(/\.$/, "")} — ${dependents} perubahan sesudahnya ikut dibatalkan.`
      : messageOf(e);
  for (const l of errorListeners) l(text);
}

function messageOf(e: unknown): string {
  // A row the browser could not even encode. Zod's own `message` is its issue
  // list as JSON — the `[{ "origin": "string", "code": "too_small", … }]` the
  // owner photographed on 2026-09-15 — so it is said as `path: message`, the
  // same shape the server's refusals use.
  if (isZodError(e)) {
    return e.issues
      .slice(0, 3)
      .map((i) => `${i.path.map(String).join(".") || "(baris)"}: ${i.message}`)
      .join("; ");
  }
  if (e instanceof Error && e.message !== "") return e.message;
  return "Terjadi kesalahan.";
}

function isZodError(
  e: unknown,
): e is Error & { issues: { path: PropertyKey[]; message: string }[] } {
  return (
    e instanceof Error &&
    // `ZodError` from zod's classic API, `$ZodError` from its core.
    /ZodError$/.test(e.name) &&
    Array.isArray((e as { issues?: unknown }).issues)
  );
}

// ---------------------------------------------------------------------------
// Laying rows onto a store
// ---------------------------------------------------------------------------

type Mutable = Record<string, unknown>;

function listOf(store: Mutable, name: CollectionName): Row[] {
  const list = store[name];
  return Array.isArray(list) ? (list as Row[]) : [];
}

function reorder(
  name: CollectionName,
  list: readonly Row[],
  keys: readonly string[],
): Row[] {
  const byKey = new Map(list.map((r) => [keyOf(name, r), r]));
  const out: Row[] = [];
  for (const k of keys) {
    const row = byKey.get(k);
    if (row !== undefined) {
      out.push(row);
      byKey.delete(k);
    }
  }
  return [...out, ...byKey.values()];
}

/** Rows from the server, decoded, onto a store. */
function patch(store: MockDb, delta: StoreDelta): MockDb {
  const out: Mutable = { ...(store as unknown as Mutable) };
  const names = new Set([
    ...Object.keys(delta.rows ?? {}),
    ...Object.keys(delta.removed ?? {}),
    ...Object.keys(delta.order ?? {}),
  ]);
  for (const name of names) {
    if (!isCollectionName(name)) continue;
    const rows = (delta.rows?.[name] ?? []).map((r) => decodeRow(name, r));
    let list = applyRows(name, listOf(out, name), rows, delta.removed?.[name]);
    const order = delta.order?.[name];
    if (order !== undefined) list = reorder(name, list, order);
    out[name] = list;
  }
  for (const [name, value] of Object.entries(delta.singletons ?? {})) {
    if (isSingletonName(name)) out[name] = decodeSingleton(name, value);
  }
  return out as unknown as MockDb;
}

/** A queued change laid onto a store, as the mutation left it. */
function applyChange(store: MockDb, change: Changeset): MockDb {
  const out: Mutable = { ...(store as unknown as Mutable) };
  for (const [name, c] of Object.entries(change.collections)) {
    if (!isCollectionName(name) || c === undefined) continue;
    const updates: Row[] = [];
    const removed: string[] = [];
    const inserts: { row: Row; index: number }[] = [];
    const existing = new Set(listOf(out, name).map((r) => keyOf(name, r)));
    for (const r of c.rows) {
      if (r.next === undefined) removed.push(r.key);
      else if (existing.has(r.key)) updates.push(r.next);
      else
        inserts.push({
          row: r.next,
          index: r.index ?? Number.MAX_SAFE_INTEGER,
        });
    }
    let list = applyRows(name, listOf(out, name), updates, removed);
    inserts.sort((a, b) => a.index - b.index);
    for (const { row, index } of inserts) {
      list.splice(Math.min(index, list.length), 0, row);
    }
    if (c.order !== undefined) list = reorder(name, list, c.order);
    out[name] = list;
  }
  for (const [name, s] of Object.entries(change.singletons)) {
    if (isSingletonName(name) && s !== undefined) out[name] = s.next;
  }
  return out as unknown as MockDb;
}

/**
 * Keep rows where the screen had them.
 *
 * A row the server has just confirmed would otherwise jump to the end of its
 * list — the server appends what it does not know the position of — and a page
 * that `unshift`ed the newest order would find it last. Rows the screen already
 * showed keep their places; rows new to this browser go after them.
 */
function keepPositions(
  view: MockDb,
  previous: MockDb,
  delta: StoreDelta,
): MockDb {
  const touched = new Set([
    ...Object.keys(delta.rows ?? {}),
    ...Object.keys(delta.removed ?? {}),
  ]);
  if (touched.size === 0) return view;
  const out: Mutable = { ...(view as unknown as Mutable) };
  const before = previous as unknown as Mutable;
  for (const name of touched) {
    if (!isCollectionName(name) || delta.order?.[name] !== undefined) continue;
    const reference = listOf(before, name);
    const pos = new Map(reference.map((r, i) => [keyOf(name, r), i]));
    const list = listOf(out, name);
    const known = list
      .filter((r) => pos.has(keyOf(name, r)))
      .sort((a, b) => pos.get(keyOf(name, a))! - pos.get(keyOf(name, b))!);
    const fresh = list.filter((r) => !pos.has(keyOf(name, r)));
    out[name] = [...known, ...fresh];
  }
  return out as unknown as MockDb;
}

// ---------------------------------------------------------------------------
// Ids, document numbers, and who is doing it
// ---------------------------------------------------------------------------

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET.charAt(b % ALPHABET.length);
  return out;
}

let n = 100;

/**
 * A new row id. Random against the server, because two tills minting `o_101`
 * would be two different sales with one id; sequential on the demo seed, where
 * the tests have always had them.
 */
export const nextId = (prefix: string): string =>
  remote ? `${prefix}_${randomToken(16)}` : `${prefix}_${++n}`;

/**
 * A document number. Against the server this is PROVISIONAL —
 * `SI-2026/09-Tk3x9q2a` — and the commit swaps it for the next real one from
 * `next_doc_code`, everywhere it was written. Two tills cannot number the same
 * sale, and a till cannot skip or reuse a number.
 */
export function docCode(prefix: string): string {
  const d = new Date();
  const ym = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (remote) return `${prefix}-${ym}-T${randomToken(7)}`;
  return `${prefix}-${ym}-${String(++n).padStart(6, "0")}`;
}

let staffName = "Michella";

/**
 * Who is signed in, for the name written onto new rows. The server attributes
 * every row it writes to the SESSION regardless — this only keeps what the
 * screen shows before the commit lands from naming the wrong person.
 */
export function setStoreStaff(name: string): void {
  staffName = name;
}

export function currentStaffName(): string {
  return staffName;
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Tests only: run against a fake server instead of the demo seed. */
export function __useRemoteStore(fake: StoreTransport): void {
  __stopStorePolling();
  remote = true;
  transport = fake;
  queue = [];
  inFlight = false;
  cursor = "0";
  db = emptyDb();
  confirmed = db;
  status = { phase: "idle", pending: 0, offline: false };
  notify();
}

/** Tests only: stop the change poller. */
export function __stopStorePolling(): void {
  if (poller !== undefined) clearInterval(poller);
  poller = undefined;
}

/** Tests only: run one poll now. */
export function __pollStore(): Promise<void> {
  return poll();
}

// ---------------------------------------------------------------------------
// Shared helpers the pages write through
// ---------------------------------------------------------------------------

/**
 * Resolve a reason label to a row in `reasons`, creating it if it is new.
 *
 * This is the whole no-orphan-data rule in one function. A screen that lets a
 * user type a reason must call this INSIDE the same `mutate` that writes the
 * record referencing it, so the managed list is never a step behind the data
 * pointing at it — there is no window in which an adjustment names a reason
 * Settings has never heard of.
 *
 * Matching is case-insensitive on the trimmed label, so "internal use" does not
 * become a second row beside "Internal Use".
 */
export function ensureReason(
  draft: MockDb,
  activity: ReasonActivity,
  label: string,
): string {
  const clean = label.trim();
  if (!clean) return "";
  const found = draft.reasons.find(
    (r) =>
      r.activity === activity && r.label.toLowerCase() === clean.toLowerCase(),
  );
  if (found) {
    // A reason that was switched off but is being used again is on again.
    found.active = true;
    return found.id;
  }
  const id = nextId("rsn");
  draft.reasons.push({ id, activity, label: clean, active: true });
  return id;
}

/**
 * Resolve a QC description to a row in `qcDescriptions`, creating it if it is
 * new — `ensureReason` for the thing QC actually types.
 *
 * Called INSIDE the same `mutate` that writes the description onto the unit,
 * for the same no-orphan-data reason: the suggestion list must never be a step
 * behind the machines described with it.
 *
 * Matching is case-insensitive on the trimmed label, so "Mulus, fullset dus"
 * typed in lower case does not become a second entry beside the seeded one.
 * That is most of what this is FOR — three people typing the same sentence six
 * ways is exactly the mess the list replaces.
 *
 * Returns the stored label, which may differ from what was typed only in case
 * and whitespace. Callers write THAT onto the unit, so the phrase on a machine
 * and the phrase in the list are one string.
 */
export function ensureQcDescription(draft: MockDb, label: string): string {
  const clean = label.trim();
  if (!clean) return "";
  const found = draft.qcDescriptions.find(
    (d) => d.label.toLowerCase() === clean.toLowerCase(),
  );
  if (found) {
    // A phrase switched off in Settings but typed again is back in use.
    found.active = true;
    return found.label;
  }
  draft.qcDescriptions.push({ id: nextId("qcd"), label: clean, active: true });
  return clean;
}

/**
 * The label for a reason id, falling back to the id so a row never renders
 * blank — and to "None" when there is no reason at all.
 */
export function reasonLabel(draft: MockDb, id: string | undefined): string {
  if (!id) return fmtNone();
  return draft.reasons.find((r) => r.id === id)?.label ?? id;
}

/**
 * The QC photographs of one machine, newest first.
 *
 * Reads through the notes rather than off the unit because that is where the
 * schema puts them — `UnitNotePhoto` → `UnitNote` → unit. See `UnitNote` in
 * seed.ts.
 */
export function qcPhotosOf(db: MockDb, serial: string): UnitNotePhoto[] {
  return db.unitNotes
    .filter((n) => n.serial === serial && n.tag === QC_PHOTO_TAG)
    .flatMap((n) => n.photos)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** What marks a note as carrying grading photographs. */
export const QC_PHOTO_TAG = "QC";

/**
 * Attach a photograph to a machine's QC note, creating the note if it is the
 * first one.
 *
 * One note per machine per grading rather than one per picture: the four
 * photographs somebody takes of a dented lid are one observation, and four
 * notes would make the timeline read as four.
 */
export function addQcPhoto(
  draft: MockDb,
  serial: string,
  url: string,
  staff = currentStaffName(),
): void {
  let note = draft.unitNotes.find(
    (n) => n.serial === serial && n.tag === QC_PHOTO_TAG,
  );
  if (!note) {
    note = {
      id: nextId("note"),
      serial,
      body: "",
      tag: QC_PHOTO_TAG,
      staff,
      at: new Date().toISOString(),
      photos: [],
    };
    draft.unitNotes.push(note);
  }
  note.photos.push({
    id: nextId("ph"),
    url,
    sortOrder: note.photos.length,
  });
}

/** Drop one photograph. Renumbers the rest so `sortOrder` stays a sequence. */
export function removeQcPhoto(draft: MockDb, serial: string, photoId: string) {
  for (const note of draft.unitNotes) {
    if (note.serial !== serial || note.tag !== QC_PHOTO_TAG) continue;
    note.photos = note.photos
      .filter((ph) => ph.id !== photoId)
      .map((ph, i) => ({ ...ph, sortOrder: i }));
  }
  // A note whose last picture has gone and that carries no words is nothing.
  draft.unitNotes = draft.unitNotes.filter(
    (n) =>
      n.tag !== QC_PHOTO_TAG || n.photos.length > 0 || n.body.trim() !== "",
  );
}

/**
 * Purge a sold machine's QC photographs — CLAUDE.md's ONE sanctioned hard
 * delete, and it stops here.
 *
 * The grading photographs exist to answer "what condition was this in when we
 * took it in?", and once the machine has left the shop that question has an
 * owner, which is the person holding it. Keeping a folder of pictures of other
 * people's laptops is a liability with no use, so the row and the file both go
 * (owner decision 2026-08-24).
 *
 * The `UnitEvent` ledger is untouched: the sale is still on the timeline, and
 * so is the description typed at QC. Only the image goes. Do NOT generalise
 * this to any other row in this store.
 */
export function purgeQcPhotos(draft: MockDb, serials: readonly string[]): void {
  const sold = new Set(serials);
  draft.unitNotes = draft.unitNotes.filter(
    (n) => !(sold.has(n.serial) && n.tag === QC_PHOTO_TAG),
  );
}

/**
 * Take a unit's LAST event back off, and re-project it onto the unit.
 *
 * The one place the ledger is not append-only (owner decision 2026-09-23):
 * a sale's unit can be swapped in Transaction History, and the owner asked for
 * that to leave no trace of the unit it replaced. Only the last event, because
 * the rows either side of a hole would claim statuses that no longer meet —
 * which is the continuity `packages/db` checks on the way in.
 *
 * Answers the event it removed, so a caller can tell whether anything moved.
 */
export function removeLastEvent(
  draft: MockDb,
  serial: string,
): MockDb["events"][number] | undefined {
  const mine = draft.events.filter((e) => e.serial === serial);
  const last = mine[mine.length - 1];
  // Never the only one: a unit with no history is a unit whose status nothing
  // explains, and the store refuses to hold one.
  if (last === undefined || mine.length < 2) return undefined;
  draft.events = draft.events.filter((e) => e.id !== last.id);
  const now = mine[mine.length - 2]!;
  const unit = draft.units.find((u) => u.serial === serial);
  if (unit) {
    unit.status = now.toStatus as typeof unit.status;
    unit.locationId = now.locationId;
  }
  return last;
}

/**
 * Delete one row from a unit's history (owner ask 2026-10-22: *"some of the
 * history is irrelevant"*). Any row, behind the ⋯ on S/N history, with two
 * refusals `historyRowDeletion` explains. The NEWEST row going puts the unit
 * back to what the row before it says, as `removeLastEvent` does; a row out
 * of the middle leaves the unit where it is.
 */
export function removeEvent(draft: MockDb, eventId: string): boolean {
  const ev = draft.events.find((e) => e.id === eventId);
  if (ev === undefined) return false;
  const mine = draft.events
    .filter((e) => e.serial === ev.serial)
    .sort((a, b) => a.seq - b.seq);
  if (mine.length < 2) return false;
  const wasLast = mine[mine.length - 1]!.id === ev.id;
  draft.events = draft.events.filter((e) => e.id !== ev.id);
  if (wasLast) {
    const now = mine[mine.length - 2]!;
    const unit = draft.units.find((u) => u.serial === ev.serial);
    if (unit) {
      unit.status = now.toStatus as typeof unit.status;
      unit.locationId = now.locationId;
    }
  }
  return true;
}

/** Append a lifecycle event and update the unit projection together. */
export function appendEvent(
  draft: MockDb,
  serial: string,
  ev: {
    type: string;
    note?: string;
    toStatus?: string;
    toLocationId?: string;
    refCode?: string;
  },
  staff = currentStaffName(),
): void {
  const unit = draft.units.find((u) => u.serial === serial);
  if (!unit) return;
  draft.events.push({
    id: nextId("ev"),
    serial,
    // The highest number plus one, not the count: a row deleted from the
    // middle of a history (2026-10-22) leaves a gap, and the store wants
    // each new row to follow the newest.
    seq:
      draft.events.reduce(
        (n, e) => (e.serial === serial && e.seq > n ? e.seq : n),
        0,
      ) + 1,
    type: ev.type,
    at: new Date().toISOString(),
    fromStatus: unit.status,
    toStatus: ev.toStatus ?? unit.status,
    locationId: ev.toLocationId ?? unit.locationId,
    note: ev.note,
    refCode: ev.refCode,
    staff,
  });
  if (ev.toStatus) unit.status = ev.toStatus as typeof unit.status;
  if (ev.toLocationId) unit.locationId = ev.toLocationId;
}
