/**
 * In-app tabs — the rules (owner ask 2026-09-15).
 *
 * > *"The app should have tabs inside, so when I am in Inbound menu and I open
 * > product, it will open a tab inside the app, and when that menu is already
 * > opened, just redirect the tab without reopening new identical tab."*
 *
 * One tab per nav LEAF — `matchLeaf`'s leaf, or a leaf-less section such as
 * Chatbot. A route below a leaf belongs to that leaf's tab: `/inbound/po-1` is
 * the Inbound & QC tab showing an order, not a second tab. So "identical" is
 * decided by the menu entry and never by the URL, and a tab remembers the last
 * place it was.
 *
 * Pure — no React, no router — so what a test has to hold (which tab a URL
 * lands in, who a close hands over to, which tab the cap drops) is readable
 * in one place. `AppTabs.tsx` is where the browser meets it.
 */
import type { ReactNode } from "react";
import { matchLeaf } from "./navigation.js";

/** One screen the shell can put in a tab. `App.tsx` holds the table. */
export interface PageRoute {
  readonly path: string;
  readonly element: ReactNode;
}

/** Where a tab is: the parts of a URL a page reads, and its history state. */
export interface TabLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  /**
   * The history entry's `state`. In memory only: it is whatever a page handed
   * to `navigate`, which nothing promises is serialisable, so a reload
   * restores the URL and not this.
   */
  readonly state?: unknown;
}

export interface TabRecord {
  /**
   * Unique per OPENING, not per leaf. A leaf closed and opened again is a
   * fresh page — that is what closing means — so the React key cannot be the
   * leaf.
   */
  readonly id: string;
  /** The nav leaf's path, which is what makes two tabs "identical". */
  readonly leaf: string;
  readonly location: TabLocation;
  /** When the tab was last on screen, on the state's own clock. */
  readonly used: number;
}

export interface TabsState {
  readonly tabs: readonly TabRecord[];
  readonly activeId: string | null;
  /** Ticks on every activation. Only the order matters, and a counter cannot tie. */
  readonly clock: number;
  /** The last id handed out. */
  readonly seq: number;
}

export const EMPTY_TABS: TabsState = {
  tabs: [],
  activeId: null,
  clock: 0,
  seq: 0,
};

/**
 * The most tabs kept open; past it the least recently used one closes.
 *
 * Every open tab is a MOUNTED page (see `AppTabs.tsx`), and a mounted page is
 * not free — it keeps its store subscriptions and re-renders when the shop's
 * data moves. Twelve is more screens than one job touches in a shift.
 */
export const MAX_TABS = 12;

/** Where the shift opens, and where closing the last tab lands. */
export const HOME_PATH = "/stock/inventory";

/** Per device, like the scanner and the label paper: tabs are a desk's state. */
export const TABS_STORAGE_KEY = "nusantara.tabs";

/** The nav entry whose tab a URL belongs to, or null if no entry owns it. */
export function tabLeafOf(
  pathname: string,
): { path: string; label: string } | null {
  const match = matchLeaf(pathname);
  if (match === null) return null;
  if (match.leaf !== undefined) return match.leaf;
  const { path, label } = match.section;
  return path === undefined ? null : { path, label };
}

/**
 * A page's tab key. A page no nav entry owns is keyed by its own path — there
 * is none today, and one added later should get a tab rather than vanish.
 */
function leafKeyOf(pathname: string): string {
  return tabLeafOf(pathname)?.path ?? pathname;
}

export function hrefOf(location: TabLocation): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function toTabLocation({
  pathname,
  search,
  hash,
  state,
}: TabLocation): TabLocation {
  // A history entry nobody passed state to holds `null`. Leaving it out means
  // "no state" compares equal however it arrived.
  return state === null || state === undefined
    ? { pathname, search, hash }
    : { pathname, search, hash, state };
}

function sameLocation(a: TabLocation, b: TabLocation): boolean {
  return (
    a.pathname === b.pathname &&
    a.search === b.search &&
    a.hash === b.hash &&
    a.state === b.state
  );
}

/**
 * The address bar moved: put the tab that owns the new URL on screen, at that
 * URL, opening it if it is not open.
 *
 * A URL that is not a page is ignored. A redirect (`/stock/adjustment`) is on
 * its way somewhere else, and a tab opened for it would be a tab for an
 * address about to be replaced.
 */
export function visitLocation(
  state: TabsState,
  location: TabLocation,
  isPage: (pathname: string) => boolean,
  max: number = MAX_TABS,
): TabsState {
  if (!isPage(location.pathname)) return state;
  const next = toTabLocation(location);
  const leaf = leafKeyOf(next.pathname);
  const open = state.tabs.find((tab) => tab.leaf === leaf);
  const unmoved = open !== undefined && sameLocation(open.location, next);
  if (unmoved && open.id === state.activeId) return state;

  const clock = state.clock + 1;
  if (open !== undefined) {
    return {
      ...state,
      clock,
      activeId: open.id,
      tabs: state.tabs.map((tab) =>
        tab.id === open.id
          ? // The old object when nothing moved, so a memoised panel whose
            // location did not change is not handed a new one.
            { ...tab, location: unmoved ? tab.location : next, used: clock }
          : tab,
      ),
    };
  }
  const seq = state.seq + 1;
  const opened: TabRecord = {
    id: `tab-${seq}`,
    leaf,
    location: next,
    used: clock,
  };
  return {
    tabs: evict([...state.tabs, opened], max, opened.id),
    activeId: opened.id,
    clock,
    seq,
  };
}

/** Drops the least recently used tabs past `max`, never `keep`. */
function evict(
  tabs: readonly TabRecord[],
  max: number,
  keep: string,
): readonly TabRecord[] {
  let kept = tabs;
  while (kept.length > Math.max(max, 1)) {
    const oldest = kept
      .filter((tab) => tab.id !== keep)
      .reduce((a, b) => (b.used < a.used ? b : a));
    kept = kept.filter((tab) => tab !== oldest);
  }
  return kept;
}

/**
 * Closes a tab, and says where the address bar goes if it was the one on
 * screen: the neighbour to its right, else to its left — the tab that slides
 * under the pointer, which is where a browser sends you too. Closing a tab
 * that is not on screen moves nothing.
 *
 * Closing the LAST tab lands on a fresh {@link HOME_PATH} (decided
 * 2026-09-15). The content area always shows a page — the URL has to name
 * one — and close means "throw this away", so somebody clearing a half-typed
 * form out of the only open tab has to be able to. Refusing to close the last
 * tab would make that the one form in the app that cannot be abandoned.
 */
export function closeTab(
  state: TabsState,
  id: string,
): { state: TabsState; go: TabLocation | null } {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return { state, go: null };
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { state: { ...state, tabs }, go: null };

  const neighbour = tabs[index] ?? tabs[index - 1];
  if (neighbour === undefined) {
    return {
      state: { ...state, tabs, activeId: null },
      go: { pathname: HOME_PATH, search: "", hash: "" },
    };
  }
  const clock = state.clock + 1;
  return {
    state: {
      ...state,
      clock,
      activeId: neighbour.id,
      tabs: tabs.map((tab) =>
        tab.id === neighbour.id ? { ...tab, used: clock } : tab,
      ),
    },
    go: neighbour.location,
  };
}

/**
 * A page in a tab that is NOT on screen navigated — a mount effect tidying its
 * query string, say.
 *
 * It moves that tab and nothing else: never the address bar, which belongs to
 * the tab on screen, and never into another leaf, because a hidden page that
 * could open a tab could take the screen from whoever is using it.
 */
export function moveTab(
  state: TabsState,
  id: string,
  location: TabLocation,
  isPage: (pathname: string) => boolean,
): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (
    tab === undefined ||
    !isPage(location.pathname) ||
    leafKeyOf(location.pathname) !== tab.leaf
  ) {
    return state;
  }
  const next = toTabLocation(location);
  if (sameLocation(tab.location, next)) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, location: next } : t)),
  };
}

/** What `writeStoredTabs` saves. `active` is an index into `tabs`. */
interface StoredTabs {
  active: number;
  tabs: { pathname: string; search: string; hash: string; used: number }[];
}

/**
 * The tabs this device had open, read back.
 *
 * Defensive the way every stored preference here is: Safari throws on
 * `localStorage` in private browsing, and a stored value can come from an
 * older build. A tab whose location no longer names a page falls back to its
 * leaf's own path, and is dropped if even that is gone — a tab restored onto
 * a retired route would render nothing at all.
 *
 * Ids and the clock are renumbered in stored order. Nothing is mounted yet,
 * so nothing depends on them, and a hand-edited value cannot then produce two
 * tabs with one React key.
 */
export function readStoredTabs(
  isPage: (pathname: string) => boolean,
  max: number = MAX_TABS,
): TabsState {
  let raw: unknown;
  try {
    const stored = localStorage.getItem(TABS_STORAGE_KEY);
    if (stored === null) return EMPTY_TABS;
    raw = JSON.parse(stored);
  } catch {
    return EMPTY_TABS;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_TABS;
  const { tabs, active } = raw as Partial<Record<keyof StoredTabs, unknown>>;
  if (!Array.isArray(tabs)) return EMPTY_TABS;

  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const seen = new Set<string>();
  const kept: {
    location: TabLocation;
    leaf: string;
    used: number;
    wasActive: boolean;
  }[] = [];
  tabs.forEach((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const e = entry as Record<string, unknown>;
    let location: TabLocation = {
      pathname: text(e.pathname),
      search: text(e.search),
      hash: text(e.hash),
    };
    if (!location.pathname.startsWith("/")) return;
    const leaf = leafKeyOf(location.pathname);
    if (!isPage(location.pathname)) {
      if (!isPage(leaf)) return;
      location = { pathname: leaf, search: "", hash: "" };
    }
    if (seen.has(leaf)) return;
    seen.add(leaf);
    kept.push({
      location,
      leaf,
      used: typeof e.used === "number" ? e.used : 0,
      wasActive: index === active,
    });
  });

  // Past the cap, the most recently used survive — the same rule the cap
  // applies while the app is running.
  const byRecency = [...kept].sort((a, b) => a.used - b.used);
  const survivors = new Set(byRecency.slice(-Math.max(max, 1)));
  const restored = kept.filter((tab) => survivors.has(tab));
  const rank = new Map(
    byRecency.filter((tab) => survivors.has(tab)).map((tab, i) => [tab, i + 1]),
  );

  const records = restored.map(
    (tab, i): TabRecord => ({
      id: `tab-${i + 1}`,
      leaf: tab.leaf,
      location: tab.location,
      used: rank.get(tab) ?? 0,
    }),
  );
  const activeIndex = restored.findIndex((tab) => tab.wasActive);
  return {
    tabs: records,
    activeId: records[activeIndex]?.id ?? null,
    clock: records.length,
    seq: records.length,
  };
}

export function writeStoredTabs(state: TabsState): void {
  const stored: StoredTabs = {
    active: state.tabs.findIndex((tab) => tab.id === state.activeId),
    tabs: state.tabs.map(({ location: { pathname, search, hash }, used }) => ({
      pathname,
      search,
      hash,
      used,
    })),
  };
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Tabs that cannot be persisted still work for this session.
  }
}
